/**
 * hooks.test.tsx — component-mount tests for every exported hook.
 *
 * useAtlas is exercised against a mock INJECTED transport (never a real
 * EventSource, which jsdom doesn't implement) that pushes contract
 * ScanEvents, plus a mocked global fetch that resolves with the canonical
 * fixture Snapshot — asserting the atomic swap (snapshot unchanged across
 * 'start'/'repo', updated only after 'done'), that rescan() POSTs to
 * ROUTES.rescan, and the polling fallback when transport is null.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAtlas } from './useAtlas.ts';
import type { AtlasTransport, ScanEvent } from './useAtlas.ts';
import { useTheme } from './useTheme.ts';
import { useKeyboardNav } from './useKeyboardNav.ts';
import { ROUTES } from '../../shared/contract.js';
import { fixtureSnapshot } from '../../shared/fixtures.js';

/* ------------------------------------------------------------------
   Shared test helpers
   ------------------------------------------------------------------ */

/** Minimal Response-shaped stub — only `json()` is ever called on it. */
function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

/** A transport whose subscribe() is manually driven by the test. */
function createMockTransport(): {
  transport: AtlasTransport;
  push: (event: ScanEvent) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let handler: ((event: ScanEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    transport: {
      subscribe(onEvent) {
        handler = onEvent;
        return unsubscribe;
      },
    },
    push(event) {
      handler?.(event);
    },
    unsubscribe,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

/* ------------------------------------------------------------------
   useAtlas
   ------------------------------------------------------------------ */

function AtlasProbe({ transport }: { transport?: AtlasTransport | null }) {
  const { snapshot, scanning, progress, rescan } = useAtlas({ transport });
  return (
    <div>
      <span data-testid="generatedAt">{snapshot?.generatedAt ?? 'none'}</span>
      <span data-testid="scanning">{String(scanning)}</span>
      <span data-testid="progress">{`${progress.done}/${progress.total}`}</span>
      <button onClick={() => rescan()}>Rescan</button>
    </div>
  );
}

describe('useAtlas', () => {
  it('mounts cleanly and loads the initial snapshot from GET /api/atlas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtureSnapshot));
    vi.stubGlobal('fetch', fetchMock);
    const { transport } = createMockTransport();

    render(<AtlasProbe transport={transport} />);

    await waitFor(() =>
      expect(screen.getByTestId('generatedAt').textContent).toBe(fixtureSnapshot.generatedAt),
    );
    expect(fetchMock).toHaveBeenCalledWith(ROUTES.atlas);
  });

  it('swaps snapshot ATOMICALLY only on the terminal done event, not mid-scan', async () => {
    const rescannedSnapshot = { ...fixtureSnapshot, generatedAt: '2026-08-02T00:00:00.000Z' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fixtureSnapshot)) // initial GET /api/atlas
      .mockResolvedValueOnce(jsonResponse(rescannedSnapshot)); // refetch after 'done'
    vi.stubGlobal('fetch', fetchMock);
    const mock = createMockTransport();

    render(<AtlasProbe transport={mock.transport} />);
    await waitFor(() =>
      expect(screen.getByTestId('generatedAt').textContent).toBe(fixtureSnapshot.generatedAt),
    );

    act(() => mock.push({ phase: 'start', done: 0, total: 6 }));
    expect(screen.getByTestId('generatedAt').textContent).toBe(fixtureSnapshot.generatedAt);
    expect(screen.getByTestId('scanning').textContent).toBe('true');
    expect(screen.getByTestId('progress').textContent).toBe('0/6');

    act(() => mock.push({ phase: 'repo', repo: 'ember-ledger', done: 1, total: 6 }));
    // Mid-scan: snapshot must NOT have been patched incrementally.
    expect(screen.getByTestId('generatedAt').textContent).toBe(fixtureSnapshot.generatedAt);
    expect(screen.getByTestId('progress').textContent).toBe('1/6');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => mock.push({ phase: 'done', done: 6, total: 6 }));
    await waitFor(() =>
      expect(screen.getByTestId('generatedAt').textContent).toBe(rescannedSnapshot.generatedAt),
    );
    expect(screen.getByTestId('scanning').textContent).toBe('false');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rescan() fires a POST to /api/rescan', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fixtureSnapshot)) // initial GET
      .mockResolvedValueOnce(jsonResponse({ scanning: true })); // POST /api/rescan
    vi.stubGlobal('fetch', fetchMock);
    const mock = createMockTransport();

    render(<AtlasProbe transport={mock.transport} />);
    await waitFor(() =>
      expect(screen.getByTestId('generatedAt').textContent).toBe(fixtureSnapshot.generatedAt),
    );

    fireEvent.click(screen.getByText('Rescan'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(ROUTES.rescan, { method: 'POST' }),
    );
    await waitFor(() => expect(screen.getByTestId('scanning').textContent).toBe('true'));
  });

  it('falls back to polling GET /api/atlas on an interval while scanning when transport is null', async () => {
    vi.useFakeTimers();
    const polledSnapshot = { ...fixtureSnapshot, generatedAt: '2026-08-02T00:00:00.000Z' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fixtureSnapshot)) // initial GET /api/atlas
      .mockResolvedValueOnce(jsonResponse({ scanning: true })) // POST /api/rescan
      .mockResolvedValueOnce(jsonResponse(polledSnapshot)); // first poll tick
    vi.stubGlobal('fetch', fetchMock);

    render(<AtlasProbe transport={null} />);

    // Flush the initial mount fetch (no EventSource/mock transport at all).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('generatedAt').textContent).toBe(fixtureSnapshot.generatedAt);

    await act(async () => {
      fireEvent.click(screen.getByText('Rescan'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('scanning').textContent).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith(ROUTES.rescan, { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial GET + POST rescan, no poll tick yet

    // Advance past the poll interval — the fallback should hit /api/atlas.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(ROUTES.atlas);
    expect(screen.getByTestId('generatedAt').textContent).toBe(polledSnapshot.generatedAt);
    expect(screen.getByTestId('scanning').textContent).toBe('false');
  });
});

/* ------------------------------------------------------------------
   useTheme
   ------------------------------------------------------------------ */

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>Toggle</button>
    </div>
  );
}

describe('useTheme', () => {
  it('mounts cleanly, applies [data-theme] to documentElement, and defaults to prefers-color-scheme', () => {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMediaMock);

    render(<ThemeProbe />);

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggles light/dark and persists the choice to localStorage', () => {
    render(<ThemeProbe />);
    const before = screen.getByTestId('theme').textContent;

    fireEvent.click(screen.getByText('Toggle'));

    const after = screen.getByTestId('theme').textContent;
    expect(after).not.toBe(before);
    expect(document.documentElement.getAttribute('data-theme')).toBe(after);
    expect(window.localStorage.getItem('atlas-theme')).toBe(after);
  });

  it('reads a previously persisted theme back on mount', () => {
    window.localStorage.setItem('atlas-theme', 'dark');
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });
});

/* ------------------------------------------------------------------
   useKeyboardNav
   ------------------------------------------------------------------ */

function KeyboardNavProbe({ itemCount, onSelect }: { itemCount: number; onSelect: (i: number) => void }) {
  const { activeIndex } = useKeyboardNav({ itemCount, onSelect });
  return (
    <div>
      <span data-testid="active">{activeIndex}</span>
      <input data-testid="filter" type="text" />
    </div>
  );
}

describe('useKeyboardNav', () => {
  it('mounts cleanly at index 0', () => {
    render(<KeyboardNavProbe itemCount={3} onSelect={() => {}} />);
    expect(screen.getByTestId('active').textContent).toBe('0');
  });

  it('moves the active index with j/k and arrow keys, clamped to bounds', () => {
    render(<KeyboardNavProbe itemCount={3} onSelect={() => {}} />);

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('active').textContent).toBe('1');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('active').textContent).toBe('2');

    // Already at the last index — stays clamped.
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('active').textContent).toBe('2');

    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByTestId('active').textContent).toBe('1');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByTestId('active').textContent).toBe('0');
  });

  it('calls onSelect with the active index on Enter', () => {
    const onSelect = vi.fn();
    render(<KeyboardNavProbe itemCount={3} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('ignores j/k/arrow/Enter keystrokes while an input is focused', () => {
    const onSelect = vi.fn();
    render(<KeyboardNavProbe itemCount={3} onSelect={onSelect} />);
    const input = screen.getByTestId('filter');
    input.focus();

    fireEvent.keyDown(input, { key: 'j' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('active').textContent).toBe('0');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
