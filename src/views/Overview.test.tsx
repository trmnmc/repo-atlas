/**
 * Overview.test.tsx — mount tests for the app shell and the Overview folio,
 * on the ONE canonical fixture Snapshot (shared/fixtures.js).
 *
 * Every expected value below is hand-computed from the fixture and written
 * as a literal, so a regression in a derivation cannot quietly redefine the
 * expectation. Reference instant: generatedAt = 2026-08-01T12:00:00.000Z,
 * which under the pinned TZ=America/Chicago is the local day 2026-08-01.
 *
 * Hand-computed table (verified against shared/fixtures.js):
 *
 *   repo           commits  LOC     dirty  upstream        last commit   age
 *   ember-ledger      431   9,726   yes    tracked 0/0     2026-07-31     1d
 *   field-notes       220   3,760   yes    tracked 0/1     2026-07-20    11d
 *   tide-tables       279   5,640   no     tracked 3/0     2026-07-26     5d
 *   old-survey         60  10,600   no     tracked 0/0     2026-01-10   202d  (stale)
 *   meridian          361   7,900   no     tracked 0/0     2026-07-29     4d
 *   drift-bottle       49   2,140   no     NONE            2026-07-15    17d  (no remote)
 *
 *   aggregate commits: 1,400 across 281 charted days
 *   aggregate 2026-07-15: 8 commits
 *   commits in 2026-08 (the survey month): 0
 *   dirty trees: 2 · most active: ember-ledger (431)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App, aggregateCommitDays, parseHash } from '../App.tsx';
import { Overview } from './Overview.tsx';
import { SURVEYING_LABEL } from '../components/ScanBar.tsx';
import { CSS, ROUTES, sortAttention } from '../../shared/contract.js';
import { fixtureSnapshot } from '../../shared/fixtures.js';
import type { AtlasTransport, ScanEvent } from '../hooks/useAtlas.ts';

/* ------------------------------------------------------------------
   Harness
   ------------------------------------------------------------------ */

/** Minimal Response-shaped stub — only `json()` is ever called on it. */
function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

/** Routes GET /api/atlas to the fixture and POST /api/rescan to a live scan. */
function stubAtlasFetch() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === ROUTES.rescan) return jsonResponse({ scanning: true });
    return jsonResponse(fixtureSnapshot);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A transport whose subscribe() is driven by the test, like hooks.test.tsx. */
function createMockTransport(): { transport: AtlasTransport; push: (event: ScanEvent) => void } {
  let handler: ((event: ScanEvent) => void) | null = null;
  return {
    transport: {
      subscribe(onEvent) {
        handler = onEvent;
        return () => {
          handler = null;
        };
      },
    },
    push(event) {
      handler?.(event);
    },
  };
}

/** Mount the whole shell and wait for the snapshot to land. */
async function mountApp(transport: AtlasTransport | null = null) {
  const view = render(<App transport={transport} />);
  await screen.findByText('Gazetteer of Repositories');
  return view;
}

/** Props for a direct Overview mount — the shell's wiring, spelled out. */
function overviewProps(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: fixtureSnapshot,
    aggregateCommitDays: aggregateCommitDays(fixtureSnapshot.repos as never),
    filterDay: undefined,
    onDayClick: () => {},
    scanning: false,
    progress: { done: 0, total: 0 },
    onRescan: () => {},
    onSelectRepo: () => {},
    ...overrides,
  } as never;
}

function repoIds(nodes: ArrayLike<Element>): string[] {
  return Array.from(nodes).map((node) => node.getAttribute('data-repo-id') ?? '');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

/* ------------------------------------------------------------------
   Pure shell derivations
   ------------------------------------------------------------------ */

describe('shell derivations', () => {
  it('parseHash maps #/repo/<id> to the repo route and everything else to the overview', () => {
    expect(parseHash('')).toEqual({ kind: 'overview' });
    expect(parseHash('#/')).toEqual({ kind: 'overview' });
    expect(parseHash('#/nonsense')).toEqual({ kind: 'overview' });
    expect(parseHash('#/repo/ember-ledger')).toEqual({ kind: 'repo', id: 'ember-ledger' });
    expect(parseHash('#/repo/a%2Fb')).toEqual({ kind: 'repo', id: 'a/b' });
  });

  it('aggregateCommitDays sums every repo\'s commitDays (1,400 commits over 281 days)', () => {
    const aggregate = aggregateCommitDays(fixtureSnapshot.repos as never);
    const days = Object.keys(aggregate);
    expect(days.length).toBe(281);
    expect(Object.values(aggregate).reduce((a, b) => a + b, 0)).toBe(1400);
    // 2026-07-15 is charted by drift-bottle AND others; the sum, not either one.
    expect(aggregate['2026-07-15']).toBe(8);
    expect(aggregate['2026-07-15']).toBeGreaterThan(
      (fixtureSnapshot.repos[5].commitDays as Record<string, number>)['2026-07-15'] ?? 0,
    );
  });
});

/* ------------------------------------------------------------------
   Folio structure
   ------------------------------------------------------------------ */

describe('Overview folio', () => {
  it('renders the masthead with the edition date in mono', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    expect(container.querySelector('.masthead__title')?.textContent).toBe('Repo Atlas');
    expect(container.querySelector('.masthead__subtitle')?.textContent).toBe(
      'A Survey of the Projects Directory',
    );
    const edition = container.querySelector('.masthead__edition-date');
    // TZ is pinned to America/Chicago, so 2026-08-01T12:00Z is 2026-08-01 local.
    expect(edition?.textContent).toBe('2026-08-01');
    expect(edition?.classList.contains(CSS.sounding)).toBe(true);
    expect(edition?.getAttribute('data-generated-at')).toBe('2026-08-01T12:00:00.000Z');
  });

  it('composes exactly five numbered plates, captioned in folio order', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const captions = Array.from(container.querySelectorAll(`.${CSS.plateCaption}`)).map(
      (node) => node.textContent,
    );
    expect(captions).toEqual([
      'Fig. 1Notices to Mariners',
      'Fig. 2Commit Soundings',
      'Fig. 3The Year\'s Passage',
      'Fig. 4Legend & Reckonings',
      'Fig. 5Gazetteer of Repositories',
    ]);
    expect(container.querySelectorAll(`.${CSS.plate}`).length).toBe(5);
  });

  /* --------------------------------------------------------------
     The spec's first-screen promise: attention BEFORE wallpaper.
     -------------------------------------------------------------- */
  it('places the attention queue STRICTLY above the heatmap and timeline in DOM order', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const queue = container.querySelector('.attention-queue');
    const heatmap = container.querySelector('.chart-heatmap');
    const timeline = container.querySelector('.chart-timeline');
    expect(queue).not.toBeNull();
    expect(heatmap).not.toBeNull();
    expect(timeline).not.toBeNull();

    const heatmapFollowsQueue =
      queue!.compareDocumentPosition(heatmap!) & Node.DOCUMENT_POSITION_FOLLOWING;
    const timelineFollowsHeatmap =
      heatmap!.compareDocumentPosition(timeline!) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(heatmapFollowsQueue).toBeTruthy();
    expect(timelineFollowsHeatmap).toBeTruthy();
  });
});

/* ------------------------------------------------------------------
   Fig. 1 — Notices to Mariners
   ------------------------------------------------------------------ */

describe('Fig. 1 — attention queue', () => {
  it('renders the queue in exact server-delivered order, with reason badges and ages', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const ranked = container.querySelectorAll('.attention-queue__row[data-ranked="true"]');
    expect(repoIds(ranked)).toEqual(['ember-ledger', 'field-notes', 'tide-tables', 'old-survey']);
    expect(repoIds(ranked)).toEqual(fixtureSnapshot.attention.map((entry) => entry.repoId));

    expect(Array.from(ranked).map((row) => row.getAttribute('data-reason'))).toEqual([
      'dirty',
      'dirty',
      'unpushed',
      'stale',
    ]);

    // Badge, repo name, branch and relative age all present on the top row.
    const first = ranked[0];
    expect(first.querySelector('.advisory-reason')?.textContent).toBe('dirty');
    expect(first.querySelector('.attention-queue__name')?.textContent).toBe('ember-ledger');
    expect(first.querySelector('.attention-queue__branch')?.textContent).toBe('main');
    // 2026-08-01T12:00Z minus 2026-07-31T09:14Z = 1.11 days -> floor 1.
    expect(first.querySelector('.attention-queue__age')?.textContent).toBe('1d');

    // Ages, hand-computed for every ranked row.
    expect(
      Array.from(ranked).map((row) => row.querySelector('.attention-queue__age')?.textContent),
    ).toEqual(['1d', '11d', '5d', '202d']);

    // Each ranked row carries its contract advisory classes.
    expect(first.classList.contains(CSS.advisory)).toBe(true);
    expect(first.classList.contains(CSS.advisoryDirty)).toBe(true);
  });

  /* --------------------------------------------------------------
     The ordering claim only bites against an order that CONTRADICTS
     the comparator: the fixture's own attention array is already
     sorted, so rendering it proves nothing about re-sorting. Feed a
     deliberately scrambled queue and demand it comes back scrambled.
     -------------------------------------------------------------- */
  it('never re-sorts client-side: a scrambled queue renders scrambled', () => {
    const scrambled = [
      fixtureSnapshot.attention[3], // stale(old-survey)   — would sort LAST
      fixtureSnapshot.attention[2], // unpushed(tide-tables)
      fixtureSnapshot.attention[1], // dirty(field-notes)
      fixtureSnapshot.attention[0], // dirty(ember-ledger) — would sort FIRST
    ];
    // Sanity: this order genuinely contradicts the contract comparator.
    expect(sortAttention(scrambled).map((entry) => entry.repoId)).not.toEqual(
      scrambled.map((entry) => entry.repoId),
    );

    const { container } = render(
      <Overview
        {...overviewProps({ snapshot: { ...fixtureSnapshot, attention: scrambled } })}
      />,
    );

    const ranked = container.querySelectorAll('.attention-queue__row[data-ranked="true"]');
    expect(repoIds(ranked)).toEqual(['old-survey', 'tide-tables', 'field-notes', 'ember-ledger']);
  });

  /* --------------------------------------------------------------
     server/attention.js emits the epoch (1970-01-01) as the activity
     instant for a dirty repo with NO commits — a deterministic sort
     floor, not a real date. Aged naively it reads "20679d"; the row
     must show the Gazetteer's no-commit marker instead.
     -------------------------------------------------------------- */
  it('shows an em-dash, never a days-since-epoch age, for the zero-commit epoch fallback', () => {
    const withEpoch = [
      { repoId: 'meridian', reason: 'dirty' as const, lastActivityIso: '1970-01-01T00:00:00.000Z' },
      ...fixtureSnapshot.attention,
    ];

    const { container } = render(
      <Overview {...overviewProps({ snapshot: { ...fixtureSnapshot, attention: withEpoch } })} />,
    );

    const row = container.querySelector('.attention-queue__row[data-repo-id="meridian"]');
    expect(row).not.toBeNull();
    const age = row!.querySelector('.attention-queue__age');
    expect(age?.textContent).toBe('—');
    expect(age?.textContent).not.toMatch(/\d+d/);
    // The rest of the row is untouched.
    expect(row!.querySelector('.advisory-reason')?.textContent).toBe('dirty');
    expect(row!.querySelector('.attention-queue__name')?.textContent).toBe('meridian');
    // Real activity instants still age normally on every other row.
    expect(
      container
        .querySelector('.attention-queue__row[data-repo-id="ember-ledger"] .attention-queue__age')
        ?.textContent,
    ).toBe('1d');
  });

  it('shows a no-remote badge, in ink, below the ranked notices — never "unpushed"', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const notice = container.querySelector('.attention-queue__row[data-reason="no-remote"]');
    expect(notice).not.toBeNull();
    expect(notice!.getAttribute('data-repo-id')).toBe('drift-bottle');
    expect(notice!.getAttribute('data-ranked')).toBe('false');
    expect(notice!.querySelector('.advisory-reason')?.textContent).toBe('no remote');
    expect(notice!.textContent).not.toContain('unpushed');
    // CSS.advisoryNoRemote is the ink-only marker; the vermilion attention
    // modifiers must be absent from this row.
    expect(notice!.classList.contains(CSS.advisoryNoRemote)).toBe(true);
    expect(notice!.classList.contains(CSS.advisoryUnpushed)).toBe(false);
    expect(notice!.classList.contains(CSS.advisoryDirty)).toBe(false);
    expect(notice!.classList.contains(CSS.advisoryStale)).toBe(false);

    // And it sits strictly below every server-ranked notice.
    const all = container.querySelectorAll('.attention-queue__row');
    expect(repoIds(all)).toEqual([
      'ember-ledger',
      'field-notes',
      'tide-tables',
      'old-survey',
      'drift-bottle',
    ]);
  });

  it('drills down on click and on j / Enter keyboard navigation', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const rows = container.querySelectorAll('.attention-queue__row');
    fireEvent.click(rows[2]); // tide-tables
    await waitFor(() => expect(window.location.hash).toBe('#/repo/tide-tables'));
    expect(await screen.findByText('tide-tables')).toBeTruthy();
    expect(screen.getByText('Ship\'s Log')).toBeTruthy();

    // Back to the folio, then keyboard-drive the queue: j moves to row 1.
    fireEvent.click(screen.getByText('← Back to atlas'));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    await screen.findByText('Notices to Mariners');

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(window.location.hash).toBe('#/repo/field-notes'));
  });
});

/* ------------------------------------------------------------------
   Figs. 2 & 3 — the aggregate cross-filter
   ------------------------------------------------------------------ */

describe('Figs. 2 & 3 — aggregate soundings and cross-filter', () => {
  it('charts the AGGREGATE commitDays, not any single repo\'s', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const cell = container.querySelector('[data-daykey="2026-07-15"]');
    expect(cell).not.toBeNull();
    // Aggregate for that day is 8; drift-bottle alone contributes fewer.
    expect(cell!.getAttribute('data-count')).toBe('8');
  });

  it('clicking a heatmap day narrows the timeline, and clicking it again clears', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const timeline = () => container.querySelector('.chart-timeline');
    expect(timeline()?.getAttribute('data-filter-day')).toBe('');

    fireEvent.click(container.querySelector('[data-daykey="2026-07-15"]')!);
    await waitFor(() =>
      expect(timeline()?.getAttribute('data-filter-day')).toBe('2026-07-15'),
    );
    expect(container.querySelector('.plate-footer')?.textContent).toContain(
      'narrowed to 2026-07-15',
    );

    fireEvent.click(container.querySelector('[data-daykey="2026-07-15"]')!);
    await waitFor(() => expect(timeline()?.getAttribute('data-filter-day')).toBe(''));
  });
});

/* ------------------------------------------------------------------
   Fig. 4 — Legend & Reckonings
   ------------------------------------------------------------------ */

describe('Fig. 4 — stats row', () => {
  it('reckons totals, this month\'s commits, the most-active repo and dirty trees', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const read = (key: string) =>
      container.querySelector(`[data-reckoning="${key}"] .reckoning__value`)?.textContent;

    expect(read('repos')).toBe('6');
    // The survey month is 2026-08; the fixture's newest commit day is 2026-07-29.
    expect(read('commits-month')).toBe('0');
    expect(
      container.querySelector('[data-reckoning="commits-month"] .reckoning__note')?.textContent,
    ).toBe('August 2026');
    expect(read('most-active')).toBe('ember-ledger');
    expect(
      container.querySelector('[data-reckoning="most-active"] .reckoning__note')?.textContent,
    ).toBe('431 commits charted');
    expect(read('dirty')).toBe('2');

    // Vermilion is reserved for attention states: the dirty count earns it,
    // the plain counts must not.
    expect(
      container
        .querySelector('[data-reckoning="dirty"] .reckoning__value')!
        .classList.contains('reckoning__value--attention'),
    ).toBe(true);
    expect(
      container
        .querySelector('[data-reckoning="repos"] .reckoning__value')!
        .classList.contains('reckoning__value--attention'),
    ).toBe(false);

    // Sparklines only where a trend is the point.
    expect(container.querySelectorAll('.reckoning .chart-sparkline').length).toBe(2);
  });
});

/* ------------------------------------------------------------------
   Fig. 5 — Gazetteer
   ------------------------------------------------------------------ */

describe('Fig. 5 — gazetteer', () => {
  it('lists EVERY fixture repo with branch, state chip, last commit and LOC', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const rows = container.querySelectorAll('.gazetteer__row');
    expect(rows.length).toBe(6);
    expect(repoIds(rows).slice().sort()).toEqual(
      fixtureSnapshot.repos.map((repo) => repo.id).slice().sort(),
    );

    const rowFor = (id: string) =>
      container.querySelector(`.gazetteer__row[data-repo-id="${id}"]`)!;

    const drift = rowFor('drift-bottle');
    expect(drift.querySelector('.gazetteer__cell--branch')?.textContent).toBe('main');
    expect(drift.querySelector('[data-chip="no-remote"]')?.textContent).toBe('no remote');
    expect(drift.textContent).not.toContain('unpushed');
    expect(drift.querySelector('.gazetteer__date')?.textContent).toBe('2026-07-15');
    expect(drift.querySelector('.gazetteer__age')?.textContent).toBe('17d');
    expect(drift.querySelector('.gazetteer__cell--loc')?.textContent).toBe('2,140');

    expect(rowFor('ember-ledger').querySelector('[data-chip="dirty"]')).not.toBeNull();
    expect(rowFor('tide-tables').querySelector('[data-chip="unpushed"]')?.textContent).toBe(
      'unpushed 3',
    );
    expect(rowFor('old-survey').querySelector('[data-chip="stale"]')).not.toBeNull();
    expect(rowFor('meridian').querySelector('[data-chip="clean"]')).not.toBeNull();
    expect(rowFor('old-survey').querySelector('.gazetteer__cell--loc')?.textContent).toBe(
      '10,600',
    );
  });

  it('search narrows the rows live and reports the count', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    const search = screen.getByLabelText('Search repositories');
    expect(container.querySelector('.gazetteer__count')?.textContent).toBe('6/6');

    fireEvent.change(search, { target: { value: 'tide' } });
    expect(repoIds(container.querySelectorAll('.gazetteer__row'))).toEqual(['tide-tables']);
    expect(container.querySelector('.gazetteer__count')?.textContent).toBe('1/6');

    // Search reaches languages too — Rust is drift-bottle's only language.
    fireEvent.change(search, { target: { value: 'rust' } });
    expect(repoIds(container.querySelectorAll('.gazetteer__row'))).toEqual(['drift-bottle']);

    fireEvent.change(search, { target: { value: 'no such repo' } });
    expect(container.querySelectorAll('.gazetteer__row').length).toBe(0);
    expect(container.querySelector('.gazetteer__empty')).not.toBeNull();

    fireEvent.change(search, { target: { value: '' } });
    expect(container.querySelectorAll('.gazetteer__row').length).toBe(6);
  });

  it('sorting by a column reorders the rows, and clicking again reverses', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    // Default: most recent activity first.
    expect(repoIds(container.querySelectorAll('.gazetteer__row'))).toEqual([
      'ember-ledger',
      'meridian',
      'tide-tables',
      'field-notes',
      'drift-bottle',
      'old-survey',
    ]);

    const head = container.querySelector('.gazetteer__head')!;
    fireEvent.click(within(head as HTMLElement).getByText('Repository'));
    expect(repoIds(container.querySelectorAll('.gazetteer__row'))).toEqual([
      'drift-bottle',
      'ember-ledger',
      'field-notes',
      'meridian',
      'old-survey',
      'tide-tables',
    ]);
    expect(
      container.querySelector('[data-sort-key="name"]')!.closest('[role="columnheader"]')!
        .getAttribute('aria-sort'),
    ).toBe('ascending');

    fireEvent.click(within(head as HTMLElement).getByText('Repository'));
    expect(repoIds(container.querySelectorAll('.gazetteer__row'))).toEqual([
      'tide-tables',
      'old-survey',
      'meridian',
      'field-notes',
      'ember-ledger',
      'drift-bottle',
    ]);

    // LOC: old-survey (10,600) leads, drift-bottle (2,140) trails.
    fireEvent.click(within(head as HTMLElement).getByText('Lines'));
    expect(repoIds(container.querySelectorAll('.gazetteer__row'))).toEqual([
      'old-survey',
      'ember-ledger',
      'meridian',
      'tide-tables',
      'field-notes',
      'drift-bottle',
    ]);
  });

  it('drills down when a row is clicked', async () => {
    stubAtlasFetch();
    const { container } = await mountApp();

    fireEvent.click(container.querySelector('.gazetteer__row[data-repo-id="meridian"]')!);
    await waitFor(() => expect(window.location.hash).toBe('#/repo/meridian'));
    expect(await screen.findByText('Charted Branches')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------
   ScanBar — rescan + live progress
   ------------------------------------------------------------------ */

describe('ScanBar', () => {
  it('fires a rescan POST when Rescan is clicked', async () => {
    const fetchMock = stubAtlasFetch();
    const { transport } = createMockTransport();
    await mountApp(transport);

    fireEvent.click(screen.getByRole('button', { name: 'Rescan the projects directory' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(ROUTES.rescan, { method: 'POST' }),
    );
  });

  it('shows n/total progress from scan events delivered over an injected transport', async () => {
    stubAtlasFetch();
    const { transport, push } = createMockTransport();
    const { container } = await mountApp(transport);

    // At rest there is no reading at all — no fake progress bar.
    expect(container.querySelector('.scanbar__reading')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rescan the projects directory' }));
    await screen.findByText(`${SURVEYING_LABEL} 0/0`);

    act(() => push({ phase: 'start', done: 0, total: 6 }));
    expect(screen.getByText(`${SURVEYING_LABEL} 0/6`)).toBeTruthy();

    act(() => push({ phase: 'repo', repo: 'tide-tables', done: 2, total: 6 }));
    const reading = container.querySelector('.scanbar__reading')!;
    expect(reading.textContent).toBe(`${SURVEYING_LABEL} 2/6`);
    expect(reading.getAttribute('data-done')).toBe('2');
    expect(reading.getAttribute('data-total')).toBe('6');
    // The sounding line has actually moved to 2/6 of its run.
    expect(container.querySelector('.scanbar__line')?.getAttribute('data-ratio')).toBe(
      String(2 / 6),
    );

    act(() => push({ phase: 'repo', repo: 'old-survey', done: 5, total: 6 }));
    expect(container.querySelector('.scanbar__reading')?.textContent).toBe(
      `${SURVEYING_LABEL} 5/6`,
    );

    // Terminal event ends the survey and the reading disappears.
    await act(async () => {
      push({ phase: 'done', done: 6, total: 6 });
    });
    await waitFor(() => expect(container.querySelector('.scanbar__reading')).toBeNull());
  });
});

/* ------------------------------------------------------------------
   Shell: routing + theme
   ------------------------------------------------------------------ */

describe('shell', () => {
  it('renders the drill-down straight from a #/repo/<id> deep link', async () => {
    stubAtlasFetch();
    window.history.replaceState(null, '', '/#/repo/old-survey');
    render(<App transport={null} />);

    expect(await screen.findByText('Strata of the Codebase')).toBeTruthy();
    expect(screen.getByText('old-survey')).toBeTruthy();
    expect(screen.queryByText('Gazetteer of Repositories')).toBeNull();
  });

  it('reports an uncharted repo id rather than rendering a broken drill-down', async () => {
    stubAtlasFetch();
    window.history.replaceState(null, '', '/#/repo/not-a-repo');
    render(<App transport={null} />);

    expect(await screen.findByText(/No repository charted under/)).toBeTruthy();
  });

  it('toggles the theme on the documentElement', async () => {
    stubAtlasFetch();
    await mountApp();

    const before = document.documentElement.getAttribute('data-theme');
    const toggle = screen.getByRole('button', { name: /Switch to (light|dark) theme/ });
    fireEvent.click(toggle);
    const after = document.documentElement.getAttribute('data-theme');

    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);
    expect(window.localStorage.getItem('atlas-theme')).toBe(after);
  });
});
