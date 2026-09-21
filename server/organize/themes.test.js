// @vitest-environment node
/**
 * Repo Atlas — organize/themes: glob matcher, ordered themes, overrides,
 * default config, load (missing → default, corrupt → ConfigError), save.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  UNSORTED,
  defaultConfig,
  globToRegExp,
  matchTheme,
  themeNames,
  isConfigShape,
  ConfigError,
  loadConfig,
  saveConfig,
} from './themes.js';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-themes-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it('matches the whole name, case-insensitive', () => {
    expect(globToRegExp('roblox*').test('ROBLOXXX')).toBe(true);
    expect(globToRegExp('roblox*').test('my-roblox')).toBe(false);
    expect(globToRegExp('*minecraft*').test('SUSHI-GO-MINECRAFT')).toBe(true);
    expect(globToRegExp('pi').test('pi')).toBe(true);
    expect(globToRegExp('pi').test('spotify')).toBe(false);
  });
  it('escapes regex metacharacters other than *', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('a.b').test('a.b')).toBe(true);
    expect(globToRegExp('c++').test('c++')).toBe(true);
  });
  it('matches names with spaces', () => {
    expect(globToRegExp('* project').test('seeing-stars Project')).toBe(true);
    expect(globToRegExp('studio by *').test('studio by spotify fun')).toBe(true);
  });
});

describe('matchTheme', () => {
  const config = {
    themes: [
      { name: 'minecraft', match: ['*minecraft*'] },
      { name: 'finance', match: ['trading-*'] },
      { name: 'ai-tools', match: ['*agent*'] },
    ],
    overrides: { SPORE: 'minecraft' },
    paused: {},
  };
  it('first matching theme wins, in config order', () => {
    expect(matchTheme('trading-agents', config)).toBe('finance');
    expect(matchTheme('minecraft-agents', config)).toBe('minecraft');
    expect(matchTheme('AGENT-ARENA', config)).toBe('ai-tools');
  });
  it('overrides win over patterns', () => {
    expect(matchTheme('SPORE', config)).toBe('minecraft');
  });
  it('falls back to unsorted', () => {
    expect(matchTheme('random', config)).toBe(UNSORTED);
    expect(UNSORTED).toBe('unsorted');
  });
});

describe('defaultConfig', () => {
  it('has ai-tools last so narrow themes win', () => {
    const names = themeNames(defaultConfig());
    expect(names[names.length - 1]).toBe('ai-tools');
    expect(names).toContain('finance');
    expect(names).toContain('minecraft');
  });
  it('routes the known tricky names', () => {
    const c = defaultConfig();
    expect(matchTheme('trading-agents', c)).toBe('finance');
    expect(matchTheme('minecraft-agents', c)).toBe('minecraft');
    expect(matchTheme('claude-1 Project', c)).toBe('music');
    expect(matchTheme('liqrbox-redesign', c)).toBe(UNSORTED);
    expect(matchTheme('game-genie', c)).toBe(UNSORTED);
    expect(matchTheme('LINUX-AI', c)).toBe('hardware');
    expect(matchTheme('repo-atlas', c)).toBe('ai-tools');
  });
  it('returns a fresh object each call', () => {
    const a = defaultConfig();
    a.themes.push({ name: 'x', match: [] });
    expect(defaultConfig().themes.some((t) => t.name === 'x')).toBe(false);
  });
});

describe('isConfigShape', () => {
  it('accepts the default and rejects junk', () => {
    expect(isConfigShape(defaultConfig())).toBe(true);
    expect(isConfigShape(null)).toBe(false);
    expect(isConfigShape({ themes: 'no' })).toBe(false);
    expect(isConfigShape({ themes: [], overrides: {}, paused: {} })).toBe(true);
    expect(isConfigShape({ themes: [{ name: 'a' }], overrides: {}, paused: {} })).toBe(false);
  });
});

describe('loadConfig / saveConfig', () => {
  it('missing file → default config, created: true, nothing written', async () => {
    const f = path.join(root, 'missing', 'projects.json');
    const { config, created } = await loadConfig(f);
    expect(created).toBe(true);
    expect(themeNames(config)).toEqual(themeNames(defaultConfig()));
    expect(fs.existsSync(f)).toBe(false);
  });
  it('round-trips through save', async () => {
    const f = path.join(root, 'projects.json');
    const c = defaultConfig();
    c.overrides.SPORE = 'minecraft';
    c.paused['alpaca-v2'] = '2026-09-21';
    await saveConfig(f, c);
    const { config, created } = await loadConfig(f);
    expect(created).toBe(false);
    expect(config.overrides).toEqual({ SPORE: 'minecraft' });
    expect(config.paused).toEqual({ 'alpaca-v2': '2026-09-21' });
    expect(fs.readFileSync(f, 'utf8').endsWith('\n')).toBe(true);
  });
  it('corrupt JSON → ConfigError naming the file', async () => {
    const f = path.join(root, 'bad.json');
    fs.writeFileSync(f, '{ not json');
    await expect(loadConfig(f)).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig(f)).rejects.toMatchObject({ file: f });
    expect(fs.readFileSync(f, 'utf8')).toBe('{ not json');
  });
  it('wrong shape → ConfigError', async () => {
    const f = path.join(root, 'shape.json');
    fs.writeFileSync(f, '{"themes": 5}');
    await expect(loadConfig(f)).rejects.toBeInstanceOf(ConfigError);
  });
});
