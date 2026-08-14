// @vitest-environment node
/**
 * Repo Atlas — gitFacts fixture-repo suite.
 *
 * Builds REAL throwaway git repos in a mktemp dir: a normal repo, a dirty
 * repo, a cloned pair for ahead/behind (behind-only, ahead-only, diverged),
 * a no-upstream repo, an empty zero-commit repo, a detached-HEAD checkout,
 * a .git-file worktree, and a plain non-repo directory. Every commit date
 * is an explicit literal (--date + GIT_AUTHOR_DATE/GIT_COMMITTER_DATE) —
 * no network, no Date.now() in assertions. TZ is pinned to America/Chicago
 * by vite.config.ts, so dayKey assertions are machine-independent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitFacts } from './gitFacts.js';
import { dayKey } from '../shared/contract.js';

/* ------------------------------------------------------------------ */
/* Fixture plumbing                                                    */
/* ------------------------------------------------------------------ */

const AUTHOR = 'Ada Surveyor';
const EMAIL = 'ada@example.test';

/** Isolate fixture git from the machine's user/system config entirely. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: AUTHOR,
  GIT_AUTHOR_EMAIL: EMAIL,
  GIT_COMMITTER_NAME: AUTHOR,
  GIT_COMMITTER_EMAIL: EMAIL,
};

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [extraEnv]
 * @returns {string}
 */
function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    env: { ...GIT_ENV, ...extraEnv },
    encoding: 'utf8',
  });
}

/**
 * Commit staged-everything with a pinned author AND committer date.
 * @param {string} cwd
 * @param {string} message
 * @param {string} iso
 */
function commitAll(cwd, message, iso) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message, '--date', iso], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

/**
 * @param {string} dir
 * @param {string} rel
 * @param {string} content
 */
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/* Deterministic fixture dates (all literals, no wall clock). */
const ANCIENT_ISO = '2024-01-15T12:00:00-06:00'; // > 12 months ago
const C1_ISO = '2026-06-05T09:00:00-05:00';
const C2_ISO = '2026-07-10T12:00:00-05:00';
const C3_ISO = '2026-07-10T15:00:00-05:00'; // same local day as C2
const O1_ISO = '2026-07-01T10:00:00-05:00';
const O2_ISO = '2026-07-02T10:00:00-05:00';
const O3_ISO = '2026-07-03T10:00:00-05:00';
const O4_ISO = '2026-07-04T10:00:00-05:00';
const L1_ISO = '2026-07-05T10:00:00-05:00';

/** @type {string} */ let root;
/** @type {string} */ let basicDir;
/** @type {string} */ let dirtyDir;
/** @type {string} */ let originDir;
/** @type {string} */ let behindDir;
/** @type {string} */ let aheadDir;
/** @type {string} */ let divergedDir;
/** @type {string} */ let noUpstreamDir;
/** @type {string} */ let emptyDir;
/** @type {string} */ let detachedDir;
/** @type {string} */ let wtBaseDir;
/** @type {string} */ let worktreeDir;
/** @type {string} */ let nonRepoDir;
/** @type {string} */ let stagedOnlyDir;
/** @type {string} */ let modifiedOnlyDir;
/** @type {string} */ let stagedModDir;
/** @type {string} */ let capDir;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfacts-fixtures-'));

  // -- basic: 4 commits (one ancient), a side branch, clean tree ----------
  basicDir = path.join(root, 'basic');
  fs.mkdirSync(basicDir);
  git(basicDir, ['init', '-q', '-b', 'main']);
  write(basicDir, 'ledger.txt', 'ancient\n');
  commitAll(basicDir, 'ancient shoreline', ANCIENT_ISO);
  write(basicDir, 'a.txt', 'one\n');
  commitAll(basicDir, 'found the survey', C1_ISO);
  write(basicDir, 'a.txt', 'two\n');
  write(basicDir, 'docs/c.txt', 'coast\n');
  commitAll(basicDir, 'chart the coastline', C2_ISO);
  write(basicDir, 'docs/c.txt', 'coast, annotated\n');
  commitAll(basicDir, 'annotate soundings', C3_ISO);
  git(basicDir, ['branch', 'harbor', 'HEAD~1']);

  // -- dirty: one commit plus an untracked file ---------------------------
  dirtyDir = path.join(root, 'dirty');
  fs.mkdirSync(dirtyDir);
  git(dirtyDir, ['init', '-q', '-b', 'main']);
  write(dirtyDir, 'notes.txt', 'kept\n');
  commitAll(dirtyDir, 'first note', C1_ISO);
  write(dirtyDir, 'scratch.txt', 'untracked\n');

  // -- origin + clones for ahead/behind (local filesystem, no network) ----
  originDir = path.join(root, 'origin');
  fs.mkdirSync(originDir);
  git(originDir, ['init', '-q', '-b', 'main']);
  write(originDir, 'log.txt', 'o1\n');
  commitAll(originDir, 'o1', O1_ISO);
  write(originDir, 'log.txt', 'o2\n');
  commitAll(originDir, 'o2', O2_ISO);

  behindDir = path.join(root, 'clone-behind');
  aheadDir = path.join(root, 'clone-ahead');
  divergedDir = path.join(root, 'clone-diverged');
  git(root, ['clone', '-q', originDir, behindDir]);
  git(root, ['clone', '-q', originDir, aheadDir]);
  git(root, ['clone', '-q', originDir, divergedDir]);

  // origin advances by TWO commits after the clones were taken.
  write(originDir, 'log.txt', 'o3\n');
  commitAll(originDir, 'o3', O3_ISO);
  write(originDir, 'log.txt', 'o4\n');
  commitAll(originDir, 'o4', O4_ISO);

  // behind-only: sees origin's new commits, adds none of its own.
  git(behindDir, ['fetch', '-q', 'origin']);

  // ahead-only: does NOT fetch; adds one local commit.
  write(aheadDir, 'local.txt', 'a1\n');
  commitAll(aheadDir, 'a1 local work', L1_ISO);

  // diverged: fetches origin's two new commits AND adds one of its own.
  git(divergedDir, ['fetch', '-q', 'origin']);
  write(divergedDir, 'local.txt', 'l1\n');
  commitAll(divergedDir, 'l1 local work', L1_ISO);

  // -- no-upstream: commits but no remote at all --------------------------
  noUpstreamDir = path.join(root, 'no-upstream');
  fs.mkdirSync(noUpstreamDir);
  git(noUpstreamDir, ['init', '-q', '-b', 'solo']);
  write(noUpstreamDir, 'solo.txt', 'alone\n');
  commitAll(noUpstreamDir, 'solo work', C1_ISO);

  // -- empty: zero commits ------------------------------------------------
  emptyDir = path.join(root, 'empty');
  fs.mkdirSync(emptyDir);
  git(emptyDir, ['init', '-q', '-b', 'main']);

  // -- detached HEAD ------------------------------------------------------
  detachedDir = path.join(root, 'detached');
  fs.mkdirSync(detachedDir);
  git(detachedDir, ['init', '-q', '-b', 'main']);
  write(detachedDir, 'd.txt', 'one\n');
  commitAll(detachedDir, 'd1', C1_ISO);
  write(detachedDir, 'd.txt', 'two\n');
  commitAll(detachedDir, 'd2', C2_ISO);
  git(detachedDir, ['checkout', '-q', '--detach', 'HEAD~1']);

  // -- .git-file worktree -------------------------------------------------
  wtBaseDir = path.join(root, 'wt-base');
  fs.mkdirSync(wtBaseDir);
  git(wtBaseDir, ['init', '-q', '-b', 'main']);
  write(wtBaseDir, 'base.txt', 'base\n');
  commitAll(wtBaseDir, 'base commit', C2_ISO);
  worktreeDir = path.join(root, 'wt-leaf');
  git(wtBaseDir, ['worktree', 'add', '-q', worktreeDir, '-b', 'wt-branch']);

  // -- not a git repo at all ----------------------------------------------
  nonRepoDir = path.join(root, 'not-a-repo');
  fs.mkdirSync(nonRepoDir);
  write(nonRepoDir, 'readme.txt', 'nothing here\n');

  // -- workingTree fixtures ------------------------------------------------
  // staged-only: a new file added to the index, nothing else touched.
  stagedOnlyDir = path.join(root, 'staged-only');
  fs.mkdirSync(stagedOnlyDir);
  git(stagedOnlyDir, ['init', '-q', '-b', 'main']);
  write(stagedOnlyDir, 'base.txt', 'base\n');
  commitAll(stagedOnlyDir, 'base', C1_ISO);
  write(stagedOnlyDir, 'fresh.txt', 'staged\n');
  git(stagedOnlyDir, ['add', 'fresh.txt']);

  // modified-only: a tracked file edited but NOT staged.
  modifiedOnlyDir = path.join(root, 'modified-only');
  fs.mkdirSync(modifiedOnlyDir);
  git(modifiedOnlyDir, ['init', '-q', '-b', 'main']);
  write(modifiedOnlyDir, 'notes.txt', 'v1\n');
  commitAll(modifiedOnlyDir, 'v1', C1_ISO);
  write(modifiedOnlyDir, 'notes.txt', 'v2 unstaged\n');

  // staged+modified: the SAME file staged, then edited again (XY = MM).
  stagedModDir = path.join(root, 'staged-and-modified');
  fs.mkdirSync(stagedModDir);
  git(stagedModDir, ['init', '-q', '-b', 'main']);
  write(stagedModDir, 'both.txt', 'v1\n');
  commitAll(stagedModDir, 'v1', C1_ISO);
  write(stagedModDir, 'both.txt', 'v2 staged\n');
  git(stagedModDir, ['add', 'both.txt']);
  write(stagedModDir, 'both.txt', 'v3 unstaged on top\n');

  // cap: 55 untracked files -> list capped at 50 with truncated=true.
  capDir = path.join(root, 'cap');
  fs.mkdirSync(capDir);
  git(capDir, ['init', '-q', '-b', 'main']);
  write(capDir, 'seed.txt', 'seed\n');
  commitAll(capDir, 'seed', C1_ISO);
  for (let i = 0; i < 55; i += 1) {
    write(capDir, `u${String(i).padStart(2, '0')}.txt`, `${i}\n`);
  }
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Identity + head state                                               */
/* ------------------------------------------------------------------ */

describe('identity and head state', () => {
  it('reports name, absolute path, slug id, branch, and detached=false', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.name).toBe('basic');
    expect(facts.path).toBe(basicDir);
    expect(path.isAbsolute(facts.path)).toBe(true);
    expect(facts.id).toBe('basic');
    expect(facts.branch).toBe('main');
    expect(facts.detached).toBe(false);
  });

  it('detached HEAD reports detached=true with the abbreviated sha as branch', async () => {
    const expectedSha = git(detachedDir, ['rev-parse', '--short', 'HEAD']).trim();
    const facts = await gitFacts(detachedDir);
    expect(facts.detached).toBe(true);
    expect(facts.branch).toBe(expectedSha);
    expect(facts.branch.length).toBeGreaterThanOrEqual(7);
  });
});

/* ------------------------------------------------------------------ */
/* Dirty                                                               */
/* ------------------------------------------------------------------ */

describe('dirty (porcelain non-empty)', () => {
  it('a clean tree is not dirty', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.dirty).toBe(false);
  });

  it('an untracked file makes the repo dirty', async () => {
    const facts = await gitFacts(dirtyDir);
    expect(facts.dirty).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* workingTree — WHAT is dirty (additive runtime field)                */
/* ------------------------------------------------------------------ */

describe('workingTree', () => {
  it('a clean repo carries empty lists and truncated=false', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.workingTree).toEqual({
      staged: [],
      modified: [],
      untracked: [],
      truncated: false,
    });
  });

  it('an untracked-only repo lists exactly the porcelain ?? paths', async () => {
    const facts = await gitFacts(dirtyDir);
    expect(facts.workingTree).toEqual({
      staged: [],
      modified: [],
      untracked: ['scratch.txt'],
      truncated: false,
    });
  });

  it('a staged-only repo lists the file under staged alone', async () => {
    const facts = await gitFacts(stagedOnlyDir);
    expect(facts.workingTree).toEqual({
      staged: ['fresh.txt'],
      modified: [],
      untracked: [],
      truncated: false,
    });
  });

  it('a modified-only repo lists the file under modified alone', async () => {
    const facts = await gitFacts(modifiedOnlyDir);
    expect(facts.workingTree).toEqual({
      staged: [],
      modified: ['notes.txt'],
      untracked: [],
      truncated: false,
    });
  });

  it('a file staged then edited again (XY=MM) appears in BOTH staged and modified', async () => {
    // Precondition: the fixture really is the MM porcelain state.
    const porcelain = git(stagedModDir, ['status', '--porcelain']);
    expect(porcelain).toBe('MM both.txt\n');
    const facts = await gitFacts(stagedModDir);
    expect(facts.workingTree).toEqual({
      staged: ['both.txt'],
      modified: ['both.txt'],
      untracked: [],
      truncated: false,
    });
  });

  it('caps each list at 50 in porcelain order and flags truncated', async () => {
    // Expected order comes straight from git itself: match porcelain exactly.
    const porcelainUntracked = git(capDir, ['status', '--porcelain'])
      .split('\n')
      .filter((line) => line.startsWith('?? '))
      .map((line) => line.slice(3));
    expect(porcelainUntracked).toHaveLength(55);
    const facts = await gitFacts(capDir);
    expect(facts.workingTree.untracked).toHaveLength(50);
    expect(facts.workingTree.untracked).toEqual(porcelainUntracked.slice(0, 50));
    expect(facts.workingTree.truncated).toBe(true);
    expect(facts.workingTree.staged).toEqual([]);
    expect(facts.workingTree.modified).toEqual([]);
  });

  it('hostile fixtures (empty repo, non-repo) degrade to empty lists', async () => {
    const empty = { staged: [], modified: [], untracked: [], truncated: false };
    expect((await gitFacts(emptyDir)).workingTree).toEqual(empty);
    expect((await gitFacts(nonRepoDir)).workingTree).toEqual(empty);
  });
});

/* ------------------------------------------------------------------ */
/* Upstream three-state (the parse-order pin)                          */
/* ------------------------------------------------------------------ */

describe('upstream three-state', () => {
  it('PINS rev-list --left-right --count parse order: a behind-only repo is behind, NEVER ahead', async () => {
    const facts = await gitFacts(behindDir);
    expect(facts.upstream.state).toBe('tracked');
    expect(facts.upstream.behindBy).toBe(2);
    expect(facts.upstream.aheadBy).toBe(0);
  });

  it('an ahead-only repo is ahead, not behind', async () => {
    const facts = await gitFacts(aheadDir);
    expect(facts.upstream).toEqual({ state: 'tracked', aheadBy: 1, behindBy: 0 });
  });

  it('a diverged repo reports the asymmetric counts on the correct sides', async () => {
    const facts = await gitFacts(divergedDir);
    // behind 2 / ahead 1 — asymmetric on purpose, so a swapped parse fails.
    expect(facts.upstream).toEqual({ state: 'tracked', aheadBy: 1, behindBy: 2 });
  });

  it('a branch with no upstream is { state: "none" } — never a zero ahead-count', async () => {
    const facts = await gitFacts(noUpstreamDir);
    expect(facts.upstream).toEqual({ state: 'none' });
    expect(facts.upstream).not.toHaveProperty('aheadBy');
  });

  it('a clone in sync with its upstream is tracked 0/0, not "none"', async () => {
    // divergedDir's origin/main is known-fetched; use a fresh in-sync check
    // via behindDir reset? No — behindDir must stay behind. Use aheadDir's
    // pre-divergence state instead: clone origin again, touching nothing.
    const syncDir = path.join(root, 'clone-sync');
    git(root, ['clone', '-q', originDir, syncDir]);
    const facts = await gitFacts(syncDir);
    expect(facts.upstream).toEqual({ state: 'tracked', aheadBy: 0, behindBy: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Commit history: commitDays, lastCommit, recentCommits               */
/* ------------------------------------------------------------------ */

describe('12-month commit log', () => {
  it('buckets commitDays by author date in the local timezone via dayKey', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.commitDays[dayKey(C1_ISO)]).toBe(1);
    expect(facts.commitDays[dayKey(C2_ISO)]).toBe(2); // C2 + C3 same local day
  });

  it('excludes commits older than 12 months from commitDays', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.commitDays[dayKey(ANCIENT_ISO)]).toBeUndefined();
  });

  it('lastCommit is the newest commit with iso author date, subject, author', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.lastCommit).not.toBeNull();
    expect(Date.parse(facts.lastCommit.iso)).toBe(Date.parse(C3_ISO));
    expect(facts.lastCommit.subject).toBe('annotate soundings');
    expect(facts.lastCommit.author).toBe(AUTHOR);
  });

  it('recentCommits lists up to 15 commits newest first with hash/iso/subject/author', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.recentCommits.map((c) => c.subject)).toEqual([
      'annotate soundings',
      'chart the coastline',
      'found the survey',
      'ancient shoreline',
    ]);
    for (const c of facts.recentCommits) {
      expect(c.hash).toMatch(/^[0-9a-f]{7,}$/);
      expect(Number.isNaN(Date.parse(c.iso))).toBe(false);
      expect(c.author).toBe(AUTHOR);
    }
    expect(Date.parse(facts.recentCommits[0].iso)).toBe(Date.parse(C3_ISO));
  });
});

/* ------------------------------------------------------------------ */
/* Touched files                                                       */
/* ------------------------------------------------------------------ */

describe('touchedFiles', () => {
  it('lists distinct paths most-recently-touched first with lastIso and counts', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.touchedFiles.map((f) => f.path)).toEqual([
      'docs/c.txt',
      'a.txt',
      'ledger.txt',
    ]);
    const [c, a, ledger] = facts.touchedFiles;
    expect(Date.parse(c.lastIso)).toBe(Date.parse(C3_ISO));
    expect(c.commits).toBe(2);
    expect(Date.parse(a.lastIso)).toBe(Date.parse(C2_ISO));
    expect(a.commits).toBe(2);
    expect(ledger.commits).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Branch list                                                         */
/* ------------------------------------------------------------------ */

describe('branches', () => {
  it('lists local branches with the current branch first and marked', async () => {
    const facts = await gitFacts(basicDir);
    expect(facts.branches.map((b) => b.name)).toEqual(['main', 'harbor']);
    expect(facts.branches[0].current).toBe(true);
    expect(facts.branches[1].current).toBe(false);
    expect(Date.parse(facts.branches[0].lastCommitIso)).toBe(Date.parse(C3_ISO));
    expect(Date.parse(facts.branches[1].lastCommitIso)).toBe(Date.parse(C2_ISO));
  });

  it('marks no branch current under detached HEAD', async () => {
    const facts = await gitFacts(detachedDir);
    expect(facts.branches.map((b) => b.name)).toEqual(['main']);
    expect(facts.branches.every((b) => b.current === false)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Tolerance: every hostile fixture yields a partial, never a throw    */
/* ------------------------------------------------------------------ */

describe('tolerance — partial RepoSummary, never a thrown scan failure', () => {
  it('an empty zero-commit repo resolves to a usable partial', async () => {
    const facts = await gitFacts(emptyDir); // must not reject
    expect(facts.name).toBe('empty');
    expect(facts.branch).toBe('main'); // unborn branch still has a name
    expect(facts.detached).toBe(false);
    expect(facts.dirty).toBe(false);
    expect(facts.upstream).toEqual({ state: 'none' });
    expect(facts.lastCommit).toBeNull();
    expect(facts.commitDays).toEqual({});
    expect(facts.recentCommits).toEqual([]);
    expect(facts.touchedFiles).toEqual([]);
    expect(facts.branches).toEqual([]);
  });

  it('a .git-file worktree resolves with full facts', async () => {
    // Precondition: this really is the .git-FILE flavor of checkout.
    expect(fs.statSync(path.join(worktreeDir, '.git')).isFile()).toBe(true);
    const facts = await gitFacts(worktreeDir);
    expect(facts.name).toBe('wt-leaf');
    expect(facts.branch).toBe('wt-branch');
    expect(facts.detached).toBe(false);
    expect(facts.dirty).toBe(false);
    expect(facts.upstream).toEqual({ state: 'none' });
    expect(facts.recentCommits).toHaveLength(1);
    expect(facts.recentCommits[0].subject).toBe('base commit');
    expect(facts.commitDays[dayKey(C2_ISO)]).toBe(1);
  });

  it('a directory that is not a git repo resolves to an inert partial', async () => {
    const facts = await gitFacts(nonRepoDir);
    expect(facts.name).toBe('not-a-repo');
    expect(facts.branch).toBeNull();
    expect(facts.detached).toBe(false);
    expect(facts.dirty).toBe(false);
    expect(facts.upstream).toEqual({ state: 'none' });
    expect(facts.lastCommit).toBeNull();
    expect(facts.commitDays).toEqual({});
    expect(facts.recentCommits).toEqual([]);
    expect(facts.touchedFiles).toEqual([]);
    expect(facts.branches).toEqual([]);
  });

  it('a nonexistent path resolves to an inert partial instead of throwing', async () => {
    const facts = await gitFacts(path.join(root, 'does-not-exist'));
    expect(facts.branch).toBeNull();
    expect(facts.upstream).toEqual({ state: 'none' });
    expect(facts.recentCommits).toEqual([]);
  });

  it('a detached-HEAD repo still yields history facts', async () => {
    const facts = await gitFacts(detachedDir);
    expect(facts.upstream).toEqual({ state: 'none' });
    expect(facts.lastCommit.subject).toBe('d1'); // HEAD sits on the older commit
    expect(facts.commitDays[dayKey(C1_ISO)]).toBe(1);
  });
});
