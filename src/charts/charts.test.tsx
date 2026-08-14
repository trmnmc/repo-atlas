/**
 * charts.test.tsx — mount tests for the hand-rolled SVG chart suite.
 *
 * Expected cell/level counts and month-label placements below are
 * HAND-COMPUTED from the canonical fixture Snapshot (shared/fixtures.js)
 * and the frozen contract dayKey — never by re-running Heatmap/Timeline's
 * own internals (which aren't exported). The derivation is spelled out in
 * comments so every literal is auditable against the fixture alone.
 *
 * Runs under TZ=America/Chicago (pinned via vite.config.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Heatmap } from './Heatmap.tsx';
import { Timeline } from './Timeline.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Strata } from './Strata.tsx';
import { CSS, dayKey } from '../../shared/contract.js';
import { fixtureSnapshot, fixtureRepo } from '../../shared/fixtures.js';

/* ------------------------------------------------------------------
   Heatmap
   ------------------------------------------------------------------

   Grid anchor: endDayKey = dayKey(fixtureSnapshot.generatedAt) = "2026-08-01".
   By hand: new Date(2026, 7, 1) is a SATURDAY (getDay() === 6) — checkable
   on any calendar, DST-independent since it's a local y/m/d construction.
   The grid is 53 columns (weeks, Sunday..Saturday) ending at that Saturday:
     lastColStart (Sunday of final week)  = 2026-07-26
     firstColStart (Sunday of week 0)     = 2025-07-27   (52 weeks earlier)
   So the window spans 2025-07-27 .. 2026-08-01 inclusive (371 days).

   ember-ledger's commitDays (per fixtures.js) spans 2025-08-01 .. 2026-07-31
   — entirely inside that window with room to spare on both ends — so every
   key in commitDays lands on exactly one grid cell and no key is dropped
   or double-counted. That means:
     nonzero cells (l1..l4) = Object.keys(commitDays).length
     zero cells (l0)        = 371 - that count
   The level rule (documented in Heatmap's JSDoc) is: 0 commits -> l0,
   otherwise min(count, 4) -> l1..l4. Tallying commitDays' own values
   (not Heatmap's rendered output) against that rule gives the expected
   per-level histogram below.
   ------------------------------------------------------------------ */

const emberDays = fixtureRepo('ember-ledger').commitDays;
const emberEnd = dayKey(fixtureSnapshot.generatedAt);

describe('Heatmap', () => {
  it('anchors the 53-week grid at endDayKey (hand-verified Saturday)', () => {
    expect(emberEnd).toBe('2026-08-01');
    expect(new Date(2026, 7, 1).getDay()).toBe(6); // Saturday
  });

  it('draws exactly 53 columns of 7 cells (371 total) from the fixture', () => {
    const { container } = render(
      <Heatmap commitDays={emberDays} endDayKey={emberEnd} onDayClick={() => {}} />,
    );
    const cells = container.querySelectorAll(`.${CSS.heatmapCell}`);
    expect(cells.length).toBe(371);
    const columns = container.querySelectorAll('.chart-heatmap__grid > g');
    expect(columns.length).toBe(53);
    columns.forEach((col) => {
      expect(col.querySelectorAll(`.${CSS.heatmapCell}`).length).toBe(7);
    });
  });

  it('draws the exact expected level histogram, hand-tallied from commitDays', () => {
    // Hand tally: bucket every commitDays value into its heatmap level.
    let l1 = 0;
    let l2 = 0;
    let l3 = 0;
    let l4 = 0;
    for (const count of Object.values(emberDays)) {
      const level = Math.min(count, 4);
      if (level === 1) l1++;
      else if (level === 2) l2++;
      else if (level === 3) l3++;
      else if (level === 4) l4++;
    }
    const nonzero = Object.keys(emberDays).length;
    expect(l1 + l2 + l3 + l4).toBe(nonzero);
    expect(nonzero).toBe(157); // hand count from fixtures.js's ember-ledger commitDays
    expect([l1, l2, l3, l4]).toEqual([35, 39, 35, 48]);
    const l0 = 371 - nonzero;
    expect(l0).toBe(214);

    const { container } = render(
      <Heatmap commitDays={emberDays} endDayKey={emberEnd} onDayClick={() => {}} />,
    );
    expect(container.querySelectorAll(`.${CSS.heatmapCell}--l0`).length).toBe(l0);
    expect(container.querySelectorAll(`.${CSS.heatmapCell}--l1`).length).toBe(l1);
    expect(container.querySelectorAll(`.${CSS.heatmapCell}--l2`).length).toBe(l2);
    expect(container.querySelectorAll(`.${CSS.heatmapCell}--l3`).length).toBe(l3);
    expect(container.querySelectorAll(`.${CSS.heatmapCell}--l4`).length).toBe(l4);
  });

  it('places month labels at hand-computed column starts', () => {
    // Hand-derived from firstColStart = 2025-07-27, stepping 7 days per
    // column and noting the column index whenever the calendar month of
    // that column's Sunday changes (a fresh calendar walk, not Heatmap's).
    const expected = [
      { col: 0, label: 'Jul' },
      { col: 1, label: 'Aug' },
      { col: 6, label: 'Sep' },
      { col: 10, label: 'Oct' },
      { col: 14, label: 'Nov' },
      { col: 19, label: 'Dec' },
      { col: 23, label: 'Jan' },
      { col: 27, label: 'Feb' },
      { col: 31, label: 'Mar' },
      { col: 36, label: 'Apr' },
      { col: 40, label: 'May' },
      { col: 45, label: 'Jun' },
      { col: 49, label: 'Jul' },
    ];

    const { container } = render(
      <Heatmap commitDays={emberDays} endDayKey={emberEnd} onDayClick={() => {}} />,
    );
    const labels = Array.from(container.querySelectorAll('.chart-heatmap__month'));
    expect(labels.length).toBe(expected.length);

    const CELL = 11;
    const GAP = 3;
    const STEP = CELL + GAP;
    labels.forEach((node, i) => {
      expect(node.textContent).toBe(expected[i].label);
      expect(node.getAttribute('x')).toBe(String(expected[i].col * STEP));
    });
  });

  it('clicking a day cell emits exactly that cell\'s contract dayKey', () => {
    // fixtures.js pins ember-ledger's commitDays; direct lookup (not
    // Heatmap's rendering) confirms 2026-01-22 has 3 commits, and by the
    // window math above it falls inside the rendered grid.
    expect(emberDays['2026-01-22']).toBe(3);

    const onDayClick = vi.fn();
    const { container } = render(
      <Heatmap commitDays={emberDays} endDayKey={emberEnd} onDayClick={onDayClick} />,
    );
    const cell = container.querySelector('[data-daykey="2026-01-22"]');
    expect(cell).not.toBeNull();
    fireEvent.click(cell);
    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(onDayClick).toHaveBeenCalledWith('2026-01-22');

    // clicking a different, zero-count cell emits ITS key, not the first's.
    const zeroCell = container.querySelector('[data-daykey="2026-02-24"]');
    expect(zeroCell).not.toBeNull();
    fireEvent.click(zeroCell);
    expect(onDayClick).toHaveBeenCalledTimes(2);
    expect(onDayClick).toHaveBeenLastCalledWith('2026-02-24');
  });

  it('Enter/Space on a focused cell also emits its dayKey (keyboard parity)', () => {
    const onDayClick = vi.fn();
    const { container } = render(
      <Heatmap commitDays={emberDays} endDayKey={emberEnd} onDayClick={onDayClick} />,
    );
    const cell = container.querySelector('[data-daykey="2026-01-22"]');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onDayClick).toHaveBeenCalledWith('2026-01-22');
  });

  it('renders safely on empty data (no commitDays, no endDayKey, no handler)', () => {
    expect(() => render(<Heatmap commitDays={{}} endDayKey="" />)).not.toThrow();
    const { container } = render(<Heatmap commitDays={{}} endDayKey="" />);
    const cells = container.querySelectorAll(`.${CSS.heatmapCell}`);
    expect(cells.length).toBe(371);
    expect(container.querySelectorAll(`.${CSS.heatmapCell}--l0`).length).toBe(371);
    // clicking still doesn't throw even with no onDayClick supplied.
    expect(() => fireEvent.click(cells[0])).not.toThrow();
  });

  it('an empty-activity window (empty commitDays + explicit endDayKey) still derives a sane, non-overlapping month-label row', () => {
    // Empty commitDays must not degenerate the window derivation — the
    // 53-week grid and its month labels are computed purely from
    // endDayKey, independent of commitDays. Anchor at a January day so the
    // window's left edge crosses a Dec/Jan year boundary, the exact spot
    // the look-pass flagged as stacked/overlapping.
    const { container } = render(<Heatmap commitDays={{}} endDayKey="2026-01-04" />);
    const labels = Array.from(container.querySelectorAll('.chart-heatmap__month'));
    expect(labels.length).toBeGreaterThan(1);

    const CELL = 11;
    const GAP = 3;
    const STEP = CELL + GAP;
    const xs = labels.map((node) => Number(node.getAttribute('x')));
    // Strictly increasing x positions...
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
      // ...and no two labels closer than one column width (no overlap).
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(STEP);
    }
    // The 53-week window is still fully derived (53 columns of the grid
    // structure) — an empty map doesn't shrink or corrupt it. (2026-01-04
    // is a Sunday, so its own week contributes only that one observed day;
    // the rest of that week is future and correctly omitted — see the
    // dedicated future-day test below.)
    const columns = container.querySelectorAll('.chart-heatmap__grid > g');
    expect(columns.length).toBe(53);
  });

  it('renders no cells after endDayKey — future days are not observed data', () => {
    // 2026-08-04 is a Tuesday (verified below), so the final column's
    // Wed/Thu/Fri/Sat (2026-08-05..08) fall after the snapshot day and
    // must not render as "0 commits" cells.
    expect(new Date(2026, 7, 4).getDay()).toBe(2); // Tuesday
    const { container } = render(<Heatmap commitDays={{}} endDayKey="2026-08-04" />);

    const allCells = container.querySelectorAll(`.${CSS.heatmapCell}`);
    // 4 future days (Wed..Sat) omitted from the otherwise-full 371-cell grid.
    expect(allCells.length).toBe(371 - 4);

    allCells.forEach((cell) => {
      const key = cell.getAttribute('data-daykey');
      expect(key <= '2026-08-04').toBe(true);
    });

    // No cell for a future dayKey exists at all, so none can carry the
    // "0 commits" aria pattern for a day beyond the snapshot.
    ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'].forEach((futureKey) => {
      expect(container.querySelector(`[data-daykey="${futureKey}"]`)).toBeNull();
    });
  });

  it('with no known snapshot day (invalid endDayKey), the fallback window still renders the full rectangle', () => {
    // No real "future" is knowable without a snapshot day, so the existing
    // deterministic-fallback behavior (full 371-cell rectangle) is
    // unchanged — future-day omission only applies to a valid endDayKey.
    const { container } = render(<Heatmap commitDays={{}} endDayKey="not-a-date" />);
    expect(container.querySelectorAll(`.${CSS.heatmapCell}`).length).toBe(371);
  });
});

/* ------------------------------------------------------------------
   Timeline — cross-filter steal
   ------------------------------------------------------------------

   Window anchor: Timeline derives its own end from max(commitDays keys).
   By hand from fixtures.js: ember-ledger's lexicographically-largest key
   is "2026-07-29" (string YYYY-MM-DD sort == chronological sort).
   new Date(2026, 6, 29) is a WEDNESDAY (getDay() === 3); its week's Sunday
   is 2026-07-26, and 52 weeks earlier is 2025-08-03 — so the window is
   [2025-08-03 .. 2026-08-01], 52 weeks of 7 days.
   ------------------------------------------------------------------ */

describe('Timeline', () => {
  it('derives its window from the max commitDays key (hand-verified)', () => {
    const keys = Object.keys(emberDays).sort();
    expect(keys[keys.length - 1]).toBe('2026-07-29');
    expect(new Date(2026, 6, 29).getDay()).toBe(3); // Wednesday
  });

  it('renders 52 weekly stems with no filter applied', () => {
    const { container } = render(<Timeline commitDays={emberDays} />);
    const stems = container.querySelectorAll('.chart-timeline__stem');
    expect(stems.length).toBe(52);
    expect(container.querySelectorAll('.chart-timeline__stem--active').length).toBe(0);
    expect(container.querySelectorAll('.chart-timeline__stem--dim').length).toBe(0);
    expect(container.querySelector('svg')?.getAttribute('data-filter-day')).toBe('');
  });

  it('visibly narrows to the week containing filterDay: one active stem, 51 dimmed', () => {
    // Hand check: 2026-07-28 falls in the week starting 2026-07-26 (the
    // LAST week in the 52-week window derived above), which is week
    // index 51. Sum of commitDays over that week's 7 days (2026-07-26..
    // 2026-08-01), read directly from the fixture, not from Timeline:
    const weekKeys = [
      '2026-07-26', '2026-07-27', '2026-07-28',
      '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01',
    ];
    const expectedTotal = weekKeys.reduce((sum, k) => sum + (emberDays[k] ?? 0), 0);
    expect(expectedTotal).toBe(4);

    const { container: plain } = render(<Timeline commitDays={emberDays} />);
    const plainStems = plain.querySelectorAll('.chart-timeline__stem');

    const { container } = render(
      <Timeline commitDays={emberDays} filterDay="2026-07-28" />,
    );
    const stems = container.querySelectorAll('.chart-timeline__stem');
    expect(stems.length).toBe(plainStems.length); // same 52 weeks, different rendering

    const active = container.querySelectorAll('.chart-timeline__stem--active');
    expect(active.length).toBe(1);
    expect(active[0].getAttribute('data-week-start')).toBe('2026-07-26');
    expect(active[0].getAttribute('data-total')).toBe('4');

    const dimmed = container.querySelectorAll('.chart-timeline__stem--dim');
    expect(dimmed.length).toBe(51);

    expect(container.querySelector('svg')?.getAttribute('data-filter-day')).toBe('2026-07-28');
    expect(container.querySelector('.chart-timeline__marker')).not.toBeNull();
    expect(container.querySelector('.chart-timeline__reading')?.textContent).toContain('2026-07-28');
  });

  it('is a documented no-op when filterDay falls outside the plotted window', () => {
    // 2025-08-01 is before the window's first Sunday (2025-08-03),
    // computed by hand above.
    const { container } = render(
      <Timeline commitDays={emberDays} filterDay="2025-08-01" />,
    );
    expect(container.querySelectorAll('.chart-timeline__stem--active').length).toBe(0);
    expect(container.querySelectorAll('.chart-timeline__stem--dim').length).toBe(0);
    expect(container.querySelector('svg')?.getAttribute('data-filter-day')).toBe('');
  });

  it('renders safely on empty data, with and without a filterDay', () => {
    expect(() => render(<Timeline commitDays={{}} />)).not.toThrow();
    expect(() => render(<Timeline commitDays={{}} filterDay="2026-01-01" />)).not.toThrow();
    const { container } = render(<Timeline commitDays={{}} />);
    expect(container.querySelectorAll('.chart-timeline__stem').length).toBe(0);
    expect(container.querySelector('.chart-timeline--empty')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------
   Sparkline
   ------------------------------------------------------------------ */

describe('Sparkline', () => {
  it('plots one point per series value and labels the latest reading', () => {
    const { container } = render(<Sparkline series={[1, 4, 2, 9, 5]} />);
    const path = container.querySelector('.chart-sparkline__line');
    expect(path).not.toBeNull();
    // M + 4 more L commands = 5 points for 5 values.
    expect((path.getAttribute('d').match(/[ML]/g) ?? []).length).toBe(5);
    expect(container.querySelector('.chart-sparkline__reading')?.textContent).toBe('5');
  });

  it('renders safely on empty and single-value series', () => {
    expect(() => render(<Sparkline series={[]} />)).not.toThrow();
    const { container: empty } = render(<Sparkline series={[]} />);
    expect(empty.querySelector('.chart-sparkline--empty')).not.toBeNull();
    expect(empty.querySelector('.chart-sparkline__line')).toBeNull();

    expect(() => render(<Sparkline series={[7]} />)).not.toThrow();
    const { container: one } = render(<Sparkline series={[7]} />);
    expect(one.querySelector('.chart-sparkline__reading')?.textContent).toBe('7');
  });

  it('anchors the reading clear of a rising line\'s final point (no strike-through)', () => {
    // Rising series ending at its max: by the documented formula
    // y = PAD + innerH - ((value-min)/span)*innerH with PAD=2, innerH=14,
    // the final point (value=9, the max) lands at y = 2+14-14 = 2 — right
    // at the top of the chart. The pre-fix reading was hard-anchored at
    // y=HEIGHT-1=17, an 11px-tall reading whose glyph band (~y 9..17)
    // the rising stroke's final approach cuts straight through.
    const { container } = render(<Sparkline series={[1, 2, 3, 4, 9]} />);
    const dot = container.querySelector('.chart-sparkline__dot');
    const reading = container.querySelector('.chart-sparkline__reading');
    expect(dot).not.toBeNull();
    expect(reading).not.toBeNull();
    expect(dot.getAttribute('cy')).toBe('2');

    const dotY = Number(dot.getAttribute('cy'));
    const readingY = Number(reading.getAttribute('y'));
    // The reading must have moved off the old fixed bottom anchor (17) and
    // must sit with a clear vertical gap from the final point — never
    // striking through it.
    expect(readingY).not.toBe(17);
    expect(Math.abs(readingY - dotY)).toBeGreaterThanOrEqual(4);
    expect(reading.textContent).toBe('9');
  });
});

/* ------------------------------------------------------------------
   Strata
   ------------------------------------------------------------------ */

describe('Strata', () => {
  it('draws one hatched band per language, widest-first, with LOC in the legend', () => {
    // ember-ledger.loc = { TypeScript: 8420, CSS: 1210, HTML: 96 } (fixtures.js)
    const { loc } = fixtureRepo('ember-ledger');
    const { container } = render(<Strata loc={loc} />);
    const bands = container.querySelectorAll(`.${CSS.strataBand}`);
    // one band per language in the bar, plus one per legend swatch = 2x.
    expect(bands.length).toBe(Object.keys(loc).length * 2);

    const barBands = container.querySelectorAll(`.chart-strata__bar > g > .${CSS.strataBand}`);
    expect(Array.from(barBands).map((b) => b.getAttribute('data-language'))).toEqual([
      'TypeScript', 'CSS', 'HTML',
    ]);
    expect(Array.from(barBands).map((b) => b.getAttribute('data-loc'))).toEqual([
      '8420', '1210', '96',
    ]);

    const legendCounts = Array.from(
      container.querySelectorAll(`.chart-strata__legend-row .${CSS.sounding}`),
    ).map((n) => n.textContent);
    expect(legendCounts).toEqual(['8,420', '1,210', '96']);
  });

  it('renders safely on empty loc, with an explicit empty-state message and no bands', () => {
    // A single featureless band reads as broken, not empty — the fix
    // replaces it with an explicit muted-ink message (styled like the
    // neighboring plates' empty states) and draws no bands at all.
    expect(() => render(<Strata loc={{}} />)).not.toThrow();
    const { container } = render(<Strata loc={{}} />);
    expect(container.querySelector('.chart-strata--empty')).not.toBeNull();
    expect(container.querySelectorAll(`.${CSS.strataBand}`).length).toBe(0);
    const message = container.querySelector('.chart-timeline__empty-label');
    expect(message).not.toBeNull();
    expect(message.textContent).toBe('No lines surveyed.');
  });
});
