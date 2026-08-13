/**
 * Repo Atlas — git plumbing facts for one repository.
 *
 * Plain Node ESM, zero flags, zero build. Shells out to git exclusively via
 * execFile (argv arrays — never a string-interpolated shell), and NEVER
 * throws: every git invocation is individually guarded, so hostile inputs
 * (empty zero-commit repos, .git-file worktrees, detached HEAD, branches
 * with no upstream, directories that are not repos at all) each degrade to
 * a usable partial RepoSummary.
 *
 * Upstream is the frozen three-state contract shape:
 *   { state: 'tracked', aheadBy, behindBy } | { state: 'none' }
 * A repo with no upstream is ALWAYS { state: 'none' } — never a zero
 * ahead-count. Parse-order note for `rev-list --left-right --count
 * @{u}...HEAD`: the LEFT count belongs to @{u} (commits we are BEHIND by),
 * the RIGHT count belongs to HEAD (commits we are AHEAD by). Pinned by
 * fixture test in gitFacts.test.js.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { dayKey } from '../shared/contract.js';

const execFileP = promisify(execFile);

/** @typedef {import('../shared/contract.js').RepoSummary} RepoSummary */
/** @typedef {import('../shared/contract.js').Upstream} Upstream */
/** @typedef {import('../shared/contract.js').CommitInfo} CommitInfo */
/** @typedef {import('../shared/contract.js').TouchedFile} TouchedFile */
/** @typedef {import('../shared/contract.js').BranchInfo} BranchInfo */
/** @typedef {import('../shared/contract.js').LastCommit} LastCommit */

/** How many commits feed recentCommits. */
const RECENT_COMMITS = 15;
/** How many distinct paths feed touchedFiles. */
const TOUCHED_FILES = 10;
/** How many commits the name-only log inspects for touchedFiles. */
const TOUCHED_WINDOW = 30;

/**
 * Run git against a repo, returning stdout, or null on ANY failure
 * (non-zero exit, missing directory, not a repo, unborn branch, ...).
 * @param {string} repoPath
 * @param {string[]} args
 * @returns {Promise<string | null>}
 */
async function tryGit(repoPath, args) {
  try {
    const { stdout } = await execFileP(
      'git',
      ['-C', repoPath, '-c', 'core.quotepath=false', ...args],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Kebab-case slug of a path fragment.
 * @param {string} fragment
 * @returns {string}
 */
function slugify(fragment) {
  return fragment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable id: kebab-case of the path under ~/Projects when the repo lives
 * there, otherwise kebab-case of the directory name.
 * @param {string} absPath
 * @returns {string}
 */
function repoId(absPath) {
  const root = path.join(os.homedir(), 'Projects');
  const fragment = absPath.startsWith(root + path.sep)
    ? absPath.slice(root.length + 1)
    : path.basename(absPath);
  return slugify(fragment);
}

/**
 * Split one `%aI%x09%s%x09%an`-style log line whose subject may itself
 * contain tabs: `nLead` fields before the subject, author is always last.
 * @param {string} line
 * @param {number} nLead
 * @returns {{ lead: string[], subject: string, author: string } | null}
 */
function splitLogLine(line, nLead) {
  const parts = line.split('\t');
  if (parts.length < nLead + 2) return null;
  return {
    lead: parts.slice(0, nLead),
    subject: parts.slice(nLead, parts.length - 1).join('\t'),
    author: parts[parts.length - 1],
  };
}

/**
 * Branch name / detached state.
 * @param {string} repoPath
 * @returns {Promise<{ branch: string | null, detached: boolean }>}
 */
async function readHead(repoPath) {
  const sym = await tryGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (sym !== null && sym.trim() !== '') {
    return { branch: sym.trim(), detached: false };
  }
  // Detached HEAD: report the abbreviated commit hash.
  const sha = await tryGit(repoPath, ['rev-parse', '--short', 'HEAD']);
  if (sha !== null && sha.trim() !== '') {
    return { branch: sha.trim(), detached: true };
  }
  return { branch: null, detached: false };
}

/**
 * Three-state upstream. `@{u}...HEAD` left count = commits only on the
 * upstream (behind), right count = commits only on HEAD (ahead).
 * @param {string} repoPath
 * @returns {Promise<Upstream>}
 */
async function readUpstream(repoPath) {
  const out = await tryGit(repoPath, [
    'rev-list',
    '--left-right',
    '--count',
    '@{u}...HEAD',
  ]);
  if (out === null) return { state: 'none' };
  const m = out.trim().split(/\s+/);
  const behindBy = Number.parseInt(m[0], 10);
  const aheadBy = Number.parseInt(m[1], 10);
  if (!Number.isInteger(behindBy) || !Number.isInteger(aheadBy)) {
    return { state: 'none' };
  }
  return { state: 'tracked', aheadBy, behindBy };
}

/**
 * Sparse local-timezone day -> commit-count map over the last 12 months.
 * @param {string} repoPath
 * @returns {Promise<Record<string, number>>}
 */
async function readCommitDays(repoPath) {
  const out = await tryGit(repoPath, [
    'log',
    '--since=12.months',
    '--pretty=%aI',
  ]);
  /** @type {Record<string, number>} */
  const days = {};
  if (out === null) return days;
  for (const line of out.split('\n')) {
    const iso = line.trim();
    if (iso === '') continue;
    const key = dayKey(iso);
    days[key] = (days[key] ?? 0) + 1;
  }
  return days;
}

/**
 * Most recent commit regardless of age, or null in a zero-commit repo.
 * @param {string} repoPath
 * @returns {Promise<LastCommit | null>}
 */
async function readLastCommit(repoPath) {
  const out = await tryGit(repoPath, ['log', '-1', '--pretty=%aI%x09%s%x09%an']);
  if (out === null) return null;
  const parsed = splitLogLine(out.trim(), 1);
  if (parsed === null) return null;
  return { iso: parsed.lead[0], subject: parsed.subject, author: parsed.author };
}

/**
 * Last RECENT_COMMITS commits, newest first.
 * @param {string} repoPath
 * @returns {Promise<CommitInfo[]>}
 */
async function readRecentCommits(repoPath) {
  const out = await tryGit(repoPath, [
    'log',
    `-${RECENT_COMMITS}`,
    '--pretty=%h%x09%aI%x09%s%x09%an',
  ]);
  if (out === null) return [];
  /** @type {CommitInfo[]} */
  const commits = [];
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    const parsed = splitLogLine(line, 2);
    if (parsed === null) continue;
    commits.push({
      hash: parsed.lead[0],
      iso: parsed.lead[1],
      subject: parsed.subject,
      author: parsed.author,
    });
  }
  return commits;
}

/**
 * Last TOUCHED_FILES distinct changed paths (most recently touched first),
 * from a name-only log over the last TOUCHED_WINDOW commits.
 * @param {string} repoPath
 * @returns {Promise<TouchedFile[]>}
 */
async function readTouchedFiles(repoPath) {
  const out = await tryGit(repoPath, [
    'log',
    `-${TOUCHED_WINDOW}`,
    '--name-only',
    '--pretty=format:%x01%aI',
  ]);
  if (out === null) return [];
  /** @type {Map<string, TouchedFile>} */
  const byPath = new Map();
  let currentIso = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('\u0001')) {
      currentIso = line.slice(1).trim();
      continue;
    }
    const file = line.trim();
    if (file === '' || currentIso === '') continue;
    const existing = byPath.get(file);
    if (existing) {
      existing.commits += 1; // log is newest-first; first sighting is lastIso
    } else {
      byPath.set(file, { path: file, lastIso: currentIso, commits: 1 });
    }
  }
  return [...byPath.values()].slice(0, TOUCHED_FILES);
}

/**
 * Local branches, current first, then by tip author date descending.
 * @param {string} repoPath
 * @param {string | null} currentBranch
 * @param {boolean} detached
 * @returns {Promise<BranchInfo[]>}
 */
async function readBranches(repoPath, currentBranch, detached) {
  const out = await tryGit(repoPath, [
    'for-each-ref',
    'refs/heads',
    '--format=%(refname:short)%09%(authordate:iso-strict)',
  ]);
  if (out === null) return [];
  /** @type {BranchInfo[]} */
  const branches = [];
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const name = line.slice(0, tab);
    const lastCommitIso = line.slice(tab + 1).trim();
    branches.push({
      name,
      current: !detached && name === currentBranch,
      lastCommitIso,
    });
  }
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return Date.parse(b.lastCommitIso) - Date.parse(a.lastCommitIso);
  });
  return branches;
}

/**
 * Collect the git-derived fields of RepoSummary for one repo. Never throws;
 * anything git cannot answer degrades to the tolerant default (null branch,
 * empty maps/lists, upstream { state: 'none' }).
 *
 * @param {string} repoPath
 * @returns {Promise<Pick<RepoSummary,
 *   'name' | 'path' | 'id' | 'branch' | 'detached' | 'dirty' | 'upstream' |
 *   'lastCommit' | 'commitDays' | 'recentCommits' | 'touchedFiles' |
 *   'branches'>>}
 */
export async function gitFacts(repoPath) {
  const abs = path.resolve(repoPath);
  const { branch, detached } = await readHead(abs);
  const status = await tryGit(abs, ['status', '--porcelain']);

  const [upstream, commitDays, lastCommit, recentCommits, touchedFiles, branches] =
    await Promise.all([
      readUpstream(abs),
      readCommitDays(abs),
      readLastCommit(abs),
      readRecentCommits(abs),
      readTouchedFiles(abs),
      readBranches(abs, branch, detached),
    ]);

  return {
    name: path.basename(abs),
    path: abs,
    id: repoId(abs),
    branch,
    detached,
    dirty: status !== null && status.trim().length > 0,
    upstream,
    lastCommit,
    commitDays,
    recentCommits,
    touchedFiles,
    branches,
  };
}
