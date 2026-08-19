// @vitest-environment node
/**
 * Repo Atlas — HTTP server suite.
 *
 * Every test injects a fixture scanFn (emits contract ScanEvents with small
 * awaits, built on the frozen fixtureSnapshot) and talks to a real
 * server.listen(0) over raw fetch / node:http — no supertest dependency.
 * Covers the full T-005 acceptance surface: cache-first /api/atlas,
 * async single-flight /api/rescan, ordered persistent SSE /api/scan-events
 * whose terminal 'done' guarantees /api/atlas is fresh with no restart,
 * /api/repo/:id drill-down + 404, and dist/ static serving incl. a
 * traversal attempt. R-015 additions: the SSE stream is PERSISTENT (the
 * server never ends a live stream — a server-closed 200 stream makes
 * EventSource auto-reconnect and loop), one scan delivers exactly one
 * terminal 'done', an idle-period subscriber gets no stale replay, and a
 * late cache seed can never overwrite a fresher scan result.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from './index.js';
import { fixtureSnapshot } from '../shared/fixtures.js';
import { isScanEvent } from '../shared/contract.js';

/* ------------------------------------------------------------------ */
/* cache.js passthrough mock (delay hook for the seed-race test)       */
/* ------------------------------------------------------------------ */

// Default is a zero-delay passthrough to the REAL implementations, so all
// pre-existing tests exercise the genuine cache code. The seed-race test
// dials loadCacheDelayMs up to reproduce the racy interleaving: the READ
// happens immediately (capturing the stale on-disk bytes before the scan's
// saveCache can overwrite them), but the promise RESOLVES only after the
// delay — i.e. after a fast first scan has already landed its fresh
// snapshot. Delaying before the read would miss the race entirely: the
// late read would just pick up the fresh cache saveCache wrote.
const cacheHooks = vi.hoisted(() => ({ loadCacheDelayMs: 0 }));
vi.mock('./cache.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadCache: async (...args) => {
      const result = await actual.loadCache(...args);
      if (cacheHooks.loadCacheDelayMs > 0) {
        await new Promise((r) => setTimeout(r, cacheHooks.loadCacheDelayMs));
      }
      return result;
    },
  };
});

/* ------------------------------------------------------------------ */
/* Fixture plumbing                                                    */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fixture scanner: replays fixtureSnapshot's repos through onProgress with
 * small awaits between each, exactly like the real scan()'s contract.
 * @param {{ snapshot?: typeof fixtureSnapshot, delayMs?: number }} [opts]
 */
function makeFixtureScanFn({ snapshot = fixtureSnapshot, delayMs = 10 } = {}) {
  let calls = 0;
  /** @type {(rootDir: string, opts: { onProgress?: Function, nowIso?: string }) => Promise<typeof fixtureSnapshot>} */
  async function scanFn(_rootDir, { onProgress, nowIso } = {}) {
    calls += 1;
    const repos = snapshot.repos;
    const total = repos.length;
    onProgress?.({ phase: 'start', done: 0, total });
    await sleep(delayMs);
    let done = 0;
    for (const repo of repos) {
      await sleep(delayMs);
      done += 1;
      onProgress?.({ phase: 'repo', repo: repo.name, done, total });
    }
    onProgress?.({ phase: 'done', done, total });
    return { ...snapshot, generatedAt: nowIso ?? snapshot.generatedAt };
  }
  scanFn.callCount = () => calls;
  return scanFn;
}

const FIXED_NOW = '2026-08-13T00:00:00.000Z';

async function writeDistFixture(distDir) {
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(distDir, 'index.html'),
    '<!doctype html><html><body>Repo Atlas</body></html>',
  );
  await fs.writeFile(path.join(distDir, 'assets', 'app.js'), 'console.log("atlas");');
  await fs.writeFile(path.join(distDir, 'assets', 'app.css'), 'body{color:#111}');
  await fs.writeFile(path.join(distDir, 'assets', 'logo.svg'), '<svg></svg>');
}

/**
 * @param {{ scanFn?: Function, initialCache?: object, repoActionFn?: Function }} [opts]
 */
async function startTestServer({ scanFn, initialCache, repoActionFn } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-server-'));
  const distDir = path.join(tmpDir, 'dist');
  const cacheFile = path.join(tmpDir, '.atlas-cache.json');
  await writeDistFixture(distDir);
  // A secret sibling of dist/, used to prove traversal never escapes it.
  await fs.writeFile(path.join(tmpDir, 'secret'), 'TOP SECRET — must never be served');
  if (initialCache) {
    await fs.writeFile(cacheFile, JSON.stringify(initialCache));
  }
  const usedScanFn = scanFn ?? makeFixtureScanFn();
  const server = createServer({
    rootDir: tmpDir,
    cacheFile,
    scanFn: usedScanFn,
    nowFn: () => FIXED_NOW,
    distDir,
    repoActionFn,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    server,
    baseUrl,
    tmpDir,
    distDir,
    cacheFile,
    scanFn: usedScanFn,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

/** Raw GET bypassing any client-side URL normalization (unlike fetch()). */
function rawGet(baseUrl, rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: rawPath, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** @param {string} raw SSE frame text @returns {object[]} parsed data events in order */
function parseSseFrames(raw) {
  const events = [];
  for (const chunk of raw.split('\n\n')) {
    const line = chunk.split('\n').find((l) => l.startsWith('data: '));
    if (line) events.push(JSON.parse(line.slice('data: '.length)));
  }
  return events;
}

/**
 * Subscribes to the (persistent) SSE stream and reads until the terminal
 * 'done' event arrives, then disconnects CLIENT-side — the server keeps
 * the stream open, so reading "to completion" would hang forever. Also
 * the canonical way tests drain a background scan: 'done' is only sent
 * once the snapshot has landed in memory AND on disk (see server/index.js),
 * so afterEach can safely tear the fixture directory down afterwards.
 * Throws if no 'done' arrives within timeoutMs.
 */
async function collectSseUntilDone(url, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  try {
    outer: for (;;) {
      const { value, done } = await reader.read();
      if (done) break; // server closed — tolerated here, asserted elsewhere
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) {
          const event = JSON.parse(line.slice('data: '.length));
          events.push(event);
          if (event.phase === 'done') break outer;
        }
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`no terminal 'done' within ${timeoutMs}ms (got ${events.length} events)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

/**
 * Raw node:http SSE client that HOLDS the connection open for windowMs
 * (like a browser EventSource would), then reports everything observed:
 * parsed events in order plus whether the SERVER ended the stream. This is
 * the probe for the persistent-SSE contract — a server-closed 200 stream
 * makes EventSource auto-reconnect and replay-loop.
 * @returns {Promise<{ events: object[], serverEnded: boolean }>}
 */
function holdSse(baseUrl, windowMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: '/api/scan-events', method: 'GET' },
      (res) => {
        let raw = '';
        let serverEnded = false;
        res.setEncoding('utf8');
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          serverEnded = true;
        });
        setTimeout(() => {
          resolve({ events: parseSseFrames(raw), serverEnded });
          req.destroy();
        }, windowMs);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** @type {Array<() => Promise<void>>} */
let cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn()));
  cleanups = [];
  cacheHooks.loadCacheDelayMs = 0;
});

/* ------------------------------------------------------------------ */
/* GET /api/atlas — cache-first                                        */
/* ------------------------------------------------------------------ */

describe('GET /api/atlas', () => {
  it('returns the empty shape (never 500) when nothing has been cached or scanned', async () => {
    const t = await startTestServer();
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/api/atlas`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ generatedAt: null, repos: [], attention: [] });
  });

  it('serves the cached Snapshot instantly, without invoking scanFn', async () => {
    const t = await startTestServer({ initialCache: fixtureSnapshot });
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/api/atlas`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixtureSnapshot);
    expect(t.scanFn.callCount()).toBe(0);
  });

  it('never lets a slow cache seed overwrite a fresher scan result (sequenced writers)', async () => {
    const STALE_NOW = '2020-01-01T00:00:00.000Z';
    // Slow cache seed: the stale bytes are read at boot but the promise
    // resolves only ~150ms later...
    cacheHooks.loadCacheDelayMs = 150;
    // ...while the scan completes in ~7ms.
    const scanFn = makeFixtureScanFn({ delayMs: 1 });
    const t = await startTestServer({
      scanFn,
      initialCache: { ...fixtureSnapshot, generatedAt: STALE_NOW },
    });
    cleanups.push(t.close);

    await fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' });
    const events = await collectSseUntilDone(`${t.baseUrl}/api/scan-events`);
    expect(events.at(-1).phase).toBe('done');

    // Let the delayed loadCache resolve AFTER the scan has landed.
    await sleep(250);

    const snapshot = await (await fetch(`${t.baseUrl}/api/atlas`)).json();
    expect(snapshot.generatedAt).toBe(FIXED_NOW); // not STALE_NOW
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/rescan — async + single-flight                            */
/* ------------------------------------------------------------------ */

describe('POST /api/rescan', () => {
  it('returns 202 {scanning:true} well before the scan completes', async () => {
    const scanFn = makeFixtureScanFn({ delayMs: 40 });
    const t = await startTestServer({ scanFn });
    cleanups.push(t.close);

    const started = Date.now();
    const res = await fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ scanning: true });
    // Full fixture scan takes (1 + 6) * 40ms = 280ms; the response must not
    // have waited anywhere near that.
    expect(elapsed).toBeLessThan(150);

    // Drain the still-running background scan to completion before the
    // test ends, so afterEach doesn't tear down the fixture directory out
    // from under an in-flight saveCache() write.
    await collectSseUntilDone(`${t.baseUrl}/api/scan-events`);
  });

  it('single-flights: a second POST while scanning reports back without starting a second scan', async () => {
    const scanFn = makeFixtureScanFn({ delayMs: 20 });
    const t = await startTestServer({ scanFn });
    cleanups.push(t.close);

    const [r1, r2] = await Promise.all([
      fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' }),
      fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' }),
    ]);
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(await r1.json()).toEqual({ scanning: true });
    expect(await r2.json()).toEqual({ scanning: true });

    // Drain to completion (rather than polling /api/atlas) so this test
    // never races saveCache()'s write against afterEach's directory
    // cleanup: the terminal 'done' is only sent once the scan has fully
    // landed, in memory and on disk (see server/index.js).
    const events = await collectSseUntilDone(`${t.baseUrl}/api/scan-events`);
    expect(events.at(-1).phase).toBe('done');
    expect(scanFn.callCount()).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/scan-events — SSE ordering + post-done freshness            */
/* ------------------------------------------------------------------ */

describe('GET /api/scan-events', () => {
  it('emits start, repo*, done in order; /api/atlas is fresh after done with no restart', async () => {
    const scanFn = makeFixtureScanFn({ delayMs: 15 });
    const t = await startTestServer({ scanFn });
    cleanups.push(t.close);

    const rescanRes = await fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' });
    expect(rescanRes.status).toBe(202);

    const events = await collectSseUntilDone(`${t.baseUrl}/api/scan-events`);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(isScanEvent(event)).toBe(true);
    expect(events[0].phase).toBe('start');
    expect(events.at(-1).phase).toBe('done');
    expect(events.slice(1, -1).every((e) => e.phase === 'repo')).toBe(true);

    const repoNamesInOrder = events.filter((e) => e.phase === 'repo').map((e) => e.repo);
    expect(repoNamesInOrder).toEqual(fixtureSnapshot.repos.map((r) => r.name));

    const last = events.at(-1);
    expect(last.done).toBe(fixtureSnapshot.repos.length);
    expect(last.total).toBe(fixtureSnapshot.repos.length);

    // After 'done', /api/atlas must already serve the fresh snapshot — no
    // server restart, no extra wait needed (SSE only ends once it's saved).
    const atlasRes = await fetch(`${t.baseUrl}/api/atlas`);
    const snapshot = await atlasRes.json();
    expect(snapshot.generatedAt).toBe(FIXED_NOW);
    expect(snapshot.repos.map((r) => r.id)).toEqual(fixtureSnapshot.repos.map((r) => r.id));

    // And it was actually persisted to cacheFile (survives a real restart).
    const onDisk = JSON.parse(await fs.readFile(t.cacheFile, 'utf8'));
    expect(onDisk.generatedAt).toBe(FIXED_NOW);
  });

  it('replays the current scan progress in order to a late subscriber', async () => {
    const scanFn = makeFixtureScanFn({ delayMs: 15 });
    const t = await startTestServer({ scanFn });
    cleanups.push(t.close);

    await fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' });
    // Let a couple of progress events land before subscribing.
    await sleep(25);

    const events = await collectSseUntilDone(`${t.baseUrl}/api/scan-events`);
    expect(events[0].phase).toBe('start');
    expect(events.at(-1).phase).toBe('done');
    expect(events.slice(1, -1).every((e) => e.phase === 'repo')).toBe(true);
    for (const event of events) expect(isScanEvent(event)).toBe(true);
  });

  it('emits nothing and stays open when no scan has ever run', async () => {
    const t = await startTestServer();
    cleanups.push(t.close);

    // R-015: previously this asserted the server closed the stream — that
    // very close is what made EventSource auto-reconnect forever. The
    // contract is now: nothing to say, but the stream stays open.
    const { events, serverEnded } = await holdSse(t.baseUrl, 200);
    expect(events).toEqual([]);
    expect(serverEnded).toBe(false);
  });

  it('delivers exactly one terminal done to a persistent subscriber held across a scan', async () => {
    const scanFn = makeFixtureScanFn({ delayMs: 10 });
    const t = await startTestServer({ scanFn });
    cleanups.push(t.close);

    // Subscribe FIRST and hold the connection like a browser EventSource;
    // the fixture scan takes ~(1 + 6) * 10ms = 70ms, so a 900ms window
    // leaves a long idle stretch after 'done' in which the old
    // end-after-done behavior (server-closed stream -> auto-reconnect ->
    // full stale replay) produced extra terminal 'done' events.
    const held = holdSse(t.baseUrl, 900);
    await sleep(20); // subscription established (headers flush immediately)
    const res = await fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' });
    expect(res.status).toBe(202);

    const { events, serverEnded } = await held;
    expect(events.filter((e) => e.phase === 'done')).toHaveLength(1);
    expect(events.at(-1).phase).toBe('done');
    for (const event of events) expect(isScanEvent(event)).toBe(true);
    // The server must NOT have ended the live stream after 'done'.
    expect(serverEnded).toBe(false);
  });

  it('replays no stale terminal done to a subscriber joining after the scan completed', async () => {
    const scanFn = makeFixtureScanFn({ delayMs: 10 });
    const t = await startTestServer({ scanFn });
    cleanups.push(t.close);

    await fetch(`${t.baseUrl}/api/rescan`, { method: 'POST' });
    // Run the scan fully to completion (snapshot swapped + cache saved).
    const liveEvents = await collectSseUntilDone(`${t.baseUrl}/api/scan-events`);
    expect(liveEvents.at(-1).phase).toBe('done');

    // A fresh subscriber during the idle period must get NOTHING — the
    // finished scan's retained events (ending in the terminal 'done')
    // must never be replayed — and the stream must stay open.
    const { events, serverEnded } = await holdSse(t.baseUrl, 300);
    expect(events).toEqual([]);
    expect(serverEnded).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/repo/:id — drill-down                                      */
/* ------------------------------------------------------------------ */

describe('GET /api/repo/:id', () => {
  it('returns the full RepoSummary for a known id', async () => {
    const t = await startTestServer({ initialCache: fixtureSnapshot });
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/api/repo/tide-tables`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      fixtureSnapshot.repos.find((r) => r.id === 'tide-tables'),
    );
  });

  it('404s for an unknown id', async () => {
    const t = await startTestServer({ initialCache: fixtureSnapshot });
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/api/repo/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/repo/:id/open/:action — local control panel               */
/* ------------------------------------------------------------------ */

describe('POST /api/repo/:id/open/:action', () => {
  it('opens only the scanned repository path for an allowlisted action', async () => {
    const repoActionFn = vi.fn().mockResolvedValue(undefined);
    const t = await startTestServer({ initialCache: fixtureSnapshot, repoActionFn });
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/api/repo/tide-tables/open/finder`, {
      method: 'POST',
      headers: { 'X-Repo-Atlas-Action': '1' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: 'finder' });
    const repo = fixtureSnapshot.repos.find((candidate) => candidate.id === 'tide-tables');
    expect(repoActionFn).toHaveBeenCalledWith(repo.path, 'finder');
  });

  it('rejects requests without the local-action header', async () => {
    const repoActionFn = vi.fn().mockResolvedValue(undefined);
    const t = await startTestServer({ initialCache: fixtureSnapshot, repoActionFn });
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/api/repo/tide-tables/open/terminal`, {
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect(repoActionFn).not.toHaveBeenCalled();
  });

  it('rejects unknown actions and unknown repositories', async () => {
    const repoActionFn = vi.fn().mockResolvedValue(undefined);
    const t = await startTestServer({ initialCache: fixtureSnapshot, repoActionFn });
    cleanups.push(t.close);

    const headers = { 'X-Repo-Atlas-Action': '1' };
    const badAction = await fetch(`${t.baseUrl}/api/repo/tide-tables/open/delete`, {
      method: 'POST', headers,
    });
    const badRepo = await fetch(`${t.baseUrl}/api/repo/does-not-exist/open/finder`, {
      method: 'POST', headers,
    });
    expect(badAction.status).toBe(400);
    expect(badRepo.status).toBe(404);
    expect(repoActionFn).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Static file serving (dist/)                                         */
/* ------------------------------------------------------------------ */

describe('static file serving', () => {
  it('serves index.html at /', async () => {
    const t = await startTestServer();
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('Repo Atlas');
  });

  it('serves correct mime types for .js, .css, .svg', async () => {
    const t = await startTestServer();
    cleanups.push(t.close);

    const js = await fetch(`${t.baseUrl}/assets/app.js`);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    const css = await fetch(`${t.baseUrl}/assets/app.css`);
    expect(css.headers.get('content-type')).toMatch(/text\/css/);
    const svg = await fetch(`${t.baseUrl}/assets/logo.svg`);
    expect(svg.headers.get('content-type')).toMatch(/image\/svg\+xml/);
  });

  it('falls back to index.html for an unknown client-side route', async () => {
    const t = await startTestServer();
    cleanups.push(t.close);

    const res = await fetch(`${t.baseUrl}/repos/tide-tables`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('Repo Atlas');
  });

  it('never serves a file outside dist for a raw traversal request', async () => {
    const t = await startTestServer();
    cleanups.push(t.close);

    for (const rawPath of ['/../secret', '/%2e%2e/secret', '/assets/../../secret']) {
      const res = await rawGet(t.baseUrl, rawPath);
      expect(res.body).not.toContain('TOP SECRET');
      // Resolves inside dist: falls back to index.html rather than leaking
      // the sibling file.
      expect(res.status).toBe(200);
      expect(res.body).toContain('Repo Atlas');
    }
  });
});
