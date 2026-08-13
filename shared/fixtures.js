/**
 * Repo Atlas — CANONICAL SHARED FIXTURE (FROZEN after wave 1; never edit).
 *
 * ONE fixture Snapshot used by ALL client tests across the codebase. Fully
 * deterministic: every date is a literal or derived from literals — no
 * Date.now() anywhere. commitDays keys are computed with UTC arithmetic and
 * formatted by hand, so the fixture bytes are identical in every timezone.
 *
 * Reference instant: generatedAt = 2026-08-01T12:00:00.000Z.
 *
 * Coverage (six repos):
 *   ember-ledger   dirty              (tracked, in sync, active yesterday)
 *   field-notes    dirty              (older activity — recency tie-break)
 *   tide-tables    unpushed           (tracked, aheadBy 3)
 *   old-survey     stale              (last commit 2026-01-10, ~203 days old)
 *   meridian       clean / ok         (tracked, in sync, active)
 *   drift-bottle   no-remote          (upstream {state:'none'}, clean, active
 *                                      — must NEVER read as "unpushed")
 *
 * `attention` is stored ALREADY SORTED per attentionComparator:
 *   dirty(ember-ledger, Jul 31) > dirty(field-notes, Jul 20)
 *   > unpushed(tide-tables) > stale(old-survey).
 */

/** @typedef {import('./contract.js').Snapshot} Snapshot */
/** @typedef {import('./contract.js').RepoSummary} RepoSummary */

const HOME = '/Users/surveyor/Projects';

/**
 * Deterministic PRNG (mulberry32) — fixed seed, no wall clock.
 * @param {number} seed
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * "YYYY-MM-DD" from a UTC epoch-ms value, via getUTC* — intentionally NOT
 * contract.dayKey(), so fixture generation is timezone-independent.
 * @param {number} ms
 */
function utcDayString(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic sparse commitDays map spanning [startIso .. endIso] (UTC days).
 * @param {string} startIso inclusive, e.g. '2025-08-01'
 * @param {string} endIso   inclusive
 * @param {number} seed
 * @param {number} density  0..1 chance a given day has commits
 * @returns {Record<string, number>}
 */
function makeCommitDays(startIso, endIso, seed, density) {
  const rand = mulberry32(seed);
  /** @type {Record<string, number>} */
  const out = {};
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  for (let t = start; t <= end; t += DAY_MS) {
    if (rand() < density) out[utcDayString(t)] = 1 + Math.floor(rand() * 5);
  }
  return out;
}

/** @type {Snapshot} */
export const fixtureSnapshot = {
  generatedAt: '2026-08-01T12:00:00.000Z',
  repos: [
    {
      name: 'ember-ledger',
      path: `${HOME}/ember-ledger`,
      id: 'ember-ledger',
      branch: 'main',
      detached: false,
      dirty: true,
      upstream: { state: 'tracked', aheadBy: 0, behindBy: 0 },
      lastCommit: {
        iso: '2026-07-31T09:14:00.000Z',
        subject: 'Balance the July ledger rollover',
        author: 'T. Surveyor',
      },
      commitDays: makeCommitDays('2025-08-01', '2026-07-31', 101, 0.42),
      loc: { TypeScript: 8420, CSS: 1210, HTML: 96 },
      recentCommits: [
        { hash: 'a1b2c3d', iso: '2026-07-31T09:14:00.000Z', subject: 'Balance the July ledger rollover', author: 'T. Surveyor' },
        { hash: 'b2c3d4e', iso: '2026-07-30T15:02:00.000Z', subject: 'Add double-entry validation', author: 'T. Surveyor' },
        { hash: 'c3d4e5f', iso: '2026-07-28T11:40:00.000Z', subject: 'Refactor account tree', author: 'T. Surveyor' },
      ],
      touchedFiles: [
        { path: 'src/ledger.ts', lastIso: '2026-07-31T09:14:00.000Z', commits: 5 },
        { path: 'src/accounts.ts', lastIso: '2026-07-30T15:02:00.000Z', commits: 3 },
      ],
      branches: [
        { name: 'main', current: true, lastCommitIso: '2026-07-31T09:14:00.000Z' },
        { name: 'feature/csv-import', current: false, lastCommitIso: '2026-07-12T10:00:00.000Z' },
      ],
    },
    {
      name: 'field-notes',
      path: `${HOME}/field-notes`,
      id: 'field-notes',
      branch: 'main',
      detached: false,
      dirty: true,
      upstream: { state: 'tracked', aheadBy: 0, behindBy: 1 },
      lastCommit: {
        iso: '2026-07-20T18:45:00.000Z',
        subject: 'Note-taking hotkeys',
        author: 'T. Surveyor',
      },
      commitDays: makeCommitDays('2025-08-01', '2026-07-20', 202, 0.18),
      loc: { JavaScript: 3120, CSS: 640 },
      recentCommits: [
        { hash: 'd4e5f6a', iso: '2026-07-20T18:45:00.000Z', subject: 'Note-taking hotkeys', author: 'T. Surveyor' },
        { hash: 'e5f6a7b', iso: '2026-07-19T08:12:00.000Z', subject: 'Sync scroll position', author: 'T. Surveyor' },
      ],
      touchedFiles: [
        { path: 'notes/app.js', lastIso: '2026-07-20T18:45:00.000Z', commits: 4 },
      ],
      branches: [
        { name: 'main', current: true, lastCommitIso: '2026-07-20T18:45:00.000Z' },
      ],
    },
    {
      name: 'tide-tables',
      path: `${HOME}/tide-tables`,
      id: 'tide-tables',
      branch: 'main',
      detached: false,
      dirty: false,
      upstream: { state: 'tracked', aheadBy: 3, behindBy: 0 },
      lastCommit: {
        iso: '2026-07-26T21:30:00.000Z',
        subject: 'Harmonic constituents table',
        author: 'T. Surveyor',
      },
      commitDays: makeCommitDays('2025-08-01', '2026-07-26', 303, 0.26),
      loc: { Python: 5210, Markdown: 430 },
      recentCommits: [
        { hash: 'f6a7b8c', iso: '2026-07-26T21:30:00.000Z', subject: 'Harmonic constituents table', author: 'T. Surveyor' },
        { hash: 'a7b8c9d', iso: '2026-07-25T20:11:00.000Z', subject: 'Datum correction pass', author: 'T. Surveyor' },
        { hash: 'b8c9d0e', iso: '2026-07-24T19:03:00.000Z', subject: 'Port prediction kernel', author: 'T. Surveyor' },
      ],
      touchedFiles: [
        { path: 'tides/predict.py', lastIso: '2026-07-26T21:30:00.000Z', commits: 6 },
        { path: 'tides/datum.py', lastIso: '2026-07-25T20:11:00.000Z', commits: 2 },
      ],
      branches: [
        { name: 'main', current: true, lastCommitIso: '2026-07-26T21:30:00.000Z' },
      ],
    },
    {
      name: 'old-survey',
      path: `${HOME}/old-survey`,
      id: 'old-survey',
      branch: 'master',
      detached: false,
      dirty: false,
      upstream: { state: 'tracked', aheadBy: 0, behindBy: 0 },
      lastCommit: {
        iso: '2026-01-10T14:00:00.000Z',
        subject: 'Final triangulation pass',
        author: 'T. Surveyor',
      },
      commitDays: makeCommitDays('2025-08-01', '2026-01-10', 404, 0.12),
      loc: { C: 10480, Makefile: 120 },
      recentCommits: [
        { hash: 'c9d0e1f', iso: '2026-01-10T14:00:00.000Z', subject: 'Final triangulation pass', author: 'T. Surveyor' },
      ],
      touchedFiles: [
        { path: 'src/triangulate.c', lastIso: '2026-01-10T14:00:00.000Z', commits: 2 },
      ],
      branches: [
        { name: 'master', current: true, lastCommitIso: '2026-01-10T14:00:00.000Z' },
      ],
    },
    {
      name: 'meridian',
      path: `${HOME}/meridian`,
      id: 'meridian',
      branch: 'main',
      detached: false,
      dirty: false,
      upstream: { state: 'tracked', aheadBy: 0, behindBy: 0 },
      lastCommit: {
        iso: '2026-07-29T16:20:00.000Z',
        subject: 'Great-circle rendering',
        author: 'T. Surveyor',
      },
      commitDays: makeCommitDays('2025-08-01', '2026-07-29', 505, 0.33),
      loc: { TypeScript: 6710, GLSL: 890, CSS: 300 },
      recentCommits: [
        { hash: 'd0e1f2a', iso: '2026-07-29T16:20:00.000Z', subject: 'Great-circle rendering', author: 'T. Surveyor' },
        { hash: 'e1f2a3b', iso: '2026-07-27T13:55:00.000Z', subject: 'Projection switcher', author: 'T. Surveyor' },
      ],
      touchedFiles: [
        { path: 'src/projection.ts', lastIso: '2026-07-29T16:20:00.000Z', commits: 7 },
      ],
      branches: [
        { name: 'main', current: true, lastCommitIso: '2026-07-29T16:20:00.000Z' },
        { name: 'wip/labels', current: false, lastCommitIso: '2026-06-18T09:30:00.000Z' },
      ],
    },
    {
      name: 'drift-bottle',
      path: `${HOME}/drift-bottle`,
      id: 'drift-bottle',
      branch: 'main',
      detached: false,
      dirty: false,
      upstream: { state: 'none' },
      lastCommit: {
        iso: '2026-07-15T10:05:00.000Z',
        subject: 'Message-in-a-bottle prototype',
        author: 'T. Surveyor',
      },
      commitDays: makeCommitDays('2026-06-01', '2026-07-15', 606, 0.3),
      loc: { Rust: 2140 },
      recentCommits: [
        { hash: 'f2a3b4c', iso: '2026-07-15T10:05:00.000Z', subject: 'Message-in-a-bottle prototype', author: 'T. Surveyor' },
      ],
      touchedFiles: [
        { path: 'src/main.rs', lastIso: '2026-07-15T10:05:00.000Z', commits: 3 },
      ],
      branches: [
        { name: 'main', current: true, lastCommitIso: '2026-07-15T10:05:00.000Z' },
      ],
    },
  ],
  attention: [
    { repoId: 'ember-ledger', reason: 'dirty', lastActivityIso: '2026-07-31T09:14:00.000Z' },
    { repoId: 'field-notes', reason: 'dirty', lastActivityIso: '2026-07-20T18:45:00.000Z' },
    { repoId: 'tide-tables', reason: 'unpushed', lastActivityIso: '2026-07-26T21:30:00.000Z' },
    { repoId: 'old-survey', reason: 'stale', lastActivityIso: '2026-01-10T14:00:00.000Z' },
  ],
};

/**
 * Convenience lookup: fixture repo by id.
 * @param {string} id
 * @returns {RepoSummary}
 */
export function fixtureRepo(id) {
  const repo = fixtureSnapshot.repos.find((r) => r.id === id);
  if (!repo) throw new Error(`fixture has no repo with id "${id}"`);
  return repo;
}
