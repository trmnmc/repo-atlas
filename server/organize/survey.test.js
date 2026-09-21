// @vitest-environment node
/**
 * Repo Atlas — organize/survey: pure helpers (part 1) and the real-fixture
 * survey (part 2, appended in Task 4).
 */
import { describe, it, expect } from 'vitest';
import {
  OUTDATED_DIR,
  isIgnoredName,
  isEmptyListing,
  detectStack,
  normalizeRemote,
  parseDescription,
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
