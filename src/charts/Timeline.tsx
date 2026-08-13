/**
 * Timeline — commits-per-week "sounding" chart over the trailing 12 months
 * of the supplied commitDays.
 *
 * Survey Folio identity: an impulse/area sounding line, like depth marks on
 * a nautical chart — a vertical stem per week topped by a dot, the tops
 * joined into a faint area. Bare SVG, props-in only.
 *
 * This is the cross-filter steal's other half: when `filterDay` names a day
 * that falls inside the plotted window, the week containing it is marked
 * active (full ink, a marker dot positioned at the exact weekday) and every
 * other week is visibly dimmed — the chart *narrows* to that day. An
 * out-of-window filterDay is a safe no-op (nothing crashes, nothing lies).
 */
import { CSS, dayKey } from '../../shared/contract.js';

export interface TimelineProps {
  /** Sparse dayKey -> commit count map (contract RepoSummary.commitDays shape). */
  commitDays: Record<string, number>;
  /** Optional "YYYY-MM-DD" cross-filter day emitted by Heatmap's onDayClick. */
  filterDay?: string;
}

const WEEKS = 52;
const WEEK_W = 12;
const CHART_H = 48;
const PAD_TOP = 6;
const PAD_BOTTOM = 14;

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

function isValidDayKey(key: unknown): key is string {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

interface Week {
  index: number;
  weekStartKey: string;
  total: number;
}

export function Timeline({ commitDays, filterDay }: TimelineProps) {
  const days = commitDays ?? {};
  const keys = Object.keys(days).sort();

  if (keys.length === 0) {
    return (
      <svg
        className="chart-timeline chart-timeline--empty"
        viewBox={`0 0 ${WEEKS * WEEK_W} ${CHART_H + PAD_TOP + PAD_BOTTOM}`}
        role="img"
        aria-label="Commit activity timeline, no data"
      >
        <text className="chart-timeline__empty-label" x={4} y={CHART_H / 2 + PAD_TOP}>
          No commit activity
        </text>
      </svg>
    );
  }

  const maxKey = keys[keys.length - 1];
  const endDate = parseDayKey(maxKey);
  const lastWeekStart = addDays(endDate, -endDate.getDay());
  const firstWeekStart = addDays(lastWeekStart, -(WEEKS - 1) * 7);

  const weeks: Week[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = addDays(firstWeekStart, w * 7);
    let total = 0;
    for (let r = 0; r < 7; r++) {
      total += days[dayKey(addDays(weekStart, r))] ?? 0;
    }
    weeks.push({ index: w, weekStartKey: dayKey(weekStart), total });
  }

  const maxTotal = weeks.reduce((max, week) => Math.max(max, week.total), 0);
  const scale = (value: number) => (maxTotal > 0 ? (value / maxTotal) * CHART_H : 0);

  let activeIndex = -1;
  let markerX = 0;
  if (isValidDayKey(filterDay)) {
    const filterDate = parseDayKey(filterDay);
    if (filterDate >= firstWeekStart) {
      const dayOffset = Math.round((filterDate.getTime() - firstWeekStart.getTime()) / 86400000);
      const candidate = Math.floor(dayOffset / 7);
      if (candidate >= 0 && candidate < WEEKS) {
        const withinWeek = dayOffset - candidate * 7;
        if (withinWeek >= 0 && withinWeek < 7) {
          activeIndex = candidate;
          markerX = candidate * WEEK_W + (withinWeek / 6) * WEEK_W;
        }
      }
    }
  }

  const hasFilter = activeIndex >= 0;
  const baselineY = PAD_TOP + CHART_H;

  const areaPoints = weeks
    .map((week, i) => `${i * WEEK_W + WEEK_W / 2},${baselineY - scale(week.total)}`)
    .join(' ');
  const areaPath = weeks.length
    ? `M${WEEK_W / 2},${baselineY} L${areaPoints} L${(WEEKS - 1) * WEEK_W + WEEK_W / 2},${baselineY} Z`
    : '';

  const activeWeek = hasFilter ? weeks[activeIndex] : undefined;

  return (
    <svg
      className={`chart-timeline${hasFilter ? ' chart-timeline--filtered' : ''}`}
      viewBox={`0 0 ${WEEKS * WEEK_W} ${CHART_H + PAD_TOP + PAD_BOTTOM}`}
      role="img"
      aria-label={
        hasFilter
          ? `Commit activity timeline, narrowed to ${filterDay}`
          : 'Commit activity timeline, 52 weeks'
      }
      data-filter-day={hasFilter ? filterDay : ''}
    >
      <line
        className="chart-timeline__baseline"
        x1={0}
        y1={baselineY}
        x2={WEEKS * WEEK_W}
        y2={baselineY}
      />
      {areaPath && <path className="chart-timeline__area" d={areaPath} />}
      <g className="chart-timeline__stems">
        {weeks.map((week) => {
          const isActive = week.index === activeIndex;
          const isDimmed = hasFilter && !isActive;
          const x = week.index * WEEK_W + WEEK_W / 2;
          const y = baselineY - scale(week.total);
          const cls = [
            'chart-timeline__stem',
            isActive ? 'chart-timeline__stem--active' : '',
            isDimmed ? 'chart-timeline__stem--dim' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g
              key={week.weekStartKey}
              className={cls}
              data-week-start={week.weekStartKey}
              data-total={week.total}
            >
              <line x1={x} y1={baselineY} x2={x} y2={y} />
              <circle cx={x} cy={y} r={isActive ? 2.4 : 1.4} />
            </g>
          );
        })}
      </g>
      {hasFilter && (
        <line
          className="chart-timeline__marker"
          x1={markerX}
          y1={PAD_TOP}
          x2={markerX}
          y2={baselineY}
        />
      )}
      {hasFilter && activeWeek && (
        <text className={`chart-timeline__reading ${CSS.sounding}`} x={2} y={CHART_H + PAD_TOP + 11}>
          {filterDay} — {activeWeek.total} commit{activeWeek.total === 1 ? '' : 's'} that week
        </text>
      )}
    </svg>
  );
}

export default Timeline;
