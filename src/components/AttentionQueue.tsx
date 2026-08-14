/**
 * AttentionQueue — Fig. 1, "Notices to Mariners": the first thing the atlas
 * says. Bare markup, props-in only (no fetching, no Plate wrapper — the
 * view owns the Plate).
 *
 * THE ORDERING RULE: `entries` arrives from the server ALREADY SORTED by
 * the contract's attentionComparator (dirty > unpushed > stale, ties by
 * most-recent activity). This component renders them IN DELIVERED ORDER and
 * NEVER re-sorts client-side — the server's ranking is the product.
 *
 * Below the ranked notices sits a second, visually distinct group: the
 * informational "no remote" notices. Per shared/contract.js, upstream
 * `{state:'none'}` is NOT an attention reason and MUST NEVER read as
 * "unpushed" — it renders through CSS.advisoryNoRemote, in ink, never
 * vermilion. Those rows are appended below the ranked queue in the
 * server's repo order, so they can never disturb the ranking above them.
 *
 * j/k (and arrows) move the cursor, Enter drills into the highlighted repo,
 * via the frozen useKeyboardNav hook.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CSS, advisoryClass } from '../../shared/contract.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.ts';

/**
 * Persistence for the queue cursor across Overview unmount/remount (a
 * drill-down-and-Back round trip). Keyed by repoId, not index — the queue
 * order can shift between snapshots, but the repo the user was looking at
 * stays findable. sessionStorage survives the unmount and is the SINGLE
 * source of truth for the persisted cursor — deliberately no module-level
 * mirror, so clearing the key (a fresh session, or a test's cleanup) really
 * does clear it. If storage is unavailable (a sandboxed embed context that
 * throws on access) persistence simply degrades to off; the cursor still
 * works normally within a mount.
 */
export const SELECTION_STORAGE_KEY = 'atlas-notices-selection';

function readPersistedSelection(): string | null {
  try {
    return window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersistedSelection(repoId: string): void {
  try {
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, repoId);
  } catch {
    // sessionStorage unavailable — persistence degrades to off.
  }
}

/** Minimal structural view of a RepoSummary — whatever a notice row needs. */
export interface QueueRepo {
  id: string;
  name: string;
  branch: string;
  detached: boolean;
  upstream: { state: 'tracked' | 'none'; aheadBy?: number; behindBy?: number };
  lastCommit: { iso: string };
}

/** Structural mirror of the contract's AttentionEntry. */
export interface QueueEntry {
  repoId: string;
  reason: 'dirty' | 'unpushed' | 'stale';
  lastActivityIso: string;
}

export interface AttentionQueueProps {
  /** Server-delivered, ALREADY SORTED. Rendered as-is. */
  entries: QueueEntry[];
  /** Every repo in the snapshot — the lookup table for names/branches. */
  repos: QueueRepo[];
  /** Snapshot.generatedAt — the reference instant for relative ages. Never Date.now(). */
  nowIso: string;
  /** Drill-down navigation. */
  onSelect: (repoId: string) => void;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole-days-ago reading against an EXPLICIT reference instant (pass
 * Snapshot.generatedAt — never Date.now(), so every render is
 * reproducible). Rendered in mono tabular figures by the caller.
 *
 * Shared with the Gazetteer, which imports it from here.
 *
 * @param iso    ISO-8601 instant being aged.
 * @param nowIso ISO-8601 reference instant.
 */
export function relativeAge(iso: string, nowIso: string): string {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return '—';
  const days = Math.floor((now - then) / MS_PER_DAY);
  if (days <= 0) return 'today';
  return `${days}d`;
}

/**
 * The sort floor server/attention.js hands a dirty repo with NO commits
 * ('1970-01-01T00:00:00.000Z'): a deterministic comparator anchor, never a
 * real activity instant. Anything at or before 2000-01-01 is that floor —
 * no repo in ~/Projects predates it, and git itself cannot hand back the
 * epoch for a genuine commit.
 */
const ACTIVITY_FLOOR_MS = Date.parse('2000-01-01T00:00:00.000Z');

/**
 * Age reading for a notice row. Real instants age normally; the zero-commit
 * epoch fallback reads as the Gazetteer's no-commit marker ('—') rather than
 * a nonsense days-since-epoch figure like '20679d'.
 */
function ageLabel(iso: string, nowIso: string): string {
  const then = Date.parse(iso);
  if (Number.isFinite(then) && then <= ACTIVITY_FLOOR_MS) return '—';
  return relativeAge(iso, nowIso);
}

/** Badge text for a row's reason. `no-remote` is informational, not attention. */
function reasonLabel(reason: QueueEntry['reason'] | 'no-remote'): string {
  return reason === 'no-remote' ? 'no remote' : reason;
}

interface QueueRow {
  key: string;
  repoId: string;
  reason: QueueEntry['reason'] | 'no-remote';
  /** True for server-ranked attention entries; false for informational notices. */
  ranked: boolean;
  iso: string;
  repo?: QueueRepo;
}

function branchLabel(repo: QueueRepo | undefined): string {
  if (!repo) return '—';
  return repo.detached ? `detached @ ${repo.branch}` : repo.branch;
}

export function AttentionQueue({ entries, repos, nowIso, onSelect }: AttentionQueueProps) {
  const rows = useMemo<QueueRow[]>(() => {
    const list = Array.isArray(entries) ? entries : [];
    const all = Array.isArray(repos) ? repos : [];
    const byId = new Map(all.map((repo) => [repo.id, repo]));
    const flagged = new Set(list.map((entry) => entry.repoId));

    // Server order, untouched. .map() preserves index order by definition.
    const ranked: QueueRow[] = list.map((entry) => ({
      key: `attention:${entry.repoId}`,
      repoId: entry.repoId,
      reason: entry.reason,
      ranked: true,
      iso: entry.lastActivityIso,
      repo: byId.get(entry.repoId),
    }));

    // Informational tail, in the snapshot's own repo order.
    const notices: QueueRow[] = all
      .filter((repo) => repo.upstream?.state === 'none' && !flagged.has(repo.id))
      .map((repo) => ({
        key: `no-remote:${repo.id}`,
        repoId: repo.id,
        reason: 'no-remote' as const,
        ranked: false,
        iso: repo.lastCommit?.iso ?? '',
        repo,
      }));

    return [...ranked, ...notices];
  }, [entries, repos]);

  const handleKeyboardSelect = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row) onSelect(row.repoId);
    },
    [rows, onSelect],
  );

  const { activeIndex, setActiveIndex } = useKeyboardNav({
    itemCount: rows.length,
    onSelect: handleKeyboardSelect,
  });

  // Restore the cursor once, on mount, to wherever it sat before Overview
  // (and this component with it) last unmounted — e.g. a drill-down-and-Back
  // round trip. useKeyboardNav always starts at index 0 and has no way to
  // take an initial index, so we push the restored position into it via its
  // own setActiveIndex once rows are available.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (rows.length === 0) return;
    restoredRef.current = true;
    const persistedRepoId = readPersistedSelection();
    if (!persistedRepoId) return;
    const restoredIndex = rows.findIndex((row) => row.repoId === persistedRepoId);
    if (restoredIndex > 0) setActiveIndex(restoredIndex);
  }, [rows, setActiveIndex]);

  // Keep the persisted selection in sync with the KEYBOARD cursor (j/k, and
  // the restore above) — the next round trip reads this. A click drills
  // straight into a repo rather than parking the cursor there, so it's
  // deliberately excluded (skipClickPersistRef below) — existing click-then-
  // Back-then-j/k behavior is unaffected by remembering a click's row.
  const skipClickPersistRef = useRef(false);
  useEffect(() => {
    if (skipClickPersistRef.current) {
      skipClickPersistRef.current = false;
      return;
    }
    const row = rows[activeIndex];
    if (row) writePersistedSelection(row.repoId);
  }, [rows, activeIndex]);

  if (rows.length === 0) {
    return <p className="attention-queue__empty">All charts in order — nothing wants attention.</p>;
  }

  return (
    <ul className="attention-queue">
      {rows.map((row, index) => {
        const active = index === activeIndex;
        const rowClass = [
          'attention-queue__row',
          CSS.advisory,
          advisoryClass(row.reason),
          row.ranked ? '' : 'attention-queue__row--notice',
          active ? 'attention-queue__row--active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <li className="attention-queue__item" key={row.key}>
            <button
              type="button"
              className={rowClass}
              data-repo-id={row.repoId}
              data-reason={row.reason}
              data-ranked={row.ranked ? 'true' : 'false'}
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                // Highlights the clicked row for the instant before the view
                // switches, but does not move the persisted cursor — see
                // skipClickPersistRef above.
                skipClickPersistRef.current = true;
                setActiveIndex(index);
                onSelect(row.repoId);
              }}
            >
              <span className="advisory-reason">{reasonLabel(row.reason)}</span>
              <span className="attention-queue__name">{row.repo?.name ?? row.repoId}</span>
              <span className={`attention-queue__branch ${CSS.sounding}`}>
                {branchLabel(row.repo)}
              </span>
              {row.ranked && row.repo?.upstream?.state === 'none' && (
                <span className={`attention-queue__marker ${CSS.advisoryNoRemote}`}>no remote</span>
              )}
              <span className={`attention-queue__age ${CSS.sounding}`}>
                {ageLabel(row.iso, nowIso)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default AttentionQueue;
