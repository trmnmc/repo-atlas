/**
 * Strata — hatched horizontal LOC bar: one stacked band per language, sized
 * by its share of total lines of code. Bare SVG, props-in only.
 *
 * Survey Folio identity: reads in monochrome. Languages are told apart by
 * hatch pattern (angle/density), never by hue — the only fill in play is
 * the frozen `.strata-band` sepia, with a hairline-stroke pattern overlay
 * drawn from `--ink`/`--paper-raised` tokens. A legend below lists each
 * language's line count in mono tabular figures (`.sounding`).
 */
import { useId } from 'react';
import { CSS } from '../../shared/contract.js';

export interface StrataProps {
  /** Language name -> lines of code (contract RepoSummary.loc shape). */
  loc: Record<string, number>;
}

const BAR_WIDTH = 240;
const BAR_HEIGHT = 20;

/** Four hatch textures, cycled by band index so any number of languages stays legible. */
const HATCH_VARIANTS: Array<{ angle: number; spacing: number }> = [
  { angle: 45, spacing: 4 },
  { angle: -45, spacing: 4 },
  { angle: 90, spacing: 3.5 },
  { angle: 0, spacing: 3.5 },
];

export function Strata({ loc }: StrataProps) {
  const uid = useId();
  const entries = Object.entries(loc ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (entries.length === 0 || total === 0) {
    return (
      <svg
        className="chart-strata chart-strata--empty"
        viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`}
        role="img"
        aria-label="No languages detected"
      >
        <rect
          className={CSS.strataBand}
          x={0}
          y={0}
          width={BAR_WIDTH}
          height={BAR_HEIGHT}
          opacity={0.25}
        />
      </svg>
    );
  }

  let cursor = 0;
  const bands = entries.map(([language, count], i) => {
    const width = (count / total) * BAR_WIDTH;
    const x = cursor;
    cursor += width;
    return { language, count, width, x, patternId: `${uid}-hatch-${i}` };
  });

  return (
    <figure className="chart-strata">
      <svg
        className="chart-strata__bar"
        viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`}
        role="img"
        aria-label={`Lines of code by language, ${entries.length} languages`}
      >
        <defs>
          {bands.map(({ patternId }, i) => {
            const hatch = HATCH_VARIANTS[i % HATCH_VARIANTS.length];
            return (
              <pattern
                key={patternId}
                id={patternId}
                width={hatch.spacing}
                height={hatch.spacing}
                patternTransform={`rotate(${hatch.angle})`}
                patternUnits="userSpaceOnUse"
              >
                <line
                  className="chart-strata__hatch-line"
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={hatch.spacing}
                />
              </pattern>
            );
          })}
        </defs>
        {bands.map((band) => (
          <g key={band.language}>
            <rect
              className={CSS.strataBand}
              x={band.x}
              y={0}
              width={band.width}
              height={BAR_HEIGHT}
              data-language={band.language}
              data-loc={band.count}
            />
            <rect
              className="chart-strata__hatch"
              x={band.x}
              y={0}
              width={band.width}
              height={BAR_HEIGHT}
              fill={`url(#${band.patternId})`}
            />
          </g>
        ))}
      </svg>
      <figcaption className="chart-strata__legend">
        {bands.map((band, i) => (
          <span key={band.language} className={`chart-strata__legend-row ${CSS.palette}`}>
            <svg className="chart-strata__swatch" viewBox="0 0 12 12" aria-hidden="true">
              <rect className={CSS.strataBand} x={0} y={0} width={12} height={12} />
              <rect
                className="chart-strata__hatch"
                x={0}
                y={0}
                width={12}
                height={12}
                fill={`url(#${band.patternId})`}
              />
            </svg>
            <span className="chart-strata__legend-name">{band.language}</span>
            <span className={CSS.sounding}>{band.count.toLocaleString('en-US')}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default Strata;
