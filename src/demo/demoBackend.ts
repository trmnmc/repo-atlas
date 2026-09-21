/**
 * demoBackend.ts — the static demo's in-browser stand-in for server/index.js.
 *
 * The hosted demo is one HTML file with no server. useAtlas reaches the
 * network only through `fetch` and `EventSource`, both resolved at mount, so
 * replacing those two globals BEFORE React renders covers every request the
 * app makes. App, useAtlas and every view stay unmodified.
 *
 * Routes mirror server/index.js handleRequest:
 *   GET  /api/atlas                  -> demoSnapshot
 *   POST /api/rescan                 -> 202 {scanning:true}, then a replayed scan
 *   GET  /api/scan-events            -> the fake EventSource below
 *   GET  /api/repo/:id               -> one repo, or 404
 *   POST /api/repo/:id/open/:action  -> 501: a web page cannot open Finder
 */
import { demoSnapshot } from '../../shared/demoSnapshot.js';
import { ROUTES } from '../../shared/contract.js';
import type { ScanEvent } from '../../shared/contract.js';

interface DemoWindow {
  fetch: typeof fetch;
  EventSource: unknown;
}

interface MessageLike {
  data: string;
}
type MessageListener = (ev: MessageLike) => void;

const REPO_ACTION = /^\/api\/repo\/[^/]+\/open\/[^/]+$/;
const REPO_DETAIL = /^\/api\/repo\/([^/]+)$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : String(input);
  // file:// and https:// pages alike: only the path names the route.
  return new URL(raw, 'http://demo.invalid').pathname;
}

export function installDemoBackend(win: DemoWindow, { stepMs = 140 } = {}): void {
  const networkFetch = win.fetch;
  const listeners = new Set<MessageListener>();
  let scanning = false;

  function emit(event: ScanEvent): void {
    const message = { data: JSON.stringify(event) };
    for (const listener of [...listeners]) listener(message);
  }

  function startScan(): void {
    if (scanning) return; // single-flight, like the server
    scanning = true;
    const repos = demoSnapshot.repos;
    const total = repos.length;
    emit({ phase: 'start', done: 0, total });
    repos.forEach((repo, index) => {
      setTimeout(
        () => emit({ phase: 'repo', repo: repo.name, done: index + 1, total }),
        stepMs * (index + 1),
      );
    });
    setTimeout(
      () => {
        scanning = false;
        emit({ phase: 'done', done: total, total });
      },
      stepMs * (total + 1),
    );
  }

  class DemoEventSource {
    private readonly own = new Set<MessageListener>();

    constructor(_url: string) {}

    addEventListener(type: string, listener: MessageListener): void {
      if (type !== 'message') return;
      this.own.add(listener);
      listeners.add(listener);
    }

    removeEventListener(type: string, listener: MessageListener): void {
      if (type !== 'message') return;
      this.own.delete(listener);
      listeners.delete(listener);
    }

    close(): void {
      for (const listener of this.own) listeners.delete(listener);
      this.own.clear();
    }
  }

  win.EventSource = DemoEventSource;

  win.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = pathOf(input);
    if (!path.startsWith('/api/')) return networkFetch(input, init);

    if (path === ROUTES.atlas) return json(demoSnapshot);
    if (path === ROUTES.rescan) {
      startScan();
      return json({ scanning: true }, 202);
    }
    if (REPO_ACTION.test(path)) {
      return json({ error: 'not available in the hosted demo' }, 501);
    }
    const detail = REPO_DETAIL.exec(path);
    if (detail) {
      const id = decodeURIComponent(detail[1]);
      const repo = demoSnapshot.repos.find((r) => r.id === id);
      return repo ? json(repo) : json({ error: `no repo with id "${id}"` }, 404);
    }
    return json({ error: 'not found' }, 404);
  };
}
