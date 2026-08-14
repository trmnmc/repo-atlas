/**
 * Sparkline — small inline sounding line for a bare numeric series (e.g. a
 * per-repo weekly-commits trend inside a Gazetteer row). Bare SVG,
 * props-in only.
 *
 * Same engraving idiom as Timeline (thin ink line, tabular-figure reading)
 * shrunk to fit a table cell.
 *
 * The end-value reading is placed by geometry: its glyph box is tested
 * against the line's own y-range over the box's x-span, so no series —
 * however steep — can be struck through by its own reading. See
 * `placeReading` below.
 */
import { CSS } from '../../shared/contract.js';

export interface SparklineProps {
  /** Ordered numeric series, oldest first. */
  series: number[];
}

const WIDTH = 64;
const HEIGHT = 18;
const PAD = 2;
/** Reading baseline near the chart's bottom edge. */
const READING_Y_BOTTOM = HEIGHT - 1;
/** Reading baseline near the chart's top edge. */
const READING_Y_TOP = PAD + 5;
/** Reading baseline in the chart's middle band (last resort of the three). */
const READING_Y_MID = Math.round(HEIGHT / 2) + 2;

/* ------------------------------------------------------------------
   Reading placement geometry (all in viewBox units, which equal CSS px
   here: the sparkline is drawn 64 x 18 and rendered at 4rem x 1.125rem).

   The reading is right-anchored, so its glyph run occupies a BOX, not a
   point: roughly READING_TEXT_SPAN wide to the LEFT of its x, and a band
   from `y - READING_ASCENT` to `y + READING_DESCENT` vertically. Testing
   only the final POINT's y (the previous fix) is not enough — a steep
   final segment can rise straight through a box the endpoint sits clear
   of. So we test the box against the polyline's actual y-range over the
   box's x-span and require READING_CLEARANCE units of daylight.
   ------------------------------------------------------------------ */
/** Approximate width of the glyph run left of the right-anchored x. */
const READING_TEXT_SPAN = 10;
/** Glyph band above the baseline (numerals at --text-xs, no ascenders). */
const READING_ASCENT = 4;
/** Glyph band below the baseline. */
const READING_DESCENT = 1;
/** Required daylight between the glyph box and the line. */
const READING_CLEARANCE = 3;
/** Step used when walking the reading leftwards out of a crowded right edge. */
const READING_X_STEP = 2;

interface Point {
  x: number;
  y: number;
}

/**
 * The y-range the polyline occupies over the x-window [x0, x1], or null
 * when the line never reaches that window. Segments are straight, so each
 * one's extremes over an x-window are at the window's ends.
 */
function lineYRange(points: Point[], x0: number, x1: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  const note = (y: number) => {
    if (y < min) min = y;
    if (y > max) max = y;
  };

  if (points.length === 1) {
    const only = points[0];
    if (only.x >= x0 && only.x <= x1) note(only.y);
  }

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const lo = Math.max(Math.min(a.x, b.x), x0);
    const hi = Math.min(Math.max(a.x, b.x), x1);
    if (hi < lo) continue;
    if (a.x === b.x) {
      note(a.y);
      note(b.y);
      continue;
    }
    const yAt = (x: number) => a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    note(yAt(lo));
    note(yAt(hi));
  }

  return min === Infinity ? null : { min, max };
}

/** Daylight between the glyph box at baseline `y` and `range` (negative = struck through). */
function clearanceAt(y: number, range: { min: number; max: number } | null): number {
  if (!range) return Infinity;
  const top = y - READING_ASCENT;
  const bottom = y + READING_DESCENT;
  // Either the box sits entirely above the line, or entirely below it.
  return Math.max(range.min - bottom, top - range.max);
}

/**
 * Choose where the end-value reading goes: the rightmost x (flush with the
 * chart's right edge when possible) at which one of the three baselines
 * clears the line by READING_CLEARANCE. When the line spans the full height
 * near the right edge — a steep final segment — the search walks the reading
 * LEFT of the final point until it finds air. If nothing clears anywhere,
 * the roomiest position seen wins.
 */
function placeReading(points: Point[]): { x: number; y: number } {
  const baselines = [READING_Y_TOP, READING_Y_BOTTOM, READING_Y_MID];
  let roomiest = { x: WIDTH, y: READING_Y_BOTTOM, clearance: -Infinity };

  for (let x = WIDTH; x >= PAD + READING_TEXT_SPAN; x -= READING_X_STEP) {
    const range = lineYRange(points, x - READING_TEXT_SPAN, x);
    for (const y of baselines) {
      const clearance = clearanceAt(y, range);
      if (clearance >= READING_CLEARANCE) return { x, y };
      if (clearance > roomiest.clearance) roomiest = { x, y, clearance };
    }
  }

  return { x: roomiest.x, y: roomiest.y };
}

export function Sparkline({ series }: SparklineProps) {
  const values = Array.isArray(series) ? series.filter((v) => Number.isFinite(v)) : [];

  if (values.length === 0) {
    return (
      <svg
        className="chart-sparkline chart-sparkline--empty"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="No data"
      >
        <line
          className="chart-sparkline__baseline"
          x1={PAD}
          y1={HEIGHT - PAD}
          x2={WIDTH - PAD}
          y2={HEIGHT - PAD}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = WIDTH - PAD * 2;
  const innerH = HEIGHT - PAD * 2;

  const points = values.map((value, i) => {
    const x = values.length === 1 ? PAD + innerW / 2 : PAD + (i / (values.length - 1)) * innerW;
    const y = span === 0 ? PAD + innerH / 2 : PAD + innerH - ((value - min) / span) * innerH;
    return { x, y, value };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const last = points[points.length - 1];
  const lastValue = values[values.length - 1];

  // Place the end-value reading by geometry, not by the final point alone:
  // the glyph box has to clear the LINE SEGMENTS crossing its x-span.
  const reading = placeReading(points);

  return (
    <svg
      className="chart-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Trend, latest value ${lastValue}`}
    >
      <path className="chart-sparkline__line" d={pathD} />
      <circle className="chart-sparkline__dot" cx={last.x} cy={last.y} r={1.6} />
      <text
        className={`chart-sparkline__reading ${CSS.sounding}`}
        x={reading.x}
        y={reading.y}
        textAnchor="end"
      >
        {lastValue}
      </text>
    </svg>
  );
}

export default Sparkline;
