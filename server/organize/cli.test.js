// @vitest-environment node
/**
 * Repo Atlas — organize/cli: flags, config merge, dry-run writes nothing,
 * a full scripted run moves + writes, error exits. mktemp root only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from './themes.js';
import { CONFIG_FILE, INDEX_FILE, CLAUDE_FILE, parseFlags, applyDecisionsToConfig, main } from './cli.js';

const NOW = '2026-09-21T12:00:00-05:00';
function touch(file, iso) {
  const d = new Date(iso);
  fs.utimesSync(file, d, d);
}
function write(dir, rel, content, iso) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  touch(p, iso);
}
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-cli-'));
  write(root, 'minecraft-plugins/a.txt', 'x', '2026-09-10T12:00:00-05:00'); // active, themed
  write(root, 'old/a.txt', 'x', '2026-01-01T12:00:00-05:00');               // stale, unsorted
  write(root, 'snapshot.zip', 'z', '2026-09-10T12:00:00-05:00');            // loose
  return root;
}
function io(answers = []) {
  const lines = [];
  const errors = [];
  return {
    out: (l) => lines.push(l),
    err: (l) => errors.push(l),
    nowIso: NOW,
    ask: async () => answers.shift(),
    lines,
    errors,
  };
}

describe('parseFlags', () => {
  it('defaults to ~/Projects, 90 days, not dry', () => {
    expect(parseFlags([])).toEqual({ root: path.join(os.homedir(), 'Projects'), staleDays: 90, dryRun: false });
  });
  it('reads all three flags', () => {
    expect(parseFlags(['--root', '/tmp/x', '--stale-days', '30', '--dry-run'])).toEqual({ root: '/tmp/x', staleDays: 30, dryRun: true });
  });
  it('rejects bad stale-days and unknown flags', () => {
    expect(() => parseFlags(['--stale-days', 'soon'])).toThrow(/stale-days/);
    expect(() => parseFlags(['--stale-days', '0'])).toThrow(/stale-days/);
    expect(() => parseFlags(['--bogus'])).toThrow();
  });
});

describe('applyDecisionsToConfig', () => {
  it('records theme picks and keeps, ignores the rest, and does not mutate', () => {
    const c = defaultConfig();
    const next = applyDecisionsToConfig(c, [
      { name: 'moon', action: 'theme', theme: 'games' },
      { name: 'alpaca-v2', action: 'keep' },
      { name: 'x', action: 'archive', subdir: 'archived-projects' },
      { name: 'y', action: 'skip' },
    ], '2026-09-21');
    expect(next.overrides).toEqual({ moon: 'games' });
    expect(next.paused).toEqual({ 'alpaca-v2': '2026-09-21' });
    expect(c.overrides).toEqual({});
    expect(c.paused).toEqual({});
  });
});

describe('main', () => {
  it('--dry-run prints the report and writes nothing', async () => {
    const root = makeRoot();
    const h = io();
    const code = await main(['--root', root, '--dry-run'], h);
    expect(code).toBe(0);
    expect(h.lines.join('\n')).toContain('Organize report — 2 projects');
    expect(h.lines.join('\n')).toContain('Dry run: nothing asked, nothing written.');
    expect(fs.existsSync(path.join(root, CONFIG_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, INDEX_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, CLAUDE_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Outdated'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a confirmed run moves, logs, and writes the three files', async () => {
    const root = makeRoot();
    // round 1: theme for 'old' → 3) games; round 2: archive 'old'; confirm
    const h = io(['3', 'a', 'y']);
    const code = await main(['--root', root], h);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, 'old'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Outdated', 'archived-projects', 'old', 'a.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'Outdated', 'MOVES.log'), 'utf8')).toContain(`${NOW}\t${path.join(root, 'old')}\t`);

    const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
    expect(config.overrides).toEqual({ old: 'games' });
    expect(config.paused).toEqual({});

    const index = fs.readFileSync(path.join(root, INDEX_FILE), 'utf8');
    expect(index).toContain('## minecraft (1)');
    expect(index).not.toMatch(/^\| old \|/m);
    expect(index).toContain('### archived-projects (1)\n\n- old\n');
    expect(index).toContain('- snapshot.zip');

    const claude = fs.readFileSync(path.join(root, CLAUDE_FILE), 'utf8');
    expect(claude).toContain('<!-- atlas:begin');
    expect(claude).toContain('<!-- atlas:end -->');
    expect(h.lines.join('\n')).toContain(`Moved 1, skipped 0. Wrote ${CONFIG_FILE}, ${INDEX_FILE}, ${CLAUDE_FILE} in ${root}.`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keep saves paused and a cancelled confirmation still writes', async () => {
    const root = makeRoot();
    write(root, 'old2/a.txt', 'x', '2026-01-01T12:00:00-05:00');
    fs.writeFileSync(path.join(root, CLAUDE_FILE), '# Mine\n\nkeep me\n');
    // round 1: skip 'old', skip 'old2'; round 2: keep 'old', archive 'old2'; cancel
    const h = io(['s', 's', 'k', 'a', 'n']);
    const code = await main(['--root', root], h);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, 'old2'))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
    expect(config.paused).toEqual({ old: '2026-09-21' });
    expect(h.lines.join('\n')).toContain('Moves cancelled. Theme picks and keep decisions are still saved.');
    const claude = fs.readFileSync(path.join(root, CLAUDE_FILE), 'utf8');
    expect(claude.startsWith('# Mine\n\nkeep me\n')).toBe(true);
    expect(claude).toContain('<!-- atlas:end -->');
    expect(fs.readFileSync(path.join(root, INDEX_FILE), 'utf8')).toMatch(/^\| old \| folder \| paused \|/m);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 on bad flags, a missing root, and a corrupt config', async () => {
    let h = io();
    expect(await main(['--stale-days', 'x'], h)).toBe(1);
    expect(h.errors[0]).toMatch(/stale-days/);

    h = io();
    expect(await main(['--root', path.join(os.tmpdir(), 'organize-no-such-root-xyz'), '--dry-run'], h)).toBe(1);
    expect(h.errors[0]).toMatch(/Cannot read/);

    const root = makeRoot();
    fs.writeFileSync(path.join(root, CONFIG_FILE), '{ nope');
    h = io();
    expect(await main(['--root', root, '--dry-run'], h)).toBe(1);
    expect(h.errors[0]).toMatch(/projects\.json is unusable/);
    expect(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')).toBe('{ nope');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
