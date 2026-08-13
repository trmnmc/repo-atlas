// @vitest-environment node
/**
 * Repo Atlas — scanner suite: discovery walk (depth limit + pruning),
 * LOC classifier (pruning + caps), bounded scan with progress events,
 * snapshot assembly, and the atomic disk cache.
 *
 * Real mktemp fixture repos, the same pattern as gitFacts.test.js: every
 * commit date is an explicit literal (GIT_AUTHOR_DATE/GIT_COMMITTER_DATE),
 * nowIso is always passed in, and TZ is pinned to America/Chicago by
 * vite.config.ts so dayKey assertions are machine-independent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dayKey, isScanEvent } from '../shared/contract.js';
import { walkLoc, countLines, MAX_FILE_BYTES } from './loc.js';
import { discoverRepos, scan } from './scan.js';
import { loadCache, saveCache } from './cache.js';

/* ------------------------------------------------------------------ */
/* Fixture plumbing (mirrors gitFacts.test.js)                         */
/* ------------------------------------------------------------------ */

const AUTHOR = 'Ada Surveyor';
const EMAIL = 'ada@example.test';

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
 */
function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    env: { ...GIT_ENV, ...extraEnv },
    encoding: 'utf8',
  });
}

/**
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

/** Init a git repo at dir with one pinned commit of its current files. */
function initRepo(dir, message, iso) {
  git(dir, ['init', '-q', '-b', 'main']);
  commitAll(dir, message, iso);
}

/* Deterministic instants (all literals, no wall clock). */
const NOW_ISO = '2026-08-01T12:00:00.000Z';
const C1_ISO = '2026-06-05T09:00:00-05:00';
const C2_ISO = '2026-07-10T12:00:00-05:00';
const C3_ISO = '2026-07-10T15:00:00-05:00'; // same local day as C2
const STALE_ISO = '2026-03-01T10:00:00-06:00'; // 153 days before NOW_ISO

/** @type {string} */ let root;
/** @type {string} */ let alphaDir; // dirty repo at depth 1, LOC fixture
/** @type {string} */ let betaDir; // stale repo at depth 2 (nested/beta)
/** @type {string} */ let wtBaseDir; // repo whose .git is a directory
/** @type {string} */ let wtLeafDir; // linked worktree: .git is a FILE
/** @type {string} */ let deepDir; // repo at depth 4 — beyond maxDepth 3
/** @type {string} */ let decoyDir; // real repo vendored under node_modules

const MAX_DEPTH = 3;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-fixtures-'));

  // -- alpha: the LOC + dirty fixture at depth 1 --------------------------
  alphaDir = path.join(root, 'alpha');
  fs.mkdirSync(alphaDir);
  write(alphaDir, 'src/app.js', 'const a = 1;\nconst b = 2;\nexport default a + b;\n');
  write(alphaDir, 'styles.css', 'body { margin: 0 }\nmain { padding: 1rem }\n');
  initRepo(alphaDir, 'found the survey', C1_ISO);
  write(alphaDir, 'notes.md', 'one\ntwo\n');
  commitAll(alphaDir, 'chart the coastline', C2_ISO);
  write(alphaDir, 'src/app.js', 'const a = 1;\nconst b = 2;\nexport default a + b;\n// annotated\n');
  commitAll(alphaDir, 'annotate soundings', C3_ISO);
  // Untracked debris -> alpha is dirty. None of it may leak into LOC:
  write(alphaDir, 'node_modules/lib/junk.js', 'x\n'.repeat(500));
  write(alphaDir, 'dist/bundle.js', 'y\n'.repeat(500));
  write(alphaDir, 'big.js', '// pad\n'.repeat(Math.ceil((MAX_FILE_BYTES + 1024) / 7)));
  write(alphaDir, 'scratch.txt', 'untracked\n');
  // A nested repo INSIDE alpha: descent stops at alpha, so never discovered.
  const subDir = path.join(alphaDir, 'subrepo');
  fs.mkdirSync(subDir);
  write(subDir, 'inner.txt', 'inner\n');
  initRepo(subDir, 'inner repo', C1_ISO);
  // A real decoy repo vendored under alpha's node_modules.
  decoyDir = path.join(alphaDir, 'node_modules', 'decoy');
  fs.mkdirSync(decoyDir, { recursive: true });
  write(decoyDir, 'decoy.js', 'never counted\n');
  initRepo(decoyDir, 'decoy repo', C1_ISO);

  // -- nested/beta: clean but stale, at depth 2 ---------------------------
  betaDir = path.join(root, 'nested', 'beta');
  fs.mkdirSync(betaDir, { recursive: true });
  write(betaDir, 'beta.py', 'print(1)\nprint(2)\n');
  initRepo(betaDir, 'old survey', STALE_ISO);

  // -- wt-base + wt-leaf: .git DIRECTORY and .git FILE flavors ------------
  wtBaseDir = path.join(root, 'wt-base');
  fs.mkdirSync(wtBaseDir);
  write(wtBaseDir, 'base.txt', 'base\n');
  initRepo(wtBaseDir, 'base commit', C2_ISO);
  wtLeafDir = path.join(root, 'wt-leaf');
  git(wtBaseDir, ['worktree', 'add', '-q', wtLeafDir, '-b', 'wt-branch']);

  // -- deep: a genuine repo but beyond maxDepth 3 -------------------------
  deepDir = path.join(root, 'd1', 'd2', 'd3', 'deep');
  fs.mkdirSync(deepDir, { recursive: true });
  write(deepDir, 'deep.txt', 'deep\n');
  initRepo(deepDir, 'too deep', C1_ISO);

  // -- root-level node_modules decoy + inert plain directory --------------
  const rootDecoy = path.join(root, 'node_modules', 'root-decoy');
  fs.mkdirSync(rootDecoy, { recursive: true });
  write(rootDecoy, 'x.txt', 'x\n');
  initRepo(rootDecoy, 'root decoy', C1_ISO);
  write(root, 'misc/readme.txt', 'not a repo\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* discoverRepos: pruning, depth limit, worktree files                 */
/* ------------------------------------------------------------------ */

describe('discoverRepos', () => {
  it('finds .git directories AND .git-file worktrees, sorted, at any depth within maxDepth', async () => {
    const repos = await discoverRepos(root, { maxDepth: MAX_DEPTH });
    expect(repos).toEqual([alphaDir, betaDir, wtBaseDir, wtLeafDir]);
    // Precondition sanity: wt-leaf really is the .git-FILE flavor.
    expect(fs.statSync(path.join(wtLeafDir, '.git')).isFile()).toBe(true);
  });

  it('never enters node_modules: a real decoy repo vendored there is not discovered', async () => {
    const repos = await discoverRepos(root, { maxDepth: MAX_DEPTH });
    expect(repos).not.toContain(decoyDir);
    expect(repos.some((p) => p.includes(`${path.sep}node_modules${path.sep}`))).toBe(false);
  });

  it('stops descent at a discovered repo: a nested subrepo is not listed separately', async () => {
    const repos = await discoverRepos(root, { maxDepth: MAX_DEPTH });
    expect(repos).not.toContain(path.join(alphaDir, 'subrepo'));
  });

  it('does not descend past maxDepth: the depth-4 repo is invisible at maxDepth 3', async () => {
    const shallow = await discoverRepos(root, { maxDepth: MAX_DEPTH });
    expect(shallow).not.toContain(deepDir);
    // ...but a deeper limit finds it, proving the repo itself is genuine.
    const deep = await discoverRepos(root, { maxDepth: 4 });
    expect(deep).toContain(deepDir);
  });

  it('a nonexistent root yields an empty list, never a throw', async () => {
    await expect(discoverRepos(path.join(root, 'no-such-dir'))).resolves.toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* walkLoc: classification, walk-time pruning, caps                    */
/* ------------------------------------------------------------------ */

describe('walkLoc', () => {
  it('classifies lines by language from extension, pruning node_modules/dist and skipping >1MB files', async () => {
    const loc = await walkLoc(alphaDir);
    // src/app.js is 4 lines (annotated); junk.js (node_modules), bundle.js
    // (dist), decoy.js (node_modules/decoy) and big.js (>1MB) contribute 0.
    expect(loc.JavaScript).toBe(4);
    expect(loc.CSS).toBe(2);
    expect(loc.Markdown).toBe(2);
    // subrepo/inner.txt and scratch.txt: unknown extensions, never counted.
    expect(Object.keys(loc).sort()).toEqual(['CSS', 'JavaScript', 'Markdown']);
  });

  it('enforces the per-repo file cap deterministically (sorted walk order)', async () => {
    const capDir = path.join(root, 'cap-fixture');
    write(capDir, 'a.py', 'l1\nl2\n');
    write(capDir, 'b.py', 'l1\nl2\nl3\n');
    write(capDir, 'c.py', 'l1\nl2\nl3\nl4\n');
    const capped = await walkLoc(capDir, { maxFiles: 2 });
    expect(capped).toEqual({ Python: 5 }); // a.py + b.py only
    const uncapped = await walkLoc(capDir);
    expect(uncapped).toEqual({ Python: 9 });
  });

  it('a nonexistent path yields {} — never a throw', async () => {
    await expect(walkLoc(path.join(root, 'gone'))).resolves.toEqual({});
  });

  it('countLines: trailing newline adds no phantom line; empty content is 0', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one')).toBe(1);
    expect(countLines('one\ntwo\n')).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* scan: bounded survey, progress events, snapshot assembly            */
/* ------------------------------------------------------------------ */

describe('scan', () => {
  /** @type {import('../shared/contract.js').Snapshot} */ let snapshot;
  /** @type {import('../shared/contract.js').ScanEvent[]} */ let events;

  beforeAll(async () => {
    events = [];
    snapshot = await scan(root, {
      onProgress: (e) => events.push(e),
      concurrency: 2,
      nowIso: NOW_ISO,
      maxDepth: MAX_DEPTH,
    });
  });

  it('emits contract-valid start / repo×N / done events with ordered done counts', () => {
    expect(events.length).toBe(6); // start + 4 repos + done
    for (const e of events) expect(isScanEvent(e)).toBe(true);
    expect(events[0]).toEqual({ phase: 'start', done: 0, total: 4 });
    const repoEvents = events.slice(1, 5);
    expect(repoEvents.map((e) => e.phase)).toEqual(['repo', 'repo', 'repo', 'repo']);
    expect(repoEvents.map((e) => e.done)).toEqual([1, 2, 3, 4]);
    expect(repoEvents.every((e) => e.total === 4)).toBe(true);
    expect(repoEvents.map((e) => e.repo).sort()).toEqual([
      'alpha',
      'beta',
      'wt-base',
      'wt-leaf',
    ]);
    expect(events[5]).toEqual({ phase: 'done', done: 4, total: 4 });
  });

  it('assembles a contract Snapshot: generatedAt is the injected nowIso, repos in discovery order', () => {
    expect(snapshot.generatedAt).toBe(NOW_ISO);
    expect(snapshot.repos.map((r) => r.name)).toEqual(['alpha', 'beta', 'wt-base', 'wt-leaf']);
    expect(snapshot.repos.map((r) => r.path)).toEqual([alphaDir, betaDir, wtBaseDir, wtLeafDir]);
  });

  it('merges walkLoc into each RepoSummary with pruned directories excluded', () => {
    const alpha = snapshot.repos.find((r) => r.name === 'alpha');
    expect(alpha.loc).toEqual({ JavaScript: 4, CSS: 2, Markdown: 2 });
    const beta = snapshot.repos.find((r) => r.name === 'beta');
    expect(beta.loc).toEqual({ Python: 2 });
  });

  it('heatmap counts are keyed by author-date local-timezone dayKey', () => {
    const alpha = snapshot.repos.find((r) => r.name === 'alpha');
    expect(alpha.commitDays[dayKey(C1_ISO)]).toBe(1);
    expect(alpha.commitDays[dayKey(C2_ISO)]).toBe(2); // C2 + C3, same local day
  });

  it('attention is the pre-sorted queue: dirty alpha outranks stale beta; clean repos absent', () => {
    expect(snapshot.attention.map((a) => [a.repoId, a.reason])).toEqual([
      ['alpha', 'dirty'],
      ['beta', 'stale'],
    ]);
    expect(Date.parse(snapshot.attention[0].lastActivityIso)).toBe(Date.parse(C3_ISO));
  });

  it('a concurrency-1 scan produces the identical snapshot (pool width changes nothing)', async () => {
    const serial = await scan(root, { concurrency: 1, nowIso: NOW_ISO, maxDepth: MAX_DEPTH });
    expect(serial).toEqual(snapshot);
  });
});

/* ------------------------------------------------------------------ */
/* cache: atomic write, intact round-trip, corrupt -> null             */
/* ------------------------------------------------------------------ */

describe('cache', () => {
  it('a saved snapshot round-trips intact on next boot, leaving no temp debris', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cache-'));
    const file = path.join(cacheDir, '.atlas-cache.json');
    const snapshot = await scan(root, { nowIso: NOW_ISO, maxDepth: MAX_DEPTH });
    await saveCache(file, snapshot);
    expect(fs.readdirSync(cacheDir)).toEqual(['.atlas-cache.json']); // atomic: tmp renamed away
    const loaded = await loadCache(file);
    expect(loaded).toEqual(snapshot);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('a missing cache file loads as null, never a throw', async () => {
    await expect(loadCache(path.join(root, 'nope', '.atlas-cache.json'))).resolves.toBeNull();
  });

  it('a corrupt cache file loads as null, never a throw', async () => {
    const file = path.join(root, '.atlas-cache-corrupt.json');
    fs.writeFileSync(file, '{"generatedAt": "2026-08-01T12:00:00Z", "repos": [');
    await expect(loadCache(file)).resolves.toBeNull();
  });

  it('valid JSON that is not Snapshot-shaped loads as null', async () => {
    const file = path.join(root, '.atlas-cache-shape.json');
    fs.writeFileSync(file, JSON.stringify({ hello: 'world' }));
    await expect(loadCache(file)).resolves.toBeNull();
    fs.writeFileSync(file, JSON.stringify([1, 2, 3]));
    await expect(loadCache(file)).resolves.toBeNull();
  });
});
