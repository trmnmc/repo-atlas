/**
 * Gazetteer — Fig. 5, "Gazetteer of Repositories": the index of the atlas.
 * EVERY repo in the snapshot gets a row — this plate is the completeness
 * guarantee, so it never truncates and never paginates.
 *
 * Search and sort are VIEW concerns (they change what the reader is
 * looking at, not what the server ranked), so unlike the attention queue
 * this table is free to reorder itself. Sortable columns: name, activity
 * (last-commit instant), and total lines of code. Sorts are total orders —
 * every comparator falls back to name — so a given query always yields one
 * deterministic ordering.
 *
 * State chips reuse the frozen contract render vocabulary. `no remote` is
 * an INFORMATIONAL marker (CSS.advisoryNoRemote, ink only) and can sit
 * alongside a real attention chip; it must never read as "unpushed".
 */
import { useMemo, useState } from 'react';
import { CSS, advisoryClass, isStale } from '../../shared/contract.js';
import { relativeAge } from './AttentionQueue.tsx';

/** Minimal structural view of a RepoSummary — whatever a gazetteer row needs. */
export interface GazetteerRepo {
  id: string;
  name: string;
  branch: string;
  detached: boolean;
  dirty: boolean;
  upstream: { state: 'tracked' | 'none'; aheadBy?: number; behindBy?: number };
  lastCommit: { iso: string };
  loc: Record<string, number>;
}

export interface GazetteerProps {
  repos: GazetteerRepo[];
  /** Snapshot.generatedAt — reference instant for ages and staleness. */
  nowIso: string;
  onSelect: (repoId: string) => void;
}

export type SortKey = 'name' | 'activity' | 'loc';
type SortDir = 'asc' | 'desc';

/** Default direction per column: names read A–Z, measurements read biggest-first. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  activity: 'desc',
  loc: 'desc',
};

interface StateChip {
  key: string;
  label: string;
  className: string;
}

interface Row {
  id: string;
  name: string;
  branch: string;
  chips: StateChip[];
  lastIso: string;
  lastDay: string;
  age: string;
  activity: number;
  locTotal: number;
  languages: string[];
  haystack: string;
}

/** The one place repo facts become chips. Attention first, then the neutral marker. */
function stateChips(repo: GazetteerRepo, nowIso: string): StateChip[] {
  const chips: StateChip[] = [];
  const upstream = repo.upstream ?? { state: 'tracked' as const };
  const aheadBy = upstream.state === 'tracked' ? (upstream.aheadBy ?? 0) : 0;

  // Contract priority: dirty > unpushed > stale, one attention chip at most.
  if (repo.dirty) {
    chips.push({ key: 'dirty', label: 'dirty', className: advisoryClass('dirty') });
  } else if (aheadBy > 0) {
    chips.push({ key: 'unpushed', label: `unpushed ${aheadBy}`, className: advisoryClass('unpushed') });
  } else if (repo.lastCommit?.iso && isStale(repo.lastCommit.iso, nowIso)) {
    chips.push({ key: 'stale', label: 'stale', className: advisoryClass('stale') });
  }

  // Informational, never an attention state — additive, never a substitute.
  if (upstream.state === 'none') {
    chips.push({ key: 'no-remote', label: 'no remote', className: CSS.advisoryNoRemote });
  }

  if (chips.length === 0) {
    chips.push({ key: 'clean', label: 'clean', className: 'gazetteer__chip--clean' });
  }
  return chips;
}

function sumLoc(loc: Record<string, number>): number {
  return Object.values(loc ?? {}).reduce(
    (total, count) => total + (Number.isFinite(count) ? count : 0),
    0,
  );
}

export function Gazetteer({ repos, nowIso, onSelect }: GazetteerProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('activity');
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR.activity);

  const rows = useMemo<Row[]>(() => {
    const all = Array.isArray(repos) ? repos : [];
    return all.map((repo) => {
      const languages = Object.keys(repo.loc ?? {});
      const lastIso = repo.lastCommit?.iso ?? '';
      const branch = repo.detached ? `detached @ ${repo.branch}` : repo.branch;
      const chips = stateChips(repo, nowIso);
      return {
        id: repo.id,
        name: repo.name,
        branch,
        chips,
        lastIso,
        lastDay: lastIso ? lastIso.slice(0, 10) : '—',
        age: lastIso ? relativeAge(lastIso, nowIso) : '—',
        activity: Date.parse(lastIso) || 0,
        locTotal: sumLoc(repo.loc),
        languages,
        haystack: [repo.name, branch, ...languages, ...chips.map((chip) => chip.label)]
          .join(' ')
          .toLowerCase(),
      };
    });
  }, [repos, nowIso]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle ? rows.filter((row) => row.haystack.includes(needle)) : rows.slice();
    const factor = sortDir === 'asc' ? 1 : -1;
    return matched.sort((a, b) => {
      let delta = 0;
      if (sortKey === 'name') delta = a.name.localeCompare(b.name);
      else if (sortKey === 'activity') delta = a.activity - b.activity;
      else delta = a.locTotal - b.locTotal;
      if (delta !== 0) return delta * factor;
      // Total order: equal measurements always fall back to the name, A–Z.
      return a.name.localeCompare(b.name);
    });
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  // A plain JSX-returning helper, NOT a nested component: a component
  // declared inside a render is a new type every render, so React would
  // remount these buttons and drop keyboard focus on every sort click.
  function sortHeader(column: SortKey, label: string, cell: string) {
    return (
      <span
        role="columnheader"
        aria-sort={ariaSort(column)}
        className={`gazetteer__cell gazetteer__cell--${cell} gazetteer__head-cell`}
      >
        <button
          type="button"
          className="gazetteer__sort"
          data-sort-key={column}
          data-active={column === sortKey ? 'true' : 'false'}
          onClick={() => toggleSort(column)}
        >
          {label}
          <span className="gazetteer__sort-mark" aria-hidden="true">
            {column === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '·'}
          </span>
        </button>
      </span>
    );
  }

  return (
    <div className="gazetteer">
      <div className="gazetteer__controls">
        <label className="gazetteer__search">
          <span className="gazetteer__search-label">Search</span>
          <input
            type="search"
            className="gazetteer__search-input"
            value={query}
            placeholder="name, branch, language"
            aria-label="Search repositories"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className={`gazetteer__count ${CSS.sounding}`}>
          {visible.length}/{rows.length}
        </span>
      </div>

      <div className="gazetteer__table" role="table" aria-label="Gazetteer of repositories">
        <div role="rowgroup" className="gazetteer__rowgroup">
          <div role="row" className="gazetteer__head">
            {sortHeader('name', 'Repository', 'name')}
            <span role="columnheader" className="gazetteer__cell gazetteer__cell--branch gazetteer__head-cell">
              Branch
            </span>
            <span role="columnheader" className="gazetteer__cell gazetteer__cell--state gazetteer__head-cell">
              State
            </span>
            {sortHeader('activity', 'Last commit', 'last')}
            {sortHeader('loc', 'Lines', 'loc')}
          </div>
        </div>

        <div role="rowgroup" className="gazetteer__rowgroup">
          {visible.map((row) => (
            <div
              role="row"
              key={row.id}
              className={`${CSS.gazetteerRow} gazetteer__row`}
              data-repo-id={row.id}
              tabIndex={0}
              onClick={() => onSelect(row.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(row.id);
                }
              }}
            >
              <span role="cell" className="gazetteer__cell gazetteer__cell--name">
                {row.name}
              </span>
              <span
                role="cell"
                className={`gazetteer__cell gazetteer__cell--branch ${CSS.sounding}`}
              >
                {row.branch}
              </span>
              <span role="cell" className="gazetteer__cell gazetteer__cell--state">
                {row.chips.map((chip) => (
                  <span
                    key={chip.key}
                    className={`gazetteer__chip ${chip.className}`}
                    data-chip={chip.key}
                  >
                    {chip.label}
                  </span>
                ))}
              </span>
              <span role="cell" className={`gazetteer__cell gazetteer__cell--last ${CSS.sounding}`}>
                <span className="gazetteer__date">{row.lastDay}</span>
                <span className="gazetteer__age">{row.age}</span>
              </span>
              <span role="cell" className={`gazetteer__cell gazetteer__cell--loc ${CSS.sounding}`}>
                {row.locTotal.toLocaleString('en-US')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <p className="gazetteer__empty">No repository answers to “{query}”.</p>
      )}
    </div>
  );
}

export default Gazetteer;
