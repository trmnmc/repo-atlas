// @vitest-environment node
/**
 * Repo Atlas — organize/survey: pure helpers (part 1) and the real-fixture
 * survey (part 2, appended in Task 4).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OUTDATED_DIR,
  isIgnoredName,
  isEmptyListing,
  detectStack,
  normalizeRemote,
  parseDescription,
  walkFiles,
  projectFacts,
  listOutdated,
  surveyProjects,
} from './survey.js';

describe('isIgnoredName', () => {
  it('ignores dot-names and the Outdated folder', () => {
    expect(OUTDATED_DIR).toBe('Outdated');
    expect(isIgnoredName('.DS_Store')).toBe(true);
    expect(isIgnoredName('.git')).toBe(true);
    expect(isIgnoredName('Outdated')).toBe(true);
    expect(isIgnoredName('repo-atlas')).toBe(false);
    expect(isIgnoredName('BAT-Scanner 2.zip')).toBe(false);
  });
});

describe('isEmptyListing', () => {
  it('treats .DS_Store-only as empty', () => {
    expect(isEmptyListing([])).toBe(true);
    expect(isEmptyListing(['.DS_Store'])).toBe(true);
    expect(isEmptyListing(['.DS_Store', 'a.txt'])).toBe(false);
    expect(isEmptyListing(['node_modules'])).toBe(false);
  });
});

describe('detectStack', () => {
  it('maps top-level markers to stack names, sorted', () => {
    expect(detectStack(['package.json', 'index.html', 'CLAUDE.md'])).toEqual(['claude-md', 'html', 'node']);
    expect(detectStack(['pyproject.toml'])).toEqual(['python']);
    expect(detectStack(['requirements.txt'])).toEqual(['python']);
    expect(detectStack(['Cargo.toml', 'go.mod'])).toEqual(['go', 'rust']);
    expect(detectStack(['Package.swift'])).toEqual(['swift']);
    expect(detectStack(['App.xcodeproj'])).toEqual(['swift']);
    expect(detectStack(['default.project.json'])).toEqual(['roblox']);
    expect(detectStack(['rojo.json'])).toEqual(['roblox']);
    expect(detectStack(['pom.xml'])).toEqual(['java']);
    expect(detectStack(['build.gradle.kts'])).toEqual(['java']);
    expect(detectStack(['seeing-stars.als', 'Samples'])).toEqual(['ableton']);
    expect(detectStack(['README.md'])).toEqual([]);
  });
  it('never duplicates a stack name', () => {
    expect(detectStack(['pyproject.toml', 'requirements.txt'])).toEqual(['python']);
  });
});

describe('normalizeRemote', () => {
  it('reduces GitHub https and ssh URLs to owner/repo', () => {
    expect(normalizeRemote('https://github.com/trmnmc/repo-atlas.git')).toBe('trmnmc/repo-atlas');
    expect(normalizeRemote('https://github.com/trmnmc/repo-atlas')).toBe('trmnmc/repo-atlas');
    expect(normalizeRemote('git@github.com:trmnmc/SWARM.git')).toBe('trmnmc/SWARM');
    expect(normalizeRemote('ssh://git@github.com/trmnmc/moon.git')).toBe('trmnmc/moon');
  });
  it('passes other URLs through trimmed and returns null for null/empty', () => {
    expect(normalizeRemote('https://gitlab.com/a/b.git\n')).toBe('https://gitlab.com/a/b.git');
    expect(normalizeRemote(null)).toBeNull();
    expect(normalizeRemote('   ')).toBeNull();
  });
});

describe('parseDescription', () => {
  it('prefers the first README H1, stripped', () => {
    expect(parseDescription('# Repo Atlas\n\nA local mission-control.\n', '{"description":"x"}')).toBe('Repo Atlas');
    expect(parseDescription('Intro line\n\n# BaT Value Map — scraper\n', null)).toBe('BaT Value Map — scraper');
  });
  it('ignores H2 and falls back to package.json description', () => {
    expect(parseDescription('## Not a title\n', '{"description":"From package"}')).toBe('From package');
    expect(parseDescription(null, '{"description":"From package"}')).toBe('From package');
  });
  it('returns null when neither source has one, and survives bad JSON', () => {
    expect(parseDescription(null, null)).toBeNull();
    expect(parseDescription('no heading\n', '{ nope')).toBeNull();
    expect(parseDescription(null, '{"name":"x"}')).toBeNull();
  });
  it('collapses inner whitespace and caps at 120 characters', () => {
    expect(parseDescription('#   Two   words  \n', null)).toBe('Two words');
    const long = `# ${'x'.repeat(200)}\n`;
    expect(parseDescription(long, null)?.length).toBe(120);
  });
});

/* ------------------------------------------------------------------ */
/* Part 2: real fixture root                                            */
/* ------------------------------------------------------------------ */

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: 'Ada Surveyor',
  GIT_AUTHOR_EMAIL: 'ada@example.test',
  GIT_COMMITTER_NAME: 'Ada Surveyor',
  GIT_COMMITTER_EMAIL: 'ada@example.test',
};
function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-C', cwd, ...args], { env: { ...GIT_ENV, ...extraEnv }, encoding: 'utf8' });
}
function commitAll(cwd, message, iso) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message, '--date', iso], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
}
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function touch(file, iso) {
  const d = new Date(iso);
  fs.utimesSync(file, d, d);
}

const ALPHA_ISO = '2026-06-05T09:00:00-05:00';
const BETA_ISO = '2026-07-10T12:00:00-05:00';
const ONE_ISO = '2026-08-01T10:00:00-05:00';
const JUNK_ISO = '2026-09-15T10:00:00-05:00';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-survey-'));

  // alpha: git, one commit, README + package.json, clean, no remote
  const alpha = path.join(root, 'alpha');
  fs.mkdirSync(alpha);
  git(alpha, ['init', '-q', '-b', 'main']);
  write(alpha, 'README.md', '# Alpha Project\n\nwords\n');
  write(alpha, 'package.json', '{"name":"alpha","description":"pkg desc"}\n');
  commitAll(alpha, 'first', ALPHA_ISO);

  // beta: cloned from a bare origin (kept under a dot-dir so it is ignored),
  // one commit ahead, one untracked file, remote URL rewritten to GitHub
  const origins = path.join(root, '.origins');
  fs.mkdirSync(origins);
  const bare = path.join(origins, 'beta.git');
  git(root, ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = path.join(origins, 'seed');
  git(root, ['clone', '-q', bare, seed]);
  write(seed, 'a.txt', 'a\n');
  commitAll(seed, 'seed', ALPHA_ISO);
  git(seed, ['push', '-q', 'origin', 'HEAD:main']);
  const beta = path.join(root, 'beta');
  git(root, ['clone', '-q', bare, beta]);
  write(beta, 'b.txt', 'b\n');
  commitAll(beta, 'ahead', BETA_ISO);
  write(beta, 'untracked.txt', 'u\n');
  git(beta, ['remote', 'set-url', 'origin', 'https://github.com/example/beta.git']);

  // gamma: plain folder; node_modules is pruned; .DS_Store ignored
  const gamma = path.join(root, 'gamma');
  write(gamma, 'notes/one.txt', 'hello\n');
  write(gamma, 'node_modules/junk.js', 'x'.repeat(500));
  write(gamma, '.DS_Store', '');
  touch(path.join(gamma, 'notes/one.txt'), ONE_ISO);
  touch(path.join(gamma, 'node_modules/junk.js'), JUNK_ISO);

  // empty: only .DS_Store
  const empty = path.join(root, 'empty');
  write(empty, '.DS_Store', '');

  // Outdated convention + a loose file + an ignored dot-file
  fs.mkdirSync(path.join(root, 'Outdated', 'archived-projects', 'old-one'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Outdated', 'empties'), { recursive: true });
  write(root, 'Outdated/MOVES.log', '');
  write(root, 'snapshot.zip', 'zip');
  write(root, '.hidden', '');

  // capdir: five files, used to prove the cap
  const cap = path.join(root, 'capdir');
  for (let i = 0; i < 5; i += 1) write(cap, `f${i}.txt`, 'x');
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('walkFiles', () => {
  it('finds the newest regular file, skipping pruned dirs and .DS_Store', async () => {
    const r = await walkFiles(path.join(root, 'gamma'));
    expect(Date.parse(r.newestFileIso)).toBe(Date.parse(ONE_ISO));
    expect(r.fileCount).toBe(1);
    expect(r.bytes).toBe(6);
  });
  it('respects the file cap', async () => {
    const r = await walkFiles(path.join(root, 'capdir'), { maxFiles: 3 });
    expect(r.fileCount).toBe(3);
  });
  it('returns nulls and zeros for a missing directory', async () => {
    expect(await walkFiles(path.join(root, 'nope'))).toEqual({ newestFileIso: null, fileCount: 0, bytes: 0 });
  });
});

describe('projectFacts', () => {
  it('reads a clean git repo with no remote', async () => {
    const f = await projectFacts(path.join(root, 'alpha'));
    expect(f.kind).toBe('git');
    expect(f.readable).toBe(true);
    expect(Date.parse(f.lastCommitIso)).toBe(Date.parse(ALPHA_ISO));
    expect(f.dirty).toBe(false);
    expect(f.aheadBy).toBe(0);
    expect(f.remote).toBeNull();
    expect(f.stack).toEqual(['node']);
    expect(f.description).toBe('Alpha Project');
    expect(f.empty).toBe(false);
    expect(f.fileCount).toBeGreaterThan(0);
  });
  it('reads a dirty, ahead repo with a GitHub remote', async () => {
    const f = await projectFacts(path.join(root, 'beta'));
    expect(f.kind).toBe('git');
    expect(f.dirty).toBe(true);
    expect(f.aheadBy).toBe(1);
    expect(f.remote).toBe('example/beta');
    expect(Date.parse(f.lastCommitIso)).toBe(Date.parse(BETA_ISO));
  });
  it('reads a plain folder', async () => {
    const f = await projectFacts(path.join(root, 'gamma'));
    expect(f.kind).toBe('folder');
    expect(f.lastCommitIso).toBeNull();
    expect(f.dirty).toBe(false);
    expect(f.remote).toBeNull();
    expect(Date.parse(f.newestFileIso)).toBe(Date.parse(ONE_ISO));
    expect(f.stack).toEqual([]);
    expect(f.description).toBeNull();
  });
  it('flags an empty folder', async () => {
    const f = await projectFacts(path.join(root, 'empty'));
    expect(f.empty).toBe(true);
    expect(f.newestFileIso).toBeNull();
  });
  it('degrades a missing path to readable:false', async () => {
    const f = await projectFacts(path.join(root, 'ghost'));
    expect(f).toMatchObject({ name: 'ghost', kind: 'folder', readable: false, lastCommitIso: null, fileCount: 0, stack: [] });
  });
});

describe('listOutdated', () => {
  it('lists entries per subfolder, skipping files and dot-names', async () => {
    expect(await listOutdated(path.join(root, 'Outdated'))).toEqual({
      'archived-projects': ['old-one'],
      empties: [],
    });
  });
  it('returns {} when Outdated is missing', async () => {
    expect(await listOutdated(path.join(root, 'nope'))).toEqual({});
  });
});

describe('surveyProjects', () => {
  it('returns projects sorted by name, loose files, and the Outdated listing', async () => {
    const s = await surveyProjects(root);
    expect(s.projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'capdir', 'empty', 'gamma']);
    expect(s.looseFiles).toEqual(['snapshot.zip']);
    expect(s.outdated['archived-projects']).toEqual(['old-one']);
    expect(s.projects.every((p) => p.path.startsWith(root))).toBe(true);
  });
  it('throws when the root does not exist', async () => {
    await expect(surveyProjects(path.join(root, 'missing-root'))).rejects.toThrow();
  });
});
