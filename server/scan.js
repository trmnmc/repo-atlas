/**
 * Repo Atlas — repository discovery and full-snapshot scan (plain Node ESM).
 *
 * discoverRepos(rootDir, { maxDepth }) walks under rootDir finding git
 * repositories — a directory containing `.git` as EITHER a directory (a
 * normal checkout) or a file (a linked worktree). The walk shares loc.js's
 * pruning (node_modules etc. are never entered, so a decoy repo vendored
 * under node_modules is never discovered), stops descending once a repo is
 * found (no nested-repo double counting), and never descends past maxDepth.
 *
 * scan(rootDir, { onProgress, concurrency, nowIso }) surveys every
 * discovered repo — gitFacts + walkLoc — through a bounded worker pool and
 * assembles a full contract Snapshot. Progress arrives as contract
 * ScanEvents: one 'start', one 'repo' per completed repo (done/total), one
 * 'done'. `nowIso` is always passed in by tests; Date.now() never appears
 * in a code path a test asserts on.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { isScanEvent } from '../shared/contract.js';
import { gitFacts } from './gitFacts.js';
import { walkLoc, PRUNED_DIRS } from './loc.js';
import { buildAttention } from './attention.js';

/** @typedef {import('../shared/contract.js').Snapshot} Snapshot */
/** @typedef {import('../shared/contract.js').RepoSummary} RepoSummary */
/** @typedef {import('../shared/contract.js').ScanEvent} ScanEvent */

/** Default maximum directory depth below rootDir a repo may sit at. */
export const DEFAULT_MAX_DEPTH = 4;

/** Default bounded-pool width for the per-repo survey. */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Discover git repos under rootDir. A repo is a directory whose readdir
 * lists a `.git` entry (directory OR file — linked worktrees use a file).
 * Pruned directory names (loc.js PRUNED_DIRS) are never entered, descent
 * stops at a discovered repo, and no directory deeper than maxDepth below
 * rootDir is entered. Results are absolute paths, sorted for determinism.
 *
 * @param {string} rootDir
 * @param {{ maxDepth?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function discoverRepos(rootDir, opts = {}) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  /** @type {string[]} */
  const repos = [];

  /**
   * @param {string} dir
   * @param {number} depth depth of `dir` below rootDir (root itself is 0)
   */
  async function visit(dir, depth) {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable or nonexistent: contributes nothing
    }
    if (entries.some((e) => e.name === '.git')) {
      repos.push(dir);
      return; // a repo: never descend into it looking for nested repos
    }
    if (depth >= maxDepth) return; // children would exceed maxDepth
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (PRUNED_DIRS.has(entry.name)) continue; // pruned: NEVER entered
      await visit(path.join(dir, entry.name), depth + 1);
    }
  }

  await visit(path.resolve(rootDir), 0);
  repos.sort();
  return repos;
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 * Results keep input order regardless of completion order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function boundedPool(items, limit, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Validate-then-emit a ScanEvent to an optional observer.
 * @param {((event: ScanEvent) => void) | undefined} onProgress
 * @param {ScanEvent} event
 */
function emit(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  if (!isScanEvent(event)) return; // server validates before emitting
  onProgress(event);
}

/**
 * Full scan: discover repos, survey each (gitFacts + walkLoc) through a
 * bounded pool, and assemble a contract Snapshot. Repos appear in the
 * snapshot in deterministic discovery order regardless of which finished
 * first; `done` in progress events counts completions.
 *
 * @param {string} rootDir
 * @param {{
 *   onProgress?: (event: ScanEvent) => void,
 *   concurrency?: number,
 *   nowIso?: string,
 *   maxDepth?: number,
 * }} [opts] `nowIso` defaults to the wall clock for production use only —
 *   deterministic callers (tests, the cache layer) always pass it.
 * @returns {Promise<Snapshot>}
 */
export async function scan(rootDir, opts = {}) {
  const {
    onProgress,
    concurrency = DEFAULT_CONCURRENCY,
    nowIso = new Date().toISOString(),
    maxDepth,
  } = opts;

  const repoPaths = await discoverRepos(rootDir, { maxDepth });
  const total = repoPaths.length;
  emit(onProgress, { phase: 'start', done: 0, total });

  let done = 0;
  /** @type {RepoSummary[]} */
  const repos = await boundedPool(repoPaths, concurrency, async (repoPath) => {
    const [facts, loc] = await Promise.all([gitFacts(repoPath), walkLoc(repoPath)]);
    /** @type {RepoSummary} */
    const summary = { ...facts, loc };
    done += 1;
    emit(onProgress, { phase: 'repo', repo: summary.name, done, total });
    return summary;
  });

  const snapshot = {
    generatedAt: nowIso,
    repos,
    // buildAttention derives staleness from lastCommit.iso; a zero-commit
    // repo (lastCommit null) has no activity to rank and is excluded.
    attention: buildAttention(repos.filter((r) => r.lastCommit !== null), nowIso),
  };
  emit(onProgress, { phase: 'done', done, total });
  return snapshot;
}
