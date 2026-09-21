/**
 * Repo Atlas — organize: survey of the projects root (plain Node ESM).
 *
 * Part 1 (this task): pure helpers — name filters, stack detection from
 * top-level entry names, remote normalization, description extraction.
 * Part 2 (Task 4): the file walk, light git facts, and surveyProjects().
 *
 * A "project" is a top-level directory of the root that is not the
 * Outdated folder and does not start with a dot. Loose files follow the
 * same dot rule. Nothing here talks to git or the disk.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PRUNED_DIRS, MAX_REPO_FILES } from '../loc.js';
import { readTextOrNull } from './io.js';

const execFileP = promisify(execFile);

/** Archive root folder name inside the projects root. */
export const OUTDATED_DIR = 'Outdated';

/**
 * @param {string} name top-level entry name
 * @returns {boolean} true for dot-names and the Outdated folder
 */
export function isIgnoredName(name) {
  return name.startsWith('.') || name === OUTDATED_DIR;
}

/**
 * @param {string[]} names a directory's own entry names
 * @returns {boolean} true when nothing but .DS_Store is present
 */
export function isEmptyListing(names) {
  return names.every((n) => n === '.DS_Store');
}

/**
 * Top-level marker → stack name. Checked by exact name or by extension.
 * @type {ReadonlyArray<{ stack: string, names?: string[], exts?: string[] }>}
 */
const STACK_MARKERS = Object.freeze([
  { stack: 'node', names: ['package.json'] },
  { stack: 'python', names: ['pyproject.toml', 'requirements.txt'] },
  { stack: 'rust', names: ['Cargo.toml'] },
  { stack: 'go', names: ['go.mod'] },
  { stack: 'swift', names: ['Package.swift'], exts: ['.xcodeproj'] },
  { stack: 'roblox', names: ['default.project.json', 'rojo.json'] },
  { stack: 'java', names: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { stack: 'ableton', exts: ['.als'] },
  { stack: 'html', names: ['index.html'] },
  { stack: 'claude-md', names: ['CLAUDE.md'] },
]);

/**
 * @param {string[]} names a project's top-level entry names
 * @returns {string[]} sorted, unique stack names
 */
export function detectStack(names) {
  const found = new Set();
  for (const marker of STACK_MARKERS) {
    const byName = marker.names?.some((n) => names.includes(n)) ?? false;
    const byExt = marker.exts?.some((ext) => names.some((n) => n.toLowerCase().endsWith(ext))) ?? false;
    if (byName || byExt) found.add(marker.stack);
  }
  return [...found].sort();
}

/**
 * @param {string|null} url raw `git remote get-url origin` output
 * @returns {string|null} 'owner/repo' for GitHub, else the trimmed URL
 */
export function normalizeRemote(url) {
  if (url === null) return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return `${m[1]}/${m[2]}`;
  return trimmed;
}

/** Longest description kept. */
const DESCRIPTION_MAX = 120;

/**
 * @param {string|null} readme README.md text
 * @param {string|null} packageJson package.json text
 * @returns {string|null}
 */
export function parseDescription(readme, packageJson) {
  if (readme !== null) {
    const h1 = readme.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
    if (h1) return tidy(h1.slice(1));
  }
  if (packageJson !== null) {
    try {
      const pkg = JSON.parse(packageJson);
      if (typeof pkg.description === 'string' && pkg.description.trim().length > 0) {
        return tidy(pkg.description);
      }
    } catch {
      // bad JSON contributes nothing
    }
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string} single-spaced, trimmed, capped
 */
function tidy(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
}

/* ------------------------------------------------------------------ */
/* Part 2: disk and git                                                */
/* ------------------------------------------------------------------ */

/** @typedef {Object} ProjectFacts
 * @property {string} name
 * @property {string} path
 * @property {'git'|'folder'} kind
 * @property {boolean} readable
 * @property {string|null} lastCommitIso
 * @property {boolean} dirty
 * @property {number} aheadBy
 * @property {string|null} remote
 * @property {string|null} newestFileIso
 * @property {number} fileCount
 * @property {number} bytes
 * @property {boolean} empty
 * @property {string[]} stack
 * @property {string|null} description
 */
/** @typedef {{ projects: ProjectFacts[], looseFiles: string[], outdated: Record<string, string[]> }} SurveyResult */

/** Default bounded-pool width for per-project facts. */
const DEFAULT_CONCURRENCY = 4;

/** @param {{ name: string }} a @param {{ name: string }} b */
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Run git read-only against a repo. Returns stdout, or null on ANY failure.
 * Same shape as gitFacts.js tryGit; duplicated because gitFacts.js is not
 * edited by this feature.
 * @param {string} repoPath
 * @param {string[]} args
 * @param {typeof execFileP} [execFileFn] injectable for tests
 * @returns {Promise<string|null>}
 */
export async function runGit(repoPath, args, execFileFn = execFileP) {
  try {
    const { stdout } = await execFileFn(
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
 * Newest regular-file mtime, file count, and byte total under `dir`, with
 * loc.js pruning, a file cap, no symlink following, and .DS_Store ignored.
 * Never throws.
 * @param {string} dir
 * @param {{ maxFiles?: number }} [opts]
 * @returns {Promise<{ newestFileIso: string|null, fileCount: number, bytes: number }>}
 */
export async function walkFiles(dir, opts = {}) {
  const maxFiles = opts.maxFiles ?? MAX_REPO_FILES;
  /** @type {number|null} */
  let newestMs = null;
  let fileCount = 0;
  let bytes = 0;

  /** @param {string} d */
  async function visit(d) {
    if (fileCount >= maxFiles) return;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort(byName);
    for (const entry of entries) {
      if (fileCount >= maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (PRUNED_DIRS.has(entry.name)) continue;
        await visit(full);
      } else if (entry.isFile()) {
        if (entry.name === '.DS_Store') continue;
        try {
          const st = await fs.stat(full);
          fileCount += 1;
          bytes += st.size;
          if (newestMs === null || st.mtimeMs > newestMs) newestMs = st.mtimeMs;
        } catch {
          // unreadable file contributes nothing
        }
      }
    }
  }

  await visit(path.resolve(dir));
  return {
    newestFileIso: newestMs === null ? null : new Date(newestMs).toISOString(),
    fileCount,
    bytes,
  };
}

/**
 * @param {string} dir
 * @returns {Promise<string|null>}
 */
export async function readDescription(dir) {
  const [readme, pkg] = await Promise.all([
    readTextOrNull(path.join(dir, 'README.md')),
    readTextOrNull(path.join(dir, 'package.json')),
  ]);
  return parseDescription(readme, pkg);
}

/**
 * Four light read-only git calls. Any failure degrades that one fact.
 * @param {string} dir
 * @param {typeof execFileP} [execFileFn]
 * @returns {Promise<{ lastCommitIso: string|null, dirty: boolean, aheadBy: number, remote: string|null }>}
 */
export async function gitLight(dir, execFileFn) {
  const [log, status, ahead, remote] = await Promise.all([
    runGit(dir, ['log', '-1', '--format=%aI'], execFileFn),
    runGit(dir, ['status', '--porcelain'], execFileFn),
    runGit(dir, ['rev-list', '--count', '@{u}..HEAD'], execFileFn),
    runGit(dir, ['remote', 'get-url', 'origin'], execFileFn),
  ]);
  const lastCommitIso = log === null || log.trim() === '' ? null : log.trim();
  const dirty = status !== null && status.trim().length > 0;
  const n = ahead === null ? NaN : Number.parseInt(ahead.trim(), 10);
  return {
    lastCommitIso,
    dirty,
    aheadBy: Number.isFinite(n) && n > 0 ? n : 0,
    remote: normalizeRemote(remote),
  };
}

/**
 * @param {string} name
 * @param {string} dir
 * @returns {ProjectFacts} the readable:false shape
 */
function unreadableFacts(name, dir) {
  return {
    name, path: dir, kind: 'folder', readable: false,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 0, bytes: 0, empty: false, stack: [], description: null,
  };
}

/**
 * @param {string} dir absolute project directory
 * @param {{ execFileFn?: typeof execFileP, maxFiles?: number }} [opts]
 * @returns {Promise<ProjectFacts>}
 */
export async function projectFacts(dir, opts = {}) {
  const name = path.basename(dir);
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return unreadableFacts(name, dir);
  }
  const names = entries.map((e) => e.name);
  const kind = names.includes('.git') ? 'git' : 'folder';
  const [walk, description, git] = await Promise.all([
    walkFiles(dir, { maxFiles: opts.maxFiles }),
    readDescription(dir),
    kind === 'git'
      ? gitLight(dir, opts.execFileFn)
      : Promise.resolve({ lastCommitIso: null, dirty: false, aheadBy: 0, remote: null }),
  ]);
  return {
    name,
    path: dir,
    kind,
    readable: true,
    ...git,
    ...walk,
    empty: isEmptyListing(names),
    stack: detectStack(names),
    description,
  };
}

/**
 * Entry names inside each subfolder of Outdated/, dot-names dropped.
 * Files directly inside Outdated/ (MOVES.log) are not subfolders and are
 * skipped. Missing Outdated/ → {}.
 * @param {string} outdatedDir
 * @returns {Promise<Record<string, string[]>>}
 */
export async function listOutdated(outdatedDir) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(outdatedDir, { withFileTypes: true });
  } catch {
    return {};
  }
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const entry of entries.sort(byName)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const names = await fs.readdir(path.join(outdatedDir, entry.name));
      out[entry.name] = names.filter((n) => !n.startsWith('.')).sort();
    } catch {
      out[entry.name] = [];
    }
  }
  return out;
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Keeps order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function boundedMap(items, limit, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

/**
 * Survey the top level of `root`. Throws only when `root` itself cannot be
 * read; every per-project failure degrades inside projectFacts. Symlinked
 * top-level entries are not directories to readdir and land in looseFiles.
 * @param {string} root
 * @param {{ execFileFn?: typeof execFileP, maxFiles?: number, concurrency?: number }} [opts]
 * @returns {Promise<SurveyResult>}
 */
export async function surveyProjects(root, opts = {}) {
  const rootAbs = path.resolve(root);
  const entries = (await fs.readdir(rootAbs, { withFileTypes: true })).sort(byName);
  /** @type {string[]} */
  const projectDirs = [];
  /** @type {string[]} */
  const looseFiles = [];
  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    if (entry.isDirectory()) projectDirs.push(path.join(rootAbs, entry.name));
    else looseFiles.push(entry.name);
  }
  const projects = await boundedMap(projectDirs, opts.concurrency ?? DEFAULT_CONCURRENCY, (d) =>
    projectFacts(d, opts),
  );
  const outdated = await listOutdated(path.join(rootAbs, OUTDATED_DIR));
  return { projects, looseFiles, outdated };
}
