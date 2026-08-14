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
 * Fig. 9a Unlogged Cargo     — DIRTY REPOS ONLY: the uncommitted working
 *                               tree, grouped staged / modified / untracked.
 * Fig. 9  Recent Workings    — last-touched files.
 * Fig. 10 Charted Branches   — branch list, current branch marked.
 *
 * Everything charted is scoped to `repo` alone: Heatmap/Timeline receive
 * ONLY repo.commitDays, never a merged snapshot-wide map.
 *
 * Fig. 9a is the answer to the question a DIRTY notice asks: clicking
 * through to a dirty repo must show WHAT is dirty, not only committed
 * history. It reads repo.workingTree, an ADDITIVE field — snapshots cached
 * before the scanner emitted it simply lack it, so a dirty repo with no
 * workingTree still gets the plate, carrying a rescan line instead of a
 * manifest. Clean repos get no plate at all.
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

/**
 * The uncommitted working tree, exactly as the scanner emits it. Each list
 * is capped server-side (50 entries); `truncated` says the cap bit.
 * OPTIONAL on purpose: it is an additive field, absent from snapshots
 * cached before the scanner grew it.
 */
export interface RepoDetailWorkingTree {
  staged: string[];
  modified: string[];
  untracked: string[];
  truncated: boolean;
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
  workingTree?: RepoDetailWorkingTree;
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

/** Per-list cap the scanner applies before setting `truncated`. */
const CARGO_LIST_CAP = 50;

/** Manifest groups, in the order cargo is read off the deck. */
const CARGO_GROUPS = ['staged', 'modified', 'untracked'] as const;

type CargoGroupName = (typeof CARGO_GROUPS)[number];

interface CargoEntry {
  group: CargoGroupName;
  paths: string[];
}

/**
 * The working tree as an ordered list of NON-EMPTY groups. A file that is
 * both staged and modified is listed in both groups — that is git's own
 * account of it, and hiding either half would misreport the tree.
 *
 * Tolerates a partially-shaped workingTree (a missing list reads as empty)
 * so no cached snapshot can crash the drill-down.
 */
function cargoManifest(workingTree?: RepoDetailWorkingTree): CargoEntry[] {
  if (!workingTree) return [];
  return CARGO_GROUPS.map((group) => ({
    group,
    paths: workingTree[group] ?? [],
  })).filter((entry) => entry.paths.length > 0);
}

/**
 * "dirty — 2 modified, 1 untracked". Empty groups are omitted; with no
 * manifest at all (old cached snapshot) the badge stays plain "dirty".
 */
function dirtyBadgeLabel(manifest: CargoEntry[]): string {
  if (manifest.length === 0) return 'dirty';
  const counts = manifest.map(({ group, paths }) => `${paths.length} ${group}`);
  return `dirty — ${counts.join(', ')}`;
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

function DirtyBadge({ dirty, manifest }: { dirty: boolean; manifest: CargoEntry[] }) {
  if (!dirty) return null;
  return (
    <span className={`detail-chip ${advisoryClass('dirty')}`}>
      {dirtyBadgeLabel(manifest)}
    </span>
  );
}

/**
 * Fig. 9a body. Vermilion is spent on the header badge alone: the paths
 * here are plain ink, mono, so the eye reads the file list as data and not
 * as three dozen alarms.
 */
function UnloggedCargo({
  manifest,
  truncated,
}: {
  manifest: CargoEntry[];
  truncated: boolean;
}) {
  if (manifest.length === 0) {
    return (
      <p className="cargo-stale">uncommitted work aboard — rescan for the manifest</p>
    );
  }

  return (
    <div className="cargo">
      {manifest.map(({ group, paths }) => (
        <section className="cargo-group" data-cargo-group={group} key={group}>
          <h2 className="cargo-group__caption">
            <span className="cargo-group__label">{group}</span>
            <span className={`cargo-group__count ${CSS.sounding}`}>{paths.length}</span>
          </h2>
          <ul className="cargo-list">
            {paths.map((path) => (
              <li className="cargo-file" key={path}>
                <span className="cargo-file__path">{path}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {truncated ? (
        <p className="cargo-truncated">{`(list truncated at ${CARGO_LIST_CAP})`}</p>
      ) : null}
    </div>
  );
}

export function RepoDetail({ repo, onBack }: RepoDetailProps) {
  const [filterDay, setFilterDay] = useState<string | undefined>(undefined);

  const commitDays = repo.commitDays ?? {};
  const endDayKey = repoEndDayKey(repo);
  const manifest = cargoManifest(repo.workingTree);

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
          <DirtyBadge dirty={repo.dirty} manifest={manifest} />
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

      {repo.dirty ? (
        <Plate figure="9a" caption="Unlogged Cargo">
          <UnloggedCargo
            manifest={manifest}
            truncated={repo.workingTree?.truncated === true}
          />
        </Plate>
      ) : null}

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
