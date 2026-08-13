/**
 * Sparkline — small inline sounding line for a bare numeric series (e.g. a
 * per-repo weekly-commits trend inside a Gazetteer row). Bare SVG,
 * props-in only.
 *
 * Same engraving idiom as Timeline (thin ink line, tabular-figure reading)
 * shrunk to fit a table cell.
 */
import { CSS } from '../../shared/contract.js';

export interface SparklineProps {
  /** Ordered numeric series, oldest first. */
  series: number[];
}

const WIDTH = 64;
const HEIGHT = 18;
const PAD = 2;

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

  return (
    <svg
      className="chart-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Trend, latest value ${lastValue}`}
    >
      <path className="chart-sparkline__line" d={pathD} />
      <circle className="chart-sparkline__dot" cx={last.x} cy={last.y} r={1.6} />
      <text className={`chart-sparkline__reading ${CSS.sounding}`} x={WIDTH} y={HEIGHT - 1} textAnchor="end">
        {lastValue}
      </text>
    </svg>
  );
}

export default Sparkline;
