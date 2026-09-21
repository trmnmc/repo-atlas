/**
 * Repo Atlas — HTTP server (plain Node ESM, zero deps, zero build step).
 *
 * `createServer({ rootDir, cacheFile, scanFn, port, nowFn, distDir })` wires
 * up the whole seam and returns the node http.Server WITHOUT listening —
 * callers (tests, the main entry below) decide when/where to listen.
 *
 * Cache-first contract: GET /api/atlas always answers from the in-memory
 * `latest` snapshot (seeded from cacheFile on boot) — it never blocks on a
 * scan. POST /api/rescan kicks scanFn asynchronously (single-flight: a scan
 * already running just reports back {scanning:true}, no second scan) and
 * returns 202 immediately. GET /api/scan-events is a small SSE hub: a
 * subscriber joining mid-scan gets the in-flight scan's events replayed
 * in order, then live events. The connection is PERSISTENT — the server
 * never ends a live SSE stream itself (an EventSource treats a
 * server-closed 200 stream as an error and auto-reconnects ~3s later,
 * which turned one finished scan into an infinite replay/refetch loop).
 * The stream ends only when the client disconnects or the server shuts
 * down. Retained events are cleared once a scan finishes (after the
 * snapshot swap + saveCache), so a subscriber joining between scans gets
 * nothing — never a stale terminal 'done'. When a scan lands, the fresh
 * Snapshot both replaces `latest` in memory (no restart needed) and is
 * persisted via saveCache.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../shared/contract.js';
import { scan } from './scan.js';
import { makeDemoScanFn } from '../shared/demoSnapshot.js';
import { loadCache, saveCache } from './cache.js';

/** @typedef {import('../shared/contract.js').Snapshot} Snapshot */
/** @typedef {import('../shared/contract.js').ScanEvent} ScanEvent */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Default build output directory served for non-API GETs. */
export const DEFAULT_DIST_DIR = path.join(PROJECT_ROOT, 'dist');

/** Default on-disk snapshot cache location for the main entry. */
export const DEFAULT_CACHE_FILE = path.join(PROJECT_ROOT, '.atlas-cache.json');

/** The production port this server listens on when run directly. */
export const DEFAULT_PORT = 4600;

/** Native actions exposed by the local-only repository control panel. */
const REPO_ACTIONS = new Set(['finder', 'terminal']);

/**
 * Ask macOS to reveal a repository or open a Terminal window in it.
 * `execFile` receives an argv array (never a shell string), and callers can
 * only reach this function with a path taken from the current scan.
 *
 * @param {string} repoPath absolute path from RepoSummary.path
 * @param {'finder' | 'terminal'} action
 * @returns {Promise<void>}
 */
export function openRepoNative(repoPath, action) {
  const args = action === 'finder'
    ? ['-R', repoPath]
    : ['-a', 'Terminal', repoPath];
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const DEFAULT_MIME = 'application/octet-stream';

/**
 * The shape /api/atlas answers with before anything has ever loaded.
 *
 * `generatedAt: null` is the DELIBERATE pre-first-scan sentinel, not a
 * contract violation to "fix": the contract types generatedAt as a string
 * for real snapshots, and the UI (src/App.tsx + useAtlas) explicitly
 * branches on null to render its no-snapshot-yet state. Changing null to
 * a string here would silently break that handling — keep the two in sync.
 *
 * @returns {Snapshot} contract-shaped empty snapshot (repos/attention are
 *   valid empty arrays; generatedAt is the null sentinel described above).
 */
function emptySnapshot() {
  return { generatedAt: null, repos: [], attention: [] };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {ScanEvent} event
 */
function writeSseEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Build the server. Nothing here calls `.listen()` — the caller does that
 * (tests use an ephemeral port via `server.listen(0)`; the main entry below
 * listens on DEFAULT_PORT).
 *
 * @param {{
 *   rootDir: string,
 *   cacheFile: string,
 *   scanFn: (rootDir: string, opts: { onProgress?: (e: ScanEvent) => void, nowIso?: string }) => Promise<Snapshot>,
 *   port?: number,
 *   nowFn?: () => string,
 *   distDir?: string,
 *   repoActionFn?: (repoPath: string, action: 'finder' | 'terminal') => Promise<void>,
 * }} config
 * @returns {import('node:http').Server}
 */
export function createServer({
  rootDir,
  cacheFile,
  scanFn,
  port = DEFAULT_PORT,
  nowFn = () => new Date().toISOString(),
  distDir = DEFAULT_DIST_DIR,
  repoActionFn = openRepoNative,
}) {
  /**
   * @type {{
   *   latest: Snapshot | null,
   *   scanLanded: boolean,
   *   scanning: boolean,
   *   events: ScanEvent[],
   *   sseClients: Set<import('node:http').ServerResponse>,
   * }}
   */
  const state = {
    latest: null,
    // True once any scan result has been swapped into `latest`. Sequences
    // the two writers of `latest`: the async cache seed below must never
    // clobber a fresher scan result that landed while the disk read was
    // still in flight.
    scanLanded: false,
    scanning: false,
    events: [],
    sseClients: new Set(),
  };

  // Seed `latest` from disk. Never blocks route handlers hard-crashing;
  // getSnapshot() below awaits this exactly once (it's cheap after that,
  // since an already-settled promise resolves on the next microtask).
  const cacheReady = loadCache(cacheFile)
    .then((cached) => {
      // Sequenced write: apply the seed only if no scan result has landed
      // yet — a slow loadCache resolving after a fast first scan must not
      // overwrite the fresher snapshot (or the cache file it just wrote).
      if (cached && !state.scanLanded) state.latest = cached;
    })
    .catch(() => {
      // loadCache never throws per its own contract, but stay defensive.
    });

  async function getSnapshot() {
    await cacheReady;
    return state.latest ?? emptySnapshot();
  }

  /**
   * Push a live event to every connected subscriber (and retain it for
   * replay to subscribers joining later in the SAME scan). Never ends the
   * connections — SSE streams are persistent; see handleScanEvents.
   * @param {ScanEvent} event
   */
  function broadcast(event) {
    state.events.push(event);
    for (const res of state.sseClients) writeSseEvent(res, event);
  }

  /**
   * Synchronous check-and-set (no await before the flag flips) so two
   * POSTs arriving back-to-back can never both pass the single-flight
   * gate, regardless of how the rest of the request handler is scheduled.
   * @returns {boolean} true if this call actually started a new scan.
   */
  function startScan() {
    if (state.scanning) return false;
    state.scanning = true;
    state.events = [];
    (async () => {
      // scan()'s contract emits its terminal 'done' progress event and
      // THEN returns the snapshot — so a naive `onProgress: broadcast`
      // would let subscribers observe 'done' (and the stream closing)
      // before state.latest/cacheFile are actually fresh, breaking the
      // "after done, /api/atlas is fresh" guarantee. Defer 'done' until
      // the snapshot has actually landed in memory and on disk.
      let pendingDone = null;
      try {
        const snapshot = await scanFn(rootDir, {
          onProgress: (event) => {
            if (event.phase === 'done') {
              pendingDone = event;
              return;
            }
            broadcast(event);
          },
          nowIso: nowFn(),
        });
        state.latest = snapshot;
        state.scanLanded = true;
        await saveCache(cacheFile, snapshot);
      } catch (err) {
        // A failed scan leaves the last-known-good snapshot in place;
        // it must never take the server down or wedge single-flight.
        console.error('[repo-atlas] scan failed:', err);
      } finally {
        // Deferred terminal event: only sent once the snapshot swap and
        // saveCache above have completed (errored scans send no 'done').
        if (pendingDone) broadcast(pendingDone);
        // Replay exists only DURING a live scan, for subscribers joining
        // mid-scan. Once the scan is over (done or errored), drop the
        // retained events so a later subscriber can never receive a
        // stale replay ending in a terminal 'done' from a finished scan.
        // Connections stay OPEN — closing them would trigger EventSource
        // auto-reconnect loops in the browser.
        state.events = [];
        state.scanning = false;
      }
    })();
    return true;
  }

  /** @param {import('node:http').ServerResponse} res */
  async function handleAtlas(res) {
    const snapshot = await getSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshot));
  }

  /** @param {import('node:http').ServerResponse} res */
  function handleRescan(res) {
    startScan();
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ scanning: true }));
  }

  /**
   * Persistent SSE subscription. The server NEVER ends this stream itself:
   * per the EventSource spec a server-closed 200 stream is an error the
   * client retries (~3s), and the SPA holds one subscription for its whole
   * lifetime — ending the stream here after a scan turned into an infinite
   * reconnect -> stale replay -> refetch loop. The stream lives until the
   * client disconnects (req 'close') or the server shuts down.
   *
   * A subscriber joining mid-scan gets the in-flight scan's events
   * replayed in order, then live events. A subscriber joining while idle
   * gets nothing until the next scan starts (state.events is cleared at
   * scan completion) — never a replayed terminal 'done'.
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function handleScanEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    // Replay the in-flight scan's progress so far (empty while idle).
    for (const event of state.events) writeSseEvent(res, event);

    state.sseClients.add(res);
    req.on('close', () => state.sseClients.delete(res));
  }

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {string} id
   */
  async function handleRepo(res, id) {
    const snapshot = await getSnapshot();
    const repo = snapshot.repos.find((r) => r.id === id);
    if (!repo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `no repo with id "${id}"` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(repo));
  }

  /**
   * Perform one tightly allowlisted local action for a repository in the
   * latest scan. Requiring a custom header prevents a plain cross-site form
   * from launching local apps; scripted cross-origin requests are preflighted
   * and this server deliberately grants no CORS access.
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} id
   * @param {string} action
   */
  async function handleRepoAction(req, res, id, action) {
    if (req.headers['x-repo-atlas-action'] !== '1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'local action header required' }));
      return;
    }
    if (!REPO_ACTIONS.has(action)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unsupported repository action' }));
      return;
    }

    const snapshot = await getSnapshot();
    const repo = snapshot.repos.find((candidate) => candidate.id === id);
    if (!repo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `no repo with id "${id}"` }));
      return;
    }

    try {
      await repoActionFn(repo.path, /** @type {'finder' | 'terminal'} */ (action));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action }));
    } catch (error) {
      console.error(`[repo-atlas] ${action} action failed:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `could not open ${action}` }));
    }
  }

  /**
   * Serve dist/ for any non-API GET. Resolves strictly inside distDir
   * (URL parsing already collapses "../" segments, and this re-checks by
   * hand so containment holds even for inputs that bypass URL parsing).
   * Falls back to index.html for anything that isn't a real file, so
   * client-side routes render.
   * @param {import('node:http').ServerResponse} res
   * @param {string} pathname decoded URL pathname, e.g. "/assets/app.js"
   */
  async function serveStatic(res, pathname) {
    const distRoot = path.normalize(distDir);
    const relPath = pathname === '/' ? 'index.html' : pathname.slice(1);
    let filePath = path.normalize(path.join(distRoot, relPath));
    if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
      filePath = path.join(distRoot, 'index.html');
    }

    let data;
    try {
      data = await fs.readFile(filePath);
    } catch {
      try {
        filePath = path.join(distRoot, 'index.html');
        data = await fs.readFile(filePath);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? DEFAULT_MIME });
    res.end(data);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && pathname === ROUTES.atlas) {
      return handleAtlas(res);
    }
    if (req.method === 'POST' && pathname === ROUTES.rescan) {
      return handleRescan(res);
    }
    if (req.method === 'GET' && pathname === ROUTES.scanEvents) {
      return handleScanEvents(req, res);
    }
    const repoActionMatch = /^\/api\/repo\/([^/]+)\/open\/([^/]+)$/.exec(pathname);
    if (req.method === 'POST' && repoActionMatch) {
      return handleRepoAction(req, res, repoActionMatch[1], repoActionMatch[2]);
    }
    if (req.method === 'GET' && pathname.startsWith('/api/repo/')) {
      const id = pathname.slice('/api/repo/'.length);
      return handleRepo(res, id);
    }
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      return serveStatic(res, pathname);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[repo-atlas] request handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        res.end();
      }
    });
  });

  // Not part of the public HTTP contract: an escape hatch the main entry
  // below uses to kick the initial boot scan through the SAME closured
  // state (a raw self-fetch would work too, but this avoids depending on
  // the server already being listening).
  server.triggerRescan = startScan;
  server.port = port;

  return server;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

/**
 * createServer config for the main entry. `--demo` swaps the git scan for the
 * sample Snapshot (shared/demoSnapshot.js) and isolates everything the owner
 * cares about: a throwaway cache file, so the real .atlas-cache.json is
 * neither served nor overwritten, and no native actions, because the sample
 * repo paths do not exist on this machine.
 *
 * @param {string[]} argv
 */
export function mainConfig(argv) {
  const rootDir = path.join(os.homedir(), 'Projects');
  if (!argv.includes('--demo')) {
    return { rootDir, cacheFile: DEFAULT_CACHE_FILE, scanFn: scan, port: DEFAULT_PORT };
  }
  return {
    rootDir,
    cacheFile: path.join(os.tmpdir(), 'repo-atlas-demo-cache.json'),
    scanFn: makeDemoScanFn(),
    port: DEFAULT_PORT,
    repoActionFn: async () => {
      throw new Error('native actions are disabled in demo mode');
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = process.argv.includes('--demo');
  const server = createServer(mainConfig(process.argv));
  server.listen(DEFAULT_PORT, () => {
    console.log(
      `[repo-atlas] listening on http://localhost:${DEFAULT_PORT}${demo ? ' (demo: sample data)' : ''}`,
    );
  });
  // Cache-first: whatever's on disk serves immediately; always kick a
  // background scan on boot so data freshens without a restart.
  server.triggerRescan();
}
