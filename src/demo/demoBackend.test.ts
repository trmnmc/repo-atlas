/**
 * demoBackend.test.ts — the static demo's in-browser stand-in for the server.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installDemoBackend } from './demoBackend.ts';
import { demoSnapshot } from '../../shared/demoSnapshot.js';
import { ROUTES, isScanEvent } from '../../shared/contract.js';

interface FakeWindow {
  fetch: typeof fetch;
  EventSource: unknown;
}

function makeWindow(): { win: FakeWindow; networkFetch: ReturnType<typeof vi.fn> } {
  const networkFetch = vi.fn(async () => new Response('network', { status: 200 }));
  const win: FakeWindow = { fetch: networkFetch as unknown as typeof fetch, EventSource: undefined };
  return { win, networkFetch };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('installDemoBackend', () => {
  it('serves the demo snapshot from GET /api/atlas', async () => {
    const { win, networkFetch } = makeWindow();
    installDemoBackend(win);
    const res = await win.fetch(ROUTES.atlas);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual(demoSnapshot);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('answers a rescan and streams a full scan over the fake EventSource', async () => {
    vi.useFakeTimers();
    const { win } = makeWindow();
    installDemoBackend(win, { stepMs: 50 });

    const Source = win.EventSource as new (url: string) => {
      addEventListener(type: 'message', cb: (ev: { data: string }) => void): void;
      close(): void;
    };
    const events: unknown[] = [];
    const source = new Source(ROUTES.scanEvents);
    source.addEventListener('message', (ev) => events.push(JSON.parse(ev.data)));

    const res = await win.fetch(ROUTES.rescan, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ scanning: true });

    await vi.runAllTimersAsync();
    const total = demoSnapshot.repos.length;
    expect(events.every(isScanEvent)).toBe(true);
    expect(events[0]).toEqual({ phase: 'start', done: 0, total });
    expect(events.at(-1)).toEqual({ phase: 'done', done: total, total });
    expect(events).toHaveLength(total + 2);
  });

  it('stops delivering to a closed EventSource', async () => {
    vi.useFakeTimers();
    const { win } = makeWindow();
    installDemoBackend(win, { stepMs: 50 });
    const Source = win.EventSource as new (url: string) => {
      addEventListener(type: 'message', cb: (ev: { data: string }) => void): void;
      close(): void;
    };
    const events: unknown[] = [];
    const source = new Source(ROUTES.scanEvents);
    source.addEventListener('message', (ev) => events.push(ev));
    source.close();
    await win.fetch(ROUTES.rescan, { method: 'POST' });
    await vi.runAllTimersAsync();
    expect(events).toEqual([]);
  });

  it('refuses native actions honestly: a hosted page cannot open Finder', async () => {
    const { win } = makeWindow();
    installDemoBackend(win);
    const res = await win.fetch('/api/repo/ember-ledger/open/finder', { method: 'POST' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });

  it('serves one repo from GET /api/repo/:id and 404s an unknown id', async () => {
    const { win } = makeWindow();
    installDemoBackend(win);
    const hit = await win.fetch('/api/repo/ember-ledger');
    expect(await hit.json()).toEqual(demoSnapshot.repos.find((r) => r.id === 'ember-ledger'));
    const miss = await win.fetch('/api/repo/nope');
    expect(miss.status).toBe(404);
  });

  it('passes every non-API request through to the network', async () => {
    const { win, networkFetch } = makeWindow();
    installDemoBackend(win);
    await win.fetch('/assets/logo.svg');
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });
});
