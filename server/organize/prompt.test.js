// @vitest-environment node
/**
 * Repo Atlas — organize/prompt: three rounds + final confirmation against a
 * scripted ask(). Pure given ask/out.
 */
import { describe, it, expect } from 'vitest';
import { defaultConfig } from './themes.js';
import { runPrompts, describeMoves } from './prompt.js';

function rec(name, over = {}) {
  return {
    name, path: `/tmp/root/${name}`, kind: 'git', readable: true,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 1, bytes: 10, empty: false, stack: [], description: null,
    theme: 'unsorted', status: 'active', activityIso: '2026-05-10T12:00:00-05:00',
    ...over,
  };
}
function harness(answers) {
  const asked = [];
  const lines = [];
  const ask = async (q) => { asked.push(q); return answers.shift(); };
  const out = (l) => lines.push(l);
  return { ask, out, asked, lines };
}
const emptyNotices = { candidates: [], empties: [], unsorted: [], duplicates: [], looseFiles: [] };

describe('round 1: unsorted', () => {
  it('numbers the themes in config order and records a pick as a theme decision', async () => {
    const h = harness(['5', 's']);
    const notices = { ...emptyNotices, unsorted: [rec('random'), rec('moon')] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(h.lines.some((l) => l.includes('1) minecraft'))).toBe(true);
    expect(h.lines.some((l) => l.includes('10) ai-tools'))).toBe(true);
    expect(decisions).toEqual([{ name: 'moon', action: 'theme', theme: 'finance' }]);
    expect(confirmed).toBe(false);
  });
  it('re-asks on an invalid number and treats empty as skip', async () => {
    const h = harness(['99', '2', '']);
    const notices = { ...emptyNotices, unsorted: [rec('a'), rec('b')] };
    const { decisions } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'a', action: 'theme', theme: 'roblox' }]);
    expect(h.asked.length).toBe(3);
  });
});

describe('round 2: archive candidates', () => {
  it('maps a/k/s and shows the candidate line', async () => {
    const h = harness(['a', 'k', 's', 'y']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' }), rec('y', { status: 'stale', dirty: true }), rec('z', { status: 'stale' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([
      { name: 'x', action: 'archive', subdir: 'archived-projects' },
      { name: 'y', action: 'keep' },
      { name: 'z', action: 'skip' },
    ]);
    expect(h.lines.some((l) => l.includes('y — git') && l.includes('WARNING: uncommitted changes'))).toBe(true);
    expect(confirmed).toBe(true);
  });
  it('re-asks on junk', async () => {
    const h = harness(['maybe', 'k']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' })] };
    const { decisions } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'x', action: 'keep' }]);
  });
});

describe('round 3: empties', () => {
  it('archives to the empties subdir', async () => {
    const h = harness(['a', 'yes']);
    const notices = { ...emptyNotices, empties: [rec('FUN', { status: 'empty', kind: 'folder' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'FUN', action: 'archive', subdir: 'empties' }]);
    expect(confirmed).toBe(true);
  });
});

describe('final confirmation', () => {
  it('lists the queued moves and only y/yes confirms', async () => {
    const h = harness(['a', 'n']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(h.lines).toContain('  x → Outdated/archived-projects/x');
    expect(h.asked[h.asked.length - 1]).toBe('Proceed with 1 move? [y/N]: ');
    expect(confirmed).toBe(false);
    expect(decisions).toEqual([{ name: 'x', action: 'archive', subdir: 'archived-projects' }]);
  });
  it('skips confirmation when nothing is queued', async () => {
    const h = harness(['k']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' })] };
    const { confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(confirmed).toBe(false);
    expect(h.asked.length).toBe(1);
    expect(h.lines).toContain('No moves queued.');
  });
  it('a dry ask (undefined) counts as skip everywhere', async () => {
    const h = harness([]);
    const notices = { ...emptyNotices, unsorted: [rec('a')], candidates: [rec('x', { status: 'stale' })], empties: [rec('E', { status: 'empty' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'x', action: 'skip' }, { name: 'E', action: 'skip' }]);
    expect(confirmed).toBe(false);
  });
});

describe('describeMoves', () => {
  it('renders only archive decisions', () => {
    expect(describeMoves([
      { name: 'x', action: 'archive', subdir: 'archived-projects' },
      { name: 'k', action: 'keep' },
      { name: 'E', action: 'archive', subdir: 'empties' },
    ])).toEqual(['  x → Outdated/archived-projects/x', '  E → Outdated/empties/E']);
  });
});
