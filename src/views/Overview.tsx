/**
 * Overview — the atlas's opening folio: five numbered Plates in the order
 * the product argues its case.
 *
 *   Fig. 1  Notices to Mariners       — the attention queue, server-ranked
 *   Fig. 2  Commit Soundings          — aggregate 12-month heatmap
 *   Fig. 3  The Year's Passage        — aggregate weekly timeline
 *   Fig. 4  Legend & Reckonings       — the stats row
 *   Fig. 5  Gazetteer of Repositories — every repo, searchable and sortable
 *
 * Fig. 1 sits STRICTLY above Figs. 2 and 3 because the spec's first screen
 * must answer "what needs my attention", not show commit wallpaper. That
 * DOM order is pinned by Overview.test.tsx, not left to CSS.
 *
 * Pure props-in view: no fetching, no routing. The shell (App.tsx) owns
 * useAtlas, the aggregate commitDays memo, and the cross-filter day state
 * that Fig. 2 emits and Fig. 3 consumes.
 */
import { Plate } from '../components/Plate.tsx';
import { AttentionQueue } from '../components/AttentionQueue.tsx';
import { StatsRow } from '../components/StatsRow.tsx';
import { Gazetteer } from '../components/Gazetteer.tsx';
import { ScanBar } from '../components/ScanBar.tsx';
import { Heatmap } from '../charts/Heatmap.tsx';
import { Timeline } from '../charts/Timeline.tsx';
import { CSS, dayKey, heatmapLevelClass } from '../../shared/contract.js';
import type { RepoDetailRepo } from './RepoDetail.tsx';

/** The full RepoSummary shape, borrowed from the frozen drill-down view. */
export type AtlasRepo = RepoDetailRepo;

/** Structural mirror of the contract's Snapshot, typed for the client. */
export interface AtlasSnapshot {
  generatedAt: string;
  repos: AtlasRepo[];
  attention: Array<{
    repoId: string;
    reason: 'dirty' | 'unpushed' | 'stale';
    lastActivityIso: string;
  }>;
}

export interface OverviewProps {
  snapshot: AtlasSnapshot;
  /** Sum of every repo's commitDays — computed and memoized by the shell. */
  aggregateCommitDays: Record<string, number>;
  /** Cross-filter day emitted by Fig. 2's heatmap, consumed by Fig. 3. */
  filterDay?: string;
  onDayClick: (day: string) => void;
  scanning: boolean;
  progress: { done: number; total: number };
  onRescan: () => void;
  onSelectRepo: (repoId: string) => void;
}

const HEAT_LEVELS: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4];

export function Overview({
  snapshot,
  aggregateCommitDays,
  filterDay,
  onDayClick,
  scanning,
  progress,
  onRescan,
  onSelectRepo,
}: OverviewProps) {
  const repos = snapshot.repos ?? [];
  const attention = snapshot.attention ?? [];
  // The grid reaches the survey date itself, so "today" is always the last
  // column even when nothing was committed today.
  const endDayKey = dayKey(snapshot.generatedAt);

  return (
    <div className="overview">
      <ScanBar scanning={scanning} progress={progress} onRescan={onRescan} />

      <Plate figure={1} caption="Notices to Mariners">
        <AttentionQueue
          entries={attention}
          repos={repos}
          nowIso={snapshot.generatedAt}
          onSelect={onSelectRepo}
        />
        <p className="plate-note">
          Ranked by the survey: dirty trees first, then unpushed work, then charts left to
          go stale. <kbd>j</kbd>/<kbd>k</kbd> to move, <kbd>Enter</kbd> to open.
        </p>
      </Plate>

      <Plate figure={2} caption="Commit Soundings">
        <Heatmap commitDays={aggregateCommitDays} endDayKey={endDayKey} onDayClick={onDayClick} />
        <div className="plate-footer">
          <span className={CSS.palette}>
            <span className="palette__label">quiet</span>
            {HEAT_LEVELS.map((level) => (
              <span
                key={level}
                className={`${CSS.heatmapCell} ${heatmapLevelClass(level)} palette__swatch`}
              />
            ))}
            <span className="palette__label">busy</span>
          </span>
          <span className={`plate-note ${CSS.sounding}`}>
            {filterDay ? `narrowed to ${filterDay} — click the day again to clear` : 'click a day to narrow Fig. 3'}
          </span>
        </div>
      </Plate>

      <Plate figure={3} caption="The Year's Passage">
        <Timeline commitDays={aggregateCommitDays} filterDay={filterDay} />
      </Plate>

      <Plate figure={4} caption="Legend & Reckonings">
        <StatsRow
          repos={repos}
          aggregateCommitDays={aggregateCommitDays}
          nowIso={snapshot.generatedAt}
        />
      </Plate>

      <Plate figure={5} caption="Gazetteer of Repositories">
        <Gazetteer repos={repos} nowIso={snapshot.generatedAt} onSelect={onSelectRepo} />
      </Plate>
    </div>
  );
}

export default Overview;
