/**
 * Repo Atlas — SHARED CONTRACT (FROZEN after wave 1; never edit).
 *
 * This module is imported by BOTH sides of the seam:
 *   - the plain-Node server (`node server/index.js`, ESM, zero build step)
 *   - the Vite/React SPA (src/**)
 * Therefore it is plain ESM JavaScript with JSDoc typedefs — no TypeScript,
 * no dependencies, no side effects.
 *
 * Everything here is hand-computable and pinned by shared/contract.test.js.
 * If you believe something here is wrong, you are wrong — build against it.
 */

/* ------------------------------------------------------------------ */
/* Typedefs                                                            */
/* ------------------------------------------------------------------ */

/**
 * Three-state upstream descriptor. A repo with no upstream tracking ref is
 * `{ state: 'none' }` and MUST NEVER be presented as "unpushed" — it renders
 * as "no remote" (see CSS.advisoryNoRemote).
 *
 * @typedef {{ state: 'tracked', aheadBy: number, behindBy: number } | { state: 'none' }} Upstream
 */

/**
 * @typedef {Object} LastCommit
 * @property {string} iso     Author date, full ISO-8601 string with offset or Z.
 * @property {string} subject First line of the commit message.
 * @property {string} author  Author name.
 */

/**
 * One commit in a repo's recent history (drill-down "recent commits" list).
 * @typedef {Object} CommitInfo
 * @property {string} hash    Abbreviated commit hash (7+ chars).
 * @property {string} iso     Author date, ISO-8601.
 * @property {string} subject First line of the commit message.
 * @property {string} author  Author name.
 */

/**
 * A recently-touched file (drill-down "last-touched files" list).
 * @typedef {Object} TouchedFile
 * @property {string} path      Path relative to the repo root.
 * @property {string} lastIso   ISO-8601 date the file was last touched.
 * @property {number} commits   Number of recent commits touching this file.
 */

/**
 * @typedef {Object} BranchInfo
 * @property {string}  name          Branch name.
 * @property {boolean} current       True for the checked-out branch.
 * @property {string}  lastCommitIso ISO-8601 date of the branch tip commit.
 */

/**
 * @typedef {Object} RepoSummary
 * @property {string} name       Directory name, e.g. "repo-atlas".
 * @property {string} path       Absolute path on disk.
 * @property {string} id         Stable slug, unique across the snapshot
 *                               (kebab-case of the path under ~/Projects).
 * @property {string} branch     Checked-out branch name; for detached HEAD the
 *                               abbreviated commit hash.
 * @property {boolean} detached  True when HEAD is detached.
 * @property {boolean} dirty     `git status --porcelain` non-empty (staged,
 *                               unstaged, or untracked).
 * @property {Upstream} upstream Three-state upstream descriptor (see above).
 * @property {LastCommit} lastCommit
 * @property {Record<string, number>} commitDays
 *     Map of dayKey ("YYYY-MM-DD", local timezone, see dayKey()) -> commit
 *     count for that day. Sparse: days with zero commits are absent.
 * @property {Record<string, number>} loc
 *     Map of language name -> lines of code, e.g. { "TypeScript": 1204 }.
 * @property {CommitInfo[]} recentCommits   Newest first.
 * @property {TouchedFile[]} touchedFiles   Most recently touched first.
 * @property {BranchInfo[]} branches        Current branch first, then by
 *                                          lastCommitIso descending.
 */

/**
 * @typedef {'dirty' | 'unpushed' | 'stale'} AttentionReason
 */

/**
 * @typedef {Object} AttentionEntry
 * @property {string} repoId            RepoSummary.id this entry refers to.
 * @property {AttentionReason} reason   Exactly one reason per entry; a repo
 *     that is both dirty and unpushed appears once with its highest-priority
 *     reason (dirty).
 * @property {string} lastActivityIso   ISO-8601 timestamp of the repo's most
 *     recent activity, used for tie-breaking.
 */

/**
 * The full payload of GET /api/atlas. `attention` is stored ALREADY SORTED
 * by attentionComparator; clients may render it as-is.
 * @typedef {Object} Snapshot
 * @property {string} generatedAt      ISO-8601 timestamp of the scan.
 * @property {RepoSummary[]} repos
 * @property {AttentionEntry[]} attention
 */

/**
 * Server-sent progress event emitted on GET /api/scan-events while a rescan
 * runs. `repo` is present only when phase === 'repo'.
 * @typedef {Object} ScanEvent
 * @property {'start' | 'repo' | 'done'} phase
 * @property {string} [repo]  Name of the repo just scanned (phase 'repo').
 * @property {number} done    Repos scanned so far (0 on 'start').
 * @property {number} total   Total repos to scan (may be 0 on 'start' if
 *                            enumeration has not finished).
 */

/* ------------------------------------------------------------------ */
/* Enums (frozen)                                                      */
/* ------------------------------------------------------------------ */

/**
 * Attention reasons in PRIORITY ORDER (index 0 outranks index 1, ...).
 * @type {readonly AttentionReason[]}
 */
export const ATTENTION_ORDER = Object.freeze(['dirty', 'unpushed', 'stale']);

/** Alias of ATTENTION_ORDER — the complete set of AttentionEntry.reason values. */
export const ATTENTION_REASONS = ATTENTION_ORDER;

/** @type {readonly ScanEvent['phase'][]} */
export const SCAN_PHASES = Object.freeze(['start', 'repo', 'done']);

/** @type {readonly Upstream['state'][]} */
export const UPSTREAM_STATES = Object.freeze(['tracked', 'none']);

/* ------------------------------------------------------------------ */
/* Attention comparator                                                */
/* ------------------------------------------------------------------ */

/**
 * Sort comparator for AttentionEntry: dirty > unpushed > stale; entries with
 * the same reason are ordered by most-recent activity first (lastActivityIso
 * descending). Stable under Array.prototype.sort (which is stable in all
 * supported runtimes) — equal-reason equal-instant entries keep input order.
 *
 * Usage: attention.slice().sort(attentionComparator)
 *
 * @param {AttentionEntry} a
 * @param {AttentionEntry} b
 * @returns {number} negative when a ranks before b.
 */
export function attentionComparator(a, b) {
  const ra = ATTENTION_ORDER.indexOf(a.reason);
  const rb = ATTENTION_ORDER.indexOf(b.reason);
  if (ra !== rb) return ra - rb;
  return Date.parse(b.lastActivityIso) - Date.parse(a.lastActivityIso);
}

/**
 * Convenience: returns a NEW array sorted by attentionComparator.
 * @param {AttentionEntry[]} entries
 * @returns {AttentionEntry[]}
 */
export function sortAttention(entries) {
  return entries.slice().sort(attentionComparator);
}

/* ------------------------------------------------------------------ */
/* Day bucketing (LOCAL timezone — the TZ trap)                        */
/* ------------------------------------------------------------------ */

/**
 * Returns the LOCAL-timezone calendar day of a Date or ISO string as
 * "YYYY-MM-DD". Heatmap counts bucket by author date in local timezone
 * (spec domain rule), so "2026-01-02T03:30:00Z" is "2026-01-01" in
 * America/Chicago. Tests run under TZ=America/Chicago (pinned in
 * vite.config.ts) so day-bucketing assertions are machine-independent.
 *
 * @param {Date | string} date
 * @returns {string} "YYYY-MM-DD"
 */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Staleness                                                           */
/* ------------------------------------------------------------------ */

/** A repo is stale when its last commit is MORE than this many days old. */
export const STALE_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Spec domain rule: "Stale = last commit author date > 90 days before now."
 * STRICT inequality — at exactly 90 days a repo is NOT yet stale; one
 * millisecond past 90 days it is.
 *
 * @param {string} lastCommitIso ISO-8601 author date of the last commit.
 * @param {string} nowIso        ISO-8601 "now" (pass Snapshot.generatedAt for
 *                               deterministic derivations; never Date.now()
 *                               inside pure derivations).
 * @returns {boolean}
 */
export function isStale(lastCommitIso, nowIso) {
  return Date.parse(nowIso) - Date.parse(lastCommitIso) > STALE_DAYS * MS_PER_DAY;
}

/* ------------------------------------------------------------------ */
/* ScanEvent runtime validator                                         */
/* ------------------------------------------------------------------ */

/**
 * Runtime shape check for ScanEvent (both seam sides validate with this —
 * the server before emitting, tests and clients on receipt).
 * @param {unknown} value
 * @returns {value is ScanEvent}
 */
export function isScanEvent(value) {
  if (typeof value !== 'object' || value === null) return false;
  const e = /** @type {Record<string, unknown>} */ (value);
  if (!SCAN_PHASES.includes(/** @type {any} */ (e.phase))) return false;
  if (typeof e.done !== 'number' || typeof e.total !== 'number') return false;
  if (e.phase === 'repo') {
    if (typeof e.repo !== 'string' || e.repo.length === 0) return false;
  } else if (e.repo !== undefined) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

/** GET — full Snapshot (cached; triggers a scan if no cache exists). */
export const API_ATLAS = '/api/atlas';

/** POST — kick off an async rescan; progress arrives on API_SCAN_EVENTS. */
export const API_RESCAN = '/api/rescan';

/** GET — text/event-stream of ScanEvent JSON while a rescan runs. */
export const API_SCAN_EVENTS = '/api/scan-events';

/** Server-side route pattern for the per-repo endpoint. */
export const API_REPO_PATTERN = '/api/repo/:id';

/**
 * Client-side route builder for GET /api/repo/:id -> one RepoSummary.
 * @param {string} id RepoSummary.id
 * @returns {string}
 */
export function apiRepoRoute(id) {
  return `/api/repo/${encodeURIComponent(id)}`;
}

/** All routes in one bag, for consumers that prefer object access. */
export const ROUTES = Object.freeze({
  atlas: API_ATLAS,
  rescan: API_RESCAN,
  scanEvents: API_SCAN_EVENTS,
  repoPattern: API_REPO_PATTERN,
  repo: apiRepoRoute,
});

/* ------------------------------------------------------------------ */
/* CSS render vocabulary                                               */
/* ------------------------------------------------------------------ */

/**
 * Class names for every dynamically-rendered region. All are defined in
 * src/styles/tokens.css. Use these constants — never string literals — so
 * markup and stylesheet cannot drift.
 */
export const CSS = Object.freeze({
  /** Engraved plate frame (ruled border, paper surface). */
  plate: 'plate',
  /** Small-caps serif caption, e.g. "Fig. 1 — Notices". */
  plateCaption: 'plate-caption',
  /** The "Fig. N" ordinal inside a caption. */
  plateFigure: 'plate-figure',
  /** Plate content area inside the ruled frame. */
  plateBody: 'plate-body',

  /** One row of the attention queue. */
  advisory: 'advisory',
  advisoryDirty: 'advisory--dirty',
  advisoryUnpushed: 'advisory--unpushed',
  advisoryStale: 'advisory--stale',
  /** Informational marker for upstream.state === 'none' — NOT an attention
   *  reason; renders in ink, never vermilion. */
  advisoryNoRemote: 'advisory--no-remote',

  /** One repo row in the index-of-repos table. */
  gazetteerRow: 'gazetteer-row',
  /** A single measured value (monospace, tabular figures). */
  sounding: 'sounding',
  /** One language band in a LOC strata chart. */
  strataBand: 'strata-band',
  /** One day cell of the 12-month commit heatmap. */
  heatmapCell: 'heatmap-cell',
  /** Swatch/legend row for a strata or heatmap palette. */
  palette: 'palette',
});

/**
 * Modifier class for an attention advisory row.
 * @param {AttentionReason | 'no-remote'} reason
 * @returns {string} e.g. "advisory--dirty"
 */
export function advisoryClass(reason) {
  return `advisory--${reason}`;
}

/**
 * Heatmap intensity class. Levels 0..4 (0 = no commits, 4 = hottest).
 * tokens.css defines .heatmap-cell--l0 ... .heatmap-cell--l4.
 * @param {0 | 1 | 2 | 3 | 4} level
 * @returns {string} e.g. "heatmap-cell--l3"
 */
export function heatmapLevelClass(level) {
  return `heatmap-cell--l${level}`;
}
