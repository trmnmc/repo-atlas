/**
 * StatsRow — Fig. 4, "Legend & Reckonings": four small reckonings taken off
 * the snapshot, each a label, a mono tabular-figure value, and a note. Two
 * of them carry a Sparkline of the trailing twelve weeks, where a trend is
 * the point; the two that are plain counts get no chart, because a
 * sparkline of a single number is decoration and this folio doesn't
 * decorate.
 *
 * Every derivation is pure and anchored to `nowIso` (Snapshot.generatedAt),
 * never Date.now(), so a given snapshot always reckons identically.
 *
 * Vermilion appears here in exactly one place: the dirty-tree count, and
 * only when it is non-zero — dirty IS an attention state (shared contract
 * ATTENTION_ORDER). Nothing else on this plate is allowed the accent.
 */
import { useMemo } from 'react';
import { CSS, dayKey } from '../../shared/contract.js';
import { Sparkline } from '../charts/Sparkline.tsx';

/** Minimal structural view of a RepoSummary — whatever a reckoning needs. */
export interface StatsRepo {
  id: string;
  name: string;
  dirty: boolean;
  commitDays: Record<string, number>;
}

export interface StatsRowProps {
  repos: StatsRepo[];
  /** Sum of every repo's commitDays (computed once by the shell, memoized). */
  aggregateCommitDays: Record<string, number>;
  /** Snapshot.generatedAt — the reference instant for "this month" / trailing weeks. */
  nowIso: string;
}

const TREND_WEEKS = 12;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

function sumCounts(commitDays: Record<string, number>): number {
  return Object.values(commitDays ?? {}).reduce(
    (total, count) => total + (Number.isFinite(count) ? count : 0),
    0,
  );
}

/**
 * Weekly commit totals for the trailing `weeks` weeks ending on `endKey`,
 * oldest first. Week w covers the 7 days ending `w` weeks before endKey.
 */
export function weeklyTotals(
  commitDays: Record<string, number>,
  endKey: string,
  weeks: number = TREND_WEEKS,
): number[] {
  const days = commitDays ?? {};
  const end = parseDayKey(endKey);
  const series: number[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    let total = 0;
    for (let d = 0; d < 7; d++) {
      total += days[dayKey(addDays(end, -(w * 7 + d)))] ?? 0;
    }
    series.push(total);
  }
  return series;
}

interface Reckoning {
  key: string;
  label: string;
  value: string;
  note: string;
  series?: number[];
  /** True only for genuine attention states — the vermilion gate. */
  attention?: boolean;
}

export function StatsRow({ repos, aggregateCommitDays, nowIso }: StatsRowProps) {
  const reckonings = useMemo<Reckoning[]>(() => {
    const all = Array.isArray(repos) ? repos : [];
    const aggregate = aggregateCommitDays ?? {};
    const endKey = dayKey(nowIso);
    const monthPrefix = endKey.slice(0, 7);
    const monthDate = parseDayKey(endKey);
    const monthLabel = `${MONTH_NAMES[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

    const commitsThisMonth = Object.entries(aggregate).reduce(
      (total, [key, count]) => (key.startsWith(monthPrefix) ? total + count : total),
      0,
    );

    // Most active = most commits across the whole charted window; ties break
    // on name so the reckoning is stable for a given snapshot.
    const totals = all.map((repo) => ({ repo, total: sumCounts(repo.commitDays) }));
    const mostActive = totals.reduce<{ repo: StatsRepo; total: number } | null>((best, entry) => {
      if (!best) return entry;
      if (entry.total > best.total) return entry;
      if (entry.total === best.total && entry.repo.name < best.repo.name) return entry;
      return best;
    }, null);

    const dirtyCount = all.filter((repo) => repo.dirty).length;

    return [
      {
        key: 'repos',
        label: 'Repositories charted',
        value: String(all.length),
        note: 'under the projects directory',
      },
      {
        key: 'commits-month',
        label: 'Commits this month',
        value: String(commitsThisMonth),
        note: monthLabel,
        series: weeklyTotals(aggregate, endKey),
      },
      {
        key: 'most-active',
        label: 'Most active',
        value: mostActive ? mostActive.repo.name : '—',
        note: mostActive ? `${mostActive.total} commits charted` : 'no activity charted',
        series: mostActive ? weeklyTotals(mostActive.repo.commitDays, endKey) : undefined,
      },
      {
        key: 'dirty',
        label: 'Dirty trees',
        value: String(dirtyCount),
        note: dirtyCount === 0 ? 'all working trees clean' : 'uncommitted work aboard',
        attention: dirtyCount > 0,
      },
    ];
  }, [repos, aggregateCommitDays, nowIso]);

  return (
    <div className="stats-row">
      {reckonings.map((reckoning) => (
        <div className="reckoning" key={reckoning.key} data-reckoning={reckoning.key}>
          <span className="reckoning__label">{reckoning.label}</span>
          <span
            className={`reckoning__value ${CSS.sounding}${
              reckoning.attention ? ' reckoning__value--attention' : ''
            }`}
          >
            {reckoning.value}
          </span>
          <span className="reckoning__note">{reckoning.note}</span>
          {reckoning.series && (
            <span className="reckoning__trend">
              <Sparkline series={reckoning.series} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default StatsRow;
