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
 * returns 202 immediately. GET /api/scan-events is a small SSE hub: it
 * replays whatever it knows about the most recent scan to a fresh
 * subscriber, then streams live events, and ends the stream at the
 * terminal 'done' event. When a scan lands, the fresh Snapshot both
 * replaces `latest` in memory (no restart needed) and is persisted via
 * saveCache.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../shared/contract.js';
import { scan } from './scan.js';
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

/** @returns {Snapshot} the shape /api/atlas answers with before anything has ever loaded. */
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
}) {
  /**
   * @type {{
   *   latest: Snapshot | null,
   *   scanning: boolean,
   *   events: ScanEvent[],
   *   sseClients: Set<import('node:http').ServerResponse>,
   * }}
   */
  const state = {
    latest: null,
    scanning: false,
    events: [],
    sseClients: new Set(),
  };

  // Seed `latest` from disk. Never blocks route handlers hard-crashing;
  // getSnapshot() below awaits this exactly once (it's cheap after that,
  // since an already-settled promise resolves on the next microtask).
  const cacheReady = loadCache(cacheFile)
    .then((cached) => {
      if (cached) state.latest = cached;
    })
    .catch(() => {
      // loadCache never throws per its own contract, but stay defensive.
    });

  async function getSnapshot() {
    await cacheReady;
    return state.latest ?? emptySnapshot();
  }

  /** @param {ScanEvent} event */
  function broadcast(event) {
    state.events.push(event);
    for (const res of state.sseClients) writeSseEvent(res, event);
    if (event.phase === 'done') {
      for (const res of state.sseClients) res.end();
      state.sseClients.clear();
    }
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
        await saveCache(cacheFile, snapshot);
      } catch (err) {
        // A failed scan leaves the last-known-good snapshot in place;
        // it must never take the server down or wedge single-flight.
        console.error('[repo-atlas] scan failed:', err);
      } finally {
        if (pendingDone) {
          broadcast(pendingDone);
        } else {
          // Errored before completion: don't leave subscribers hanging.
          for (const res of state.sseClients) res.end();
          state.sseClients.clear();
        }
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

    // Replay everything known about the most recent (or in-flight) scan.
    for (const event of state.events) writeSseEvent(res, event);

    if (state.scanning) {
      // Live events still to come: keep this connection open.
      state.sseClients.add(res);
      req.on('close', () => state.sseClients.delete(res));
    } else {
      // Nothing more will arrive until the next rescan; close cleanly.
      res.end();
    }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootDir = path.join(os.homedir(), 'Projects');
  const server = createServer({
    rootDir,
    cacheFile: DEFAULT_CACHE_FILE,
    scanFn: scan,
    port: DEFAULT_PORT,
  });
  server.listen(DEFAULT_PORT, () => {
    console.log(`[repo-atlas] listening on http://localhost:${DEFAULT_PORT}`);
  });
  // Cache-first: whatever's on disk serves immediately; always kick a
  // background scan on boot so data freshens without a restart.
  server.triggerRescan();
}
