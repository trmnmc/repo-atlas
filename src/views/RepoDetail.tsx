/**
 * RepoDetail — the per-repo drill-down: five numbered Plates scoped to a
 * single repo's own data. Pure props-in view (no fetching — the shell
 * passes the already-loaded RepoSummary object).
 *
 * Fig. 6  Commit Soundings   — Heatmap + Timeline, wired to a local
 *                               day-click cross-filter (the same steal the
 *                               charts already implement, kept local here).
 * Fig. 7  Strata of the Codebase — LOC by language.
 * Fig. 8  Ship's Log         — recent commits.
 * Fig. 9  Recent Workings    — last-touched files.
 * Fig. 10 Charted Branches   — branch list, current branch marked.
 *
 * Everything charted is scoped to `repo` alone: Heatmap/Timeline receive
 * ONLY repo.commitDays, never a merged snapshot-wide map.
 */
import { useState } from 'react';
import { Plate } from '../components/Plate.tsx';
import { CommitLog } from '../components/CommitLog.tsx';
import { TouchedFiles } from '../components/TouchedFiles.tsx';
import { BranchList } from '../components/BranchList.tsx';
import { Heatmap } from '../charts/Heatmap.tsx';
import { Timeline } from '../charts/Timeline.tsx';
import { Strata } from '../charts/Strata.tsx';
import { CSS, advisoryClass, dayKey } from '../../shared/contract.js';

export interface RepoDetailUpstream {
  state: 'tracked' | 'none';
  aheadBy?: number;
  behindBy?: number;
}

export interface RepoDetailLastCommit {
  iso: string;
  subject: string;
  author: string;
}

export interface RepoDetailRepo {
  name: string;
  path: string;
  id: string;
  branch: string;
  detached: boolean;
  dirty: boolean;
  upstream: RepoDetailUpstream;
  lastCommit: RepoDetailLastCommit;
  commitDays: Record<string, number>;
  loc: Record<string, number>;
  recentCommits: Array<{ hash: string; iso: string; subject: string; author: string }>;
  touchedFiles: Array<{ path: string; lastIso: string; commits: number }>;
  branches: Array<{ name: string; current: boolean; lastCommitIso: string }>;
}

export interface RepoDetailProps {
  repo: RepoDetailRepo;
  onBack: () => void;
}

/**
 * The most recent day the repo's own heatmap grid should reach: the
 * lexicographically-largest (== chronologically-largest, "YYYY-MM-DD")
 * commitDays key, falling back to the repo's last commit day when
 * commitDays is empty.
 */
function repoEndDayKey(repo: RepoDetailRepo): string {
  const keys = Object.keys(repo.commitDays ?? {});
  if (keys.length > 0) return keys.sort()[keys.length - 1];
  return repo.lastCommit?.iso ? dayKey(repo.lastCommit.iso) : '';
}

function UpstreamChip({ upstream }: { upstream: RepoDetailUpstream }) {
  if (!upstream || upstream.state === 'none') {
    return (
      <span className={`detail-chip ${CSS.advisoryNoRemote}`}>
        no remote
      </span>
    );
  }

  const aheadBy = upstream.aheadBy ?? 0;
  const behindBy = upstream.behindBy ?? 0;
  const inSync = aheadBy === 0 && behindBy === 0;
  const label = inSync
    ? 'in sync'
    : `ahead ${aheadBy} / behind ${behindBy}`;
  const chipClass = aheadBy > 0
    ? `detail-chip ${advisoryClass('unpushed')}`
    : 'detail-chip detail-chip--neutral';

  return (
    <span className={chipClass} data-ahead={aheadBy} data-behind={behindBy}>
      {label}
    </span>
  );
}

function DirtyBadge({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <span className={`detail-chip ${advisoryClass('dirty')}`}>
      dirty
    </span>
  );
}

export function RepoDetail({ repo, onBack }: RepoDetailProps) {
  const [filterDay, setFilterDay] = useState<string | undefined>(undefined);

  const commitDays = repo.commitDays ?? {};
  const endDayKey = repoEndDayKey(repo);

  function handleDayClick(day: string) {
    setFilterDay((current) => (current === day ? undefined : day));
  }

  return (
    <div className="repo-detail">
      <header className="repo-detail__header">
        <button type="button" className="repo-detail__back" onClick={onBack}>
          &larr; Back to atlas
        </button>
        <h1 className="repo-detail__name">{repo.name}</h1>
        <div className="repo-detail__meta">
          <span className={`repo-detail__branch ${CSS.sounding}`}>
            {repo.detached ? `detached @ ${repo.branch}` : repo.branch}
          </span>
          <UpstreamChip upstream={repo.upstream} />
          <DirtyBadge dirty={repo.dirty} />
        </div>
      </header>

      <Plate figure={6} caption="Commit Soundings">
        <Heatmap commitDays={commitDays} endDayKey={endDayKey} onDayClick={handleDayClick} />
        <Timeline commitDays={commitDays} filterDay={filterDay} />
      </Plate>

      <Plate figure={7} caption="Strata of the Codebase">
        <Strata loc={repo.loc ?? {}} />
      </Plate>

      <Plate figure={8} caption="Ship's Log">
        <CommitLog commits={repo.recentCommits ?? []} />
      </Plate>

      <Plate figure={9} caption="Recent Workings">
        <TouchedFiles files={repo.touchedFiles ?? []} />
      </Plate>

      <Plate figure={10} caption="Charted Branches">
        <BranchList branches={repo.branches ?? []} />
      </Plate>
    </div>
  );
}

export default RepoDetail;
