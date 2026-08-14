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
    // that column's Sunday changes (a fresh calendar walk, not Heatmap's):
    //   0 Jul, 1 Aug, 6 Sep, 10 Oct, 14 Nov, 19 Dec, 23 Jan, 27 Feb,
    //   31 Mar, 36 Apr, 40 May, 45 Jun, 49 Jul
    // Then the label-thinning rule (documented in Heatmap: a label whose
    // successor starts within 3 columns is dropped in favour of the later,
    // full month) removes exactly one of them — col 0 'Jul', whose
    // successor 'Aug' starts one column later. That leading column is the
    // window's stub week (2025-07-27..2025-08-02, four July days), and its
    // label printed straight through 'Aug' at the rendered scale. Every
    // other gap here is 4 or 5 columns, so nothing else is thinned.
    const expected = [
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
    // The stub month is gone, not merely moved: nothing is drawn at x=0.
    expect(labels.some((node) => node.getAttribute('x') === '0')).toBe(false);
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
      // ...in fact no closer than a full label width (3 columns), which is
      // what a three-letter month actually occupies at the rendered scale.
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(3 * STEP);
    }
    // The 53-week window is still fully derived (53 columns of the grid
    // structure) — an empty map doesn't shrink or corrupt it. (2026-01-04
    // is a Sunday, so its own week contributes only that one observed day;
    // the rest of that week is future and correctly omitted — see the
    // dedicated future-day test below.)
    const columns = container.querySelectorAll('.chart-heatmap__grid > g');
    expect(columns.length).toBe(53);
  });

  it('the live mocktail window (endDayKey 2026-08-13, empty commitDays) keeps every month label a full label-width apart', () => {
    // The window the running app actually renders when nothing has been
    // scanned. Hand-derived: 2026-08-01 is a Saturday (asserted above), so
    // 2026-08-13 is a Thursday (12 days later, 12 mod 7 = 5 weekdays on);
    // its week's Sunday is 2026-08-09 and 52 weeks earlier is 2025-08-10.
    expect(new Date(2026, 7, 13).getDay()).toBe(4); // Thursday
    const { container } = render(<Heatmap commitDays={{}} endDayKey="2026-08-13" />);
    const labels = Array.from(container.querySelectorAll('.chart-heatmap__month'));

    const CELL = 11;
    const GAP = 3;
    const STEP = CELL + GAP;
    const xs = labels.map((node) => Number(node.getAttribute('x')));
    expect(xs.length).toBeGreaterThan(1);
    for (let i = 1; i < xs.length; i++) {
      // No two labels within one label-width (3 columns) of each other —
      // the collision the live grid showed as an overprinted month pair.
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(3 * STEP);
    }
  });

  it('drops a stub December label rather than overprint it with January (calendar-year window)', () => {
    // The exact live shape: a window whose first column is a partial
    // trailing December week immediately followed by January.
    // Hand-derived: 2026-01-04 is a Sunday (used above), so 2025-12-28 is
    // a Sunday too; 2025-12-28 + 364 days = 2026-12-27, also a Sunday. So
    // any endDayKey in that final week anchors firstColStart at
    // 2025-12-28 — take 2026-12-31 (a Thursday: 2026-08-01 Sat + 152 days,
    // 152 mod 7 = 5).
    expect(new Date(2026, 11, 31).getDay()).toBe(4); // Thursday
    expect(new Date(2025, 11, 28).getDay()).toBe(0); // Sunday

    const { container } = render(<Heatmap commitDays={{}} endDayKey="2026-12-31" />);
    const labels = Array.from(container.querySelectorAll('.chart-heatmap__month'));
    const CELL = 11;
    const GAP = 3;
    const STEP = CELL + GAP;

    // Fresh calendar walk of the column Sundays from 2025-12-28:
    //   col 0  2025-12-28 Dec  <- stub week, one column before January
    //   col 1  2026-01-04 Jan
    //   col 5  2026-02-01 Feb   col 9  2026-03-01 Mar
    //   col 14 2026-04-05 Apr   col 18 2026-05-03 May
    //   col 23 2026-06-07 Jun   col 27 2026-07-05 Jul
    //   col 31 2026-08-02 Aug   col 36 2026-09-06 Sep
    //   col 40 2026-10-04 Oct   col 44 2026-11-01 Nov
    //   col 49 2026-12-06 Dec
    // The stub 'Dec' at col 0 is one column from 'Jan' at col 1, so it is
    // dropped; every remaining gap is 4 or 5 columns.
    expect(labels.map((node) => node.textContent)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
    expect(labels.map((node) => Number(node.getAttribute('x')))).toEqual(
      [1, 5, 9, 14, 18, 23, 27, 31, 36, 40, 44, 49].map((col) => col * STEP),
    );
    // Nothing is drawn in the stub column, and no pair collides.
    expect(labels.some((node) => node.getAttribute('x') === '0')).toBe(false);
    const xs = labels.map((node) => Number(node.getAttribute('x')));
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(3 * STEP);
    }
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
   ------------------------------------------------------------------

   The reading is a right-anchored glyph run, so it occupies a BOX, not a
   point. Sparkline documents that box as ~10 units of glyph run left of
   its x, 4 units above the baseline and 1 below (viewBox units == CSS px:
   the chart is drawn 64 x 18 and rendered at 4rem x 1.125rem). The
   helpers below re-derive that box from the RENDERED attributes and check
   it against the RENDERED path — no Sparkline internals are imported.
   ------------------------------------------------------------------ */

const READING_TEXT_SPAN = 10;
const READING_ASCENT = 4;
const READING_DESCENT = 1;
const READING_CLEARANCE = 3;

interface XY { x: number; y: number }

/** Points of the rendered polyline, straight off the path's `d`. */
function readPathPoints(container: HTMLElement): XY[] {
  const d = container.querySelector('.chart-sparkline__line').getAttribute('d');
  return d.trim().split(/\s+/).map((command) => {
    const [x, y] = command.slice(1).split(',').map(Number);
    return { x, y };
  });
}

/** The reading's glyph box, derived from its rendered x/y/text-anchor. */
function readReadingBox(container: HTMLElement) {
  const text = container.querySelector('.chart-sparkline__reading');
  expect(text.getAttribute('text-anchor')).toBe('end');
  const x = Number(text.getAttribute('x'));
  const y = Number(text.getAttribute('y'));
  return {
    x0: x - READING_TEXT_SPAN,
    x1: x,
    top: y - READING_ASCENT,
    bottom: y + READING_DESCENT,
  };
}

/**
 * The y-range the polyline covers over [x0, x1] — an independent walk of
 * the rendered points (segments are straight, so the extremes over an
 * x-window sit at that window's ends).
 */
function pathYRangeOver(points: XY[], x0: number, x1: number) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const lo = Math.max(a.x, x0);
    const hi = Math.min(b.x, x1);
    if (hi < lo) continue;
    const yAt = (x: number) => a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    for (const y of [yAt(lo), yAt(hi)]) {
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return min === Infinity ? null : { min, max };
}

/** Assert the reading's box clears every stroke crossing its x-span. */
function expectReadingClearOfLine(container: HTMLElement) {
  const box = readReadingBox(container);
  const range = pathYRangeOver(readPathPoints(container), box.x0, box.x1);
  if (range === null) return { box, range, clearance: Infinity };
  // Positive when the box sits wholly above or wholly below the strokes.
  const clearance = Math.max(range.min - box.bottom, box.top - range.max);
  // Report the geometry alongside the verdict so a failure names the spot.
  expect({ box, range, clears: clearance >= READING_CLEARANCE }).toMatchObject({
    clears: true,
  });
  return { box, range, clearance };
}

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
    // at the top of the chart, and the approach segment from (47,10.75)
    // crosses the top-right corner where a reading would otherwise sit.
    const { container } = render(<Sparkline series={[1, 2, 3, 4, 9]} />);
    const dot = container.querySelector('.chart-sparkline__dot');
    const reading = container.querySelector('.chart-sparkline__reading');
    expect(dot).not.toBeNull();
    expect(reading).not.toBeNull();
    expect(dot.getAttribute('cy')).toBe('2');

    const dotY = Number(dot.getAttribute('cy'));
    const readingY = Number(reading.getAttribute('y'));
    expect(Math.abs(readingY - dotY)).toBeGreaterThanOrEqual(4);
    expect(reading.textContent).toBe('9');
    // The binding claim: the whole glyph box clears every stroke crossing
    // it — strictly stronger than "not at the old fixed anchor", which a
    // wrong position could also satisfy. Hand-check: over the box's x-span
    // 54..64 the line runs from y=6.67 (x=54) down to y=2 (x=62), so the
    // top baseline (box y 3..8) is struck through and the bottom one
    // (box y 13..18) clears by 6.67.
    const { range, clearance } = expectReadingClearOfLine(container);
    expect(range.min).toBeCloseTo(2, 6);
    expect(range.max).toBeCloseTo(6.6666, 3);
    expect(clearance).toBeCloseTo(6.3333, 3);
  });

  it('keeps the reading off a steep final segment (the measured live failure)', () => {
    // The live browser measurement: path '...L56.54,14.52 L62,2' with the
    // reading at <text x=64 y=7 text-anchor=end>. The final POINT (y=2) is
    // far above that baseline, yet the SEGMENT climbing to it passes right
    // through the glyph box — which is why testing the endpoint alone was
    // not enough.
    //
    // Reproduced exactly: 12 values, min 0 / max 350 / span 350, so
    // x_10 = 2 + (10/11)*60 = 56.545 and y_10 = 16 - 14*(37/350) = 14.52,
    // with the last point at x=62, y = 16-14 = 2.
    const series = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 37, 350];
    const { container } = render(<Sparkline series={series} />);
    const points = readPathPoints(container);
    expect(points.length).toBe(12);
    expect(points[10].x).toBeCloseTo(56.5454, 3);
    expect(points[10].y).toBeCloseTo(14.52, 6);
    expect(points[11].x).toBeCloseTo(62, 6);
    expect(points[11].y).toBeCloseTo(2, 6);

    // The failing arrangement, stated in its own terms: over the x-span of
    // a reading anchored at x=64, that final segment sweeps from y≈15.2
    // down to y=2, so NO baseline in an 18-unit chart can clear it there —
    // the reading has to step left of the final point.
    const atRightEdge = pathYRangeOver(points, 64 - READING_TEXT_SPAN, 64);
    expect(atRightEdge.min).toBeCloseTo(2, 6);
    expect(atRightEdge.max).toBeGreaterThan(14.5);
    const readingX = Number(
      container.querySelector('.chart-sparkline__reading').getAttribute('x'),
    );
    expect(readingX).toBeLessThan(64);

    // And wherever it landed, its box clears the strokes under it by >= 3.
    const { box, range } = expectReadingClearOfLine(container);
    expect(box.x1).toBe(readingX);
    expect(range).not.toBeNull();
    expect(container.querySelector('.chart-sparkline__reading').textContent).toBe('350');
  });

  it('keeps the reading off a falling line and off a flat line', () => {
    // Falling: [9,4,3,2,1] plots 2, 10.75, 12.5, 14.25, 16 — the line
    // finishes along the bottom edge, so the reading belongs up top.
    const { container: falling } = render(<Sparkline series={[9, 4, 3, 2, 1]} />);
    const fallingPoints = readPathPoints(falling);
    expect(fallingPoints[0].y).toBeCloseTo(2, 6);
    expect(fallingPoints[4].y).toBeCloseTo(16, 6);
    const fallingFit = expectReadingClearOfLine(falling);
    expect(fallingFit.box.bottom).toBeLessThan(fallingFit.range.min);
    expect(falling.querySelector('.chart-sparkline__reading').textContent).toBe('1');

    // Flat: zero span pins every point at y = PAD + innerH/2 = 9, dead
    // centre — the reading has to sit above or below that band, not on it.
    const { container: flat } = render(<Sparkline series={[5, 5, 5, 5, 5]} />);
    readPathPoints(flat).forEach((point) => expect(point.y).toBeCloseTo(9, 6));
    const flatFit = expectReadingClearOfLine(flat);
    expect(flatFit.range).toEqual({ min: 9, max: 9 });
    expect(flat.querySelector('.chart-sparkline__reading').textContent).toBe('5');

    // Long monotone runs in both directions, same claim.
    const rising = Array.from({ length: 24 }, (_, i) => i);
    expectReadingClearOfLine(render(<Sparkline series={rising} />).container);
    expectReadingClearOfLine(render(<Sparkline series={[...rising].reverse()} />).container);
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

  it('sets the empty state at the same size as the drawn bar, not stretched to the plate', () => {
    // Left unconstrained the empty svg took its default `width: 100%` with
    // no height, so the plate's ~1190px scaled the 240x20 viewBox up to a
    // ~90px-tall billboard — the message shouted where the chart whispers.
    const { container: drawn } = render(<Strata loc={fixtureRepo('ember-ledger').loc} />);
    const bar = drawn.querySelector('.chart-strata__bar');
    expect(bar).not.toBeNull();

    const { container: empty } = render(<Strata loc={{}} />);
    const svg = empty.querySelector('.chart-strata--empty');
    // Same box class as the drawn bar, so the same rule sizes both...
    expect(svg.classList.contains('chart-strata__bar')).toBe(true);
    expect(svg.getAttribute('viewBox')).toBe(bar.getAttribute('viewBox'));
    // ...and an explicit width/height besides, so it cannot stretch to its
    // container even with no stylesheet in play.
    expect(svg.getAttribute('width')).toBe('240');
    expect(svg.getAttribute('height')).toBe('20');
  });
});
