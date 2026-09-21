// @vitest-environment node
/**
 * Repo Atlas — organize/render: PROJECTS.md, CLAUDE.md block + splice.
 * String assertions on a small fixture. Pure; nowIso is a literal.
 */
import { describe, it, expect } from 'vitest';
import { defaultConfig } from './themes.js';
import {
  MARK_BEGIN,
  MARK_END,
  fmtDay,
  fmtBytes,
  groupByTheme,
  renderProjectsMd,
  renderClaudeBlock,
  spliceClaudeMd,
  candidateLine,
  renderReport,
} from './render.js';

const NOW = '2026-09-21T12:00:00-05:00';

function rec(name, over = {}) {
  return {
    name, path: `/tmp/root/${name}`, kind: 'git', readable: true,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 1, bytes: 10, empty: false, stack: [], description: null,
    theme: 'unsorted', status: 'active', activityIso: null,
    ...over,
  };
}

const records = [
  rec('minecraft-plugins', { theme: 'minecraft', stack: ['java'], activityIso: '2026-09-01T12:00:00-05:00', description: 'Plugins' }),
  rec('alpaca-v2', { theme: 'finance', status: 'stale', remote: 'trmnmc/alpaca-v2', stack: ['claude-md', 'node'], activityIso: '2026-06-10T12:00:00-05:00', description: 'Alpaca | Command Center' }),
  rec('random', { theme: 'unsorted', kind: 'folder', activityIso: '2026-08-01T12:00:00-05:00' }),
  rec('FUN', { theme: 'unsorted', kind: 'folder', status: 'empty' }),
];
const notices = { candidates: [records[1]], empties: [records[3]], unsorted: [records[2], records[3]], duplicates: [], looseFiles: ['snapshot.zip', 'ssh-key'] };
const outdated = { 'archived-projects': ['old-one'], empties: [], zips: ['a.zip'] };

describe('fmtDay / fmtBytes', () => {
  it('formats local day and unknown', () => {
    expect(fmtDay('2026-09-01T12:00:00-05:00')).toBe('2026-09-01');
    expect(fmtDay('2026-01-02T03:30:00Z')).toBe('2026-01-01'); // America/Chicago
    expect(fmtDay(null)).toBe('unknown');
  });
  it('formats bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(12 * 1024)).toBe('12 KB');
    expect(fmtBytes(1.2 * 1024 * 1024)).toBe('1.2 MB');
    expect(fmtBytes(7.2 * 1024 ** 3)).toBe('7.2 GB');
  });
});

describe('groupByTheme', () => {
  it('follows config order, unsorted last, sorted by name inside, drops empty groups', () => {
    const groups = groupByTheme(records, defaultConfig());
    expect(groups.map((g) => g.theme)).toEqual(['minecraft', 'finance', 'unsorted']);
    expect(groups[2].records.map((r) => r.name)).toEqual(['FUN', 'random']);
  });
});

describe('renderProjectsMd', () => {
  const md = renderProjectsMd({ records, notices, outdated, config: defaultConfig(), nowIso: NOW });
  it('has the header, the do-not-edit line, and the summary', () => {
    expect(md.startsWith('# Projects\n')).toBe(true);
    expect(md).toContain('Generated 2026-09-21 by `npm run organize` (repo-atlas). Do not edit. Edit projects.json.');
    expect(md).toContain('Summary: 4 projects · 2 active · 0 paused · 1 stale · 1 empty · 0 unknown · 2 unsorted');
  });
  it('renders one section per non-empty theme with the table header', () => {
    expect(md).toContain('## minecraft (1)\n\n| Name | Kind | Status | Stack | Remote | Last activity | Description |\n|---|---|---|---|---|---|---|\n');
    expect(md).toContain('## finance (1)');
    expect(md).toContain('## unsorted (2)');
    expect(md).not.toContain('## roblox');
  });
  it('renders rows with escaped pipes, em dash for no remote, and unknown dates', () => {
    expect(md).toContain('| minecraft-plugins | git | active | java | — | 2026-09-01 | Plugins |');
    expect(md).toContain('| alpaca-v2 | git | stale | claude-md, node | trmnmc/alpaca-v2 | 2026-06-10 | Alpaca \\| Command Center |');
    expect(md).toContain('| FUN | folder | empty | — | — | unknown |  |');
  });
  it('lists Outdated subfolders and loose files, never truncating', () => {
    expect(md).toContain('## Outdated\n\n### archived-projects (1)\n\n- old-one\n');
    expect(md).toContain('### empties (0)\n\n_(none)_\n');
    expect(md).toContain('### zips (1)\n\n- a.zip\n');
    expect(md).toContain('## Loose files at the root\n\n- snapshot.zip\n- ssh-key\n');
  });
  it('says so when Outdated is missing', () => {
    const md2 = renderProjectsMd({ records, notices, outdated: {}, config: defaultConfig(), nowIso: NOW });
    expect(md2).toContain('## Outdated\n\n_(no Outdated folder yet)_\n');
  });
});

describe('renderClaudeBlock / spliceClaudeMd', () => {
  const block = renderClaudeBlock({ records, config: defaultConfig() });
  it('is wrapped in the markers and stays short', () => {
    expect(block.startsWith(MARK_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(MARK_END)).toBe(true);
    expect(block.split('\n').length).toBeLessThanOrEqual(22);
  });
  it('names the map, theme counts, archive convention, and agent rules', () => {
    expect(block).toContain('PROJECTS.md');
    expect(block).toContain('Themes: minecraft (1) · finance (1) · unsorted (2)');
    expect(block).toContain('Outdated/archived-projects/');
    expect(block).toContain('Outdated/MOVES.log');
    expect(block).toContain('Do not create files at the root of ~/Projects.');
    expect(block).toContain('Do not move, rename, or delete project folders.');
  });
  it('splices: missing file → block only', () => {
    expect(spliceClaudeMd(null, block)).toBe(block);
  });
  it('splices: no markers → appended after a blank line', () => {
    const out = spliceClaudeMd('# Mine\n\nkeep me\n', block);
    expect(out.startsWith('# Mine\n\nkeep me\n\n')).toBe(true);
    expect(out.endsWith(block)).toBe(true);
  });
  it('splices: markers present → replaced in place, outside text kept', () => {
    const old = `# Mine\n\n${MARK_BEGIN}\nold stuff\n${MARK_END}\n\ntail note\n`;
    const out = spliceClaudeMd(old, block);
    expect(out).toContain('# Mine\n\n');
    expect(out).toContain('tail note\n');
    expect(out).not.toContain('old stuff');
    expect(out.split(MARK_END).length).toBe(2);
  });
});

describe('candidateLine', () => {
  it('describes a candidate with warnings', () => {
    const r = rec('daily-ai-updates', { status: 'stale', dirty: true, aheadBy: 2, bytes: 1.4 * 1024 ** 3, remote: 'trmnmc/daily-ai', activityIso: '2026-05-10T12:00:00-05:00' });
    const line = candidateLine(r);
    expect(line).toBe('daily-ai-updates — git · last activity 2026-05-10 · 1.4 GB · remote trmnmc/daily-ai · WARNING: uncommitted changes · WARNING: 2 unpushed commits');
  });
  it('omits warnings and remote when clean', () => {
    const r = rec('random', { kind: 'folder', status: 'stale', bytes: 512, activityIso: '2026-05-10T12:00:00-05:00' });
    expect(candidateLine(r)).toBe('random — folder · last activity 2026-05-10 · 512 B');
  });
});

describe('renderReport', () => {
  const text = renderReport({ records, notices, config: defaultConfig(), staleDays: 90 });
  it('leads with counts', () => {
    expect(text).toContain('Organize report — 4 projects (stale after 90 days)');
    expect(text).toContain('Status: 2 active · 0 paused · 1 stale · 1 empty · 0 unknown');
    expect(text).toContain('Themes: minecraft 1 · finance 1 · unsorted 2');
  });
  it('lists every theme group with aligned rows', () => {
    expect(text).toContain('== minecraft (1)');
    expect(text).toMatch(/minecraft-plugins\s+git\s+active\s+2026-09-01\s+10 B\s+—/);
    expect(text).toContain('== unsorted (2)');
  });
  it('lists the notices', () => {
    expect(text).toContain('== Archive candidates (1)\n  alpaca-v2 — git · last activity 2026-06-10 · 10 B · remote trmnmc/alpaca-v2');
    expect(text).toContain('== Empty folders (1)\n  FUN');
    expect(text).toContain('== Unsorted (2)\n  FUN, random');
    expect(text).toContain('== Possible duplicates (0)\n  (none)');
    expect(text).toContain('== Loose files at the root (2)\n  snapshot.zip, ssh-key');
  });
  it('shows duplicate reasons', () => {
    const t = renderReport({ records, notices: { ...notices, duplicates: [{ reason: 'remote', key: 'trmnmc/x', names: ['A', 'A 2'] }] }, config: defaultConfig(), staleDays: 90 });
    expect(t).toContain('== Possible duplicates (1)\n  A, A 2 — same remote trmnmc/x');
  });
});
