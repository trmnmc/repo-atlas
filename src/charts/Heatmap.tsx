/**
 * Heatmap — GitHub-style 53-week x 7-day commit activity grid.
 *
 * Bare SVG, props-in only (no fetching, no Plate wrapper — the view owns
 * the Plate). Weeks are columns (Sunday..Saturday top-to-bottom), the last
 * column is the week containing `endDayKey`. Every one of the 53 x 7 = 371
 * calendar days in the window renders a cell — including days that fall
 * after `endDayKey` within its week — so the grid is always a full
 * rectangle and cell counts are exact and hand-computable.
 *
 * Clicking (or Enter/Space-activating) a cell emits its contract `dayKey`
 * via `onDayClick` — the cross-filter steal that the Timeline chart reads.
 */
import { CSS, dayKey, heatmapLevelClass } from '../../shared/contract.js';

export interface HeatmapProps {
  /** Sparse dayKey -> commit count map (contract RepoSummary.commitDays shape). */
  commitDays: Record<string, number>;
  /** "YYYY-MM-DD" — the most recent day the grid should reach. */
  endDayKey: string;
  /** Fired with the clicked cell's dayKey. */
  onDayClick?: (day: string) => void;
}

const COLS = 53;
const ROWS = 7;
const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LABEL_HEIGHT = 16;
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Parse a contract "YYYY-MM-DD" dayKey into a local-midnight Date. */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Add `n` calendar days via setDate — DST-safe (never raw ms arithmetic). */
function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (!count || count <= 0) return 0;
  return Math.min(count, 4) as 0 | 1 | 2 | 3 | 4;
}

/** True "YYYY-MM-DD"-shaped string; anything else falls back to an epoch anchor. */
function isValidDayKey(key: unknown): key is string {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

export function Heatmap({ commitDays, endDayKey, onDayClick }: HeatmapProps) {
  const days = commitDays ?? {};
  // Deterministic fallback (never wall-clock) so empty/invalid props never throw.
  const endDate = isValidDayKey(endDayKey) ? parseDayKey(endDayKey) : new Date(1970, 0, 1);
  const endDow = endDate.getDay();
  const lastColStart = addDays(endDate, -endDow);
  const firstColStart = addDays(lastColStart, -(COLS - 1) * 7);

  const columns: { key: string; count: number; level: 0 | 1 | 2 | 3 | 4 }[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  let prevMonth = -1;
  for (let col = 0; col < COLS; col++) {
    const colStart = addDays(firstColStart, col * 7);
    const month = colStart.getMonth();
    if (month !== prevMonth) {
      monthLabels.push({ col, label: MONTH_NAMES[month] });
      prevMonth = month;
    }
    const cells: { key: string; count: number; level: 0 | 1 | 2 | 3 | 4 }[] = [];
    for (let row = 0; row < ROWS; row++) {
      const date = addDays(colStart, row);
      const key = dayKey(date);
      const count = days[key] ?? 0;
      cells.push({ key, count, level: levelFor(count) });
    }
    columns.push(cells);
  }

  const width = COLS * STEP;
  const height = ROWS * STEP + LABEL_HEIGHT;

  return (
    <svg
      className="chart-heatmap"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Commit activity, 53 weeks"
      data-endday={isValidDayKey(endDayKey) ? endDayKey : ''}
    >
      <g className="chart-heatmap__months">
        {monthLabels.map(({ col, label }) => (
          <text
            key={`${col}-${label}`}
            className="chart-heatmap__month"
            x={col * STEP}
            y={LABEL_HEIGHT - 5}
          >
            {label}
          </text>
        ))}
      </g>
      <g className="chart-heatmap__grid" transform={`translate(0, ${LABEL_HEIGHT})`}>
        {columns.map((col, ci) => (
          <g key={ci} transform={`translate(${ci * STEP}, 0)`}>
            {col.map((cell, ri) => (
              <rect
                key={cell.key}
                className={`${CSS.heatmapCell} ${heatmapLevelClass(cell.level)}`}
                x={0}
                y={ri * STEP}
                width={CELL}
                height={CELL}
                rx={1.5}
                data-daykey={cell.key}
                data-count={cell.count}
                role="button"
                tabIndex={0}
                aria-label={`${cell.key}: ${cell.count} commit${cell.count === 1 ? '' : 's'}`}
                onClick={() => onDayClick?.(cell.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onDayClick?.(cell.key);
                  }
                }}
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

export default Heatmap;
