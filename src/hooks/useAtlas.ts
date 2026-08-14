/**
 * useAtlas — the dashboard's single data hook.
 *
 * Loads the Snapshot from GET /api/atlas, then follows a scan's progress
 * over an injectable transport (shape `{ subscribe(onEvent): unsubscribe }`)
 * defaulting lazily to an EventSource-backed impl against
 * ROUTES.scanEvents — created ONLY in the browser (typeof EventSource
 * check), never at import time, so this module is safe to import under
 * jsdom/SSR without EventSource existing.
 *
 * Data swap is ATOMIC: the held `snapshot` is replaced only once, on the
 * scan's terminal 'done' event (after which /api/atlas is refetched) — it
 * is never patched incrementally from 'start'/'repo' events. When the
 * transport is unavailable (injected as `null`, or the browser has no
 * EventSource), useAtlas falls back to polling GET /api/atlas on an
 * interval while a scan is in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ROUTES } from '../../shared/contract.js';

/** @see shared/contract.js ScanEvent typedef — mirrored here for TS callers. */
export interface ScanEvent {
  phase: 'start' | 'repo' | 'done';
  repo?: string;
  done: number;
  total: number;
}

/**
 * Structural mirror of shared/contract.js's Snapshot typedef.
 *
 * generatedAt is null before any scan has ever completed (server's
 * emptySnapshot()) — callers must treat that as "no snapshot yet", not as
 * a survey dated at the epoch.
 */
export interface Snapshot {
  generatedAt: string | null;
  repos: unknown[];
  attention: unknown[];
}

/** Injectable transport shape: subscribe returns its own unsubscribe. */
export interface AtlasTransport {
  subscribe(onEvent: (event: ScanEvent) => void): () => void;
}

/** How often the polling fallback re-checks /api/atlas while scanning. */
const POLL_INTERVAL_MS = 1500;

function createEventSourceTransport(): AtlasTransport | null {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return null;
  }
  return {
    subscribe(onEvent) {
      const source = new EventSource(ROUTES.scanEvents);
      const handleMessage = (ev: MessageEvent) => {
        try {
          onEvent(JSON.parse(ev.data) as ScanEvent);
        } catch {
          // Malformed/partial event — ignore, next event will resync.
        }
      };
      source.addEventListener('message', handleMessage);
      return () => {
        source.removeEventListener('message', handleMessage);
        source.close();
      };
    },
  };
}

export interface UseAtlasOptions {
  /**
   * Omit to use the lazily-created EventSource-backed default. Pass `null`
   * explicitly to force the polling fallback (also what the default falls
   * back to when EventSource doesn't exist, e.g. in jsdom).
   */
  transport?: AtlasTransport | null;
}

export interface UseAtlasResult {
  snapshot: Snapshot | null;
  scanning: boolean;
  progress: { done: number; total: number };
  rescan: () => Promise<void>;
}

export function useAtlas(options: UseAtlasOptions = {}): UseAtlasResult {
  const { transport: injectedTransport } = options;

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Resolved once per mount: explicit injection wins, otherwise the lazy
  // browser-only EventSource default (never constructed under jsdom/SSR).
  const transportRef = useRef<AtlasTransport | null>();
  if (transportRef.current === undefined) {
    transportRef.current =
      injectedTransport !== undefined ? injectedTransport : createEventSourceTransport();
  }
  const transport = transportRef.current;

  const fetchSnapshot = useCallback(async () => {
    const res = await fetch(ROUTES.atlas);
    const data = (await res.json()) as Snapshot;
    setSnapshot(data);
    return data;
  }, []);

  // Initial load, independent of transport.
  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  // SSE (or injected mock) path: progress updates freely, but the snapshot
  // itself only ever swaps on the terminal 'done' event.
  useEffect(() => {
    if (!transport) return undefined;
    const unsubscribe = transport.subscribe((event) => {
      setProgress({ done: event.done, total: event.total });
      if (event.phase === 'done') {
        setScanning(false);
        fetchSnapshot();
      } else {
        setScanning(true);
      }
    });
    return unsubscribe;
  }, [transport, fetchSnapshot]);

  // Polling fallback: only when there is no transport at all. Each tick
  // refetches /api/atlas; the resulting snapshot replacement is itself the
  // atomic swap (a single setSnapshot call from a resolved fetch), and the
  // scan is considered complete once that refreshed data is in hand.
  useEffect(() => {
    if (transport) return undefined;
    if (!scanning) return undefined;
    const id = setInterval(() => {
      fetchSnapshot().then(() => setScanning(false));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [transport, scanning, fetchSnapshot]);

  const rescan = useCallback(async () => {
    const res = await fetch(ROUTES.rescan, { method: 'POST' });
    const data = (await res.json()) as { scanning?: boolean };
    if (data && data.scanning) {
      setScanning(true);
      setProgress({ done: 0, total: 0 });
    }
  }, []);

  return { snapshot, scanning, progress, rescan };
}
