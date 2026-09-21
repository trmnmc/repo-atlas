// @vitest-environment node
/**
 * Repo Atlas — organize/classify: activity date, status rule, duplicates,
 * summary. Pure; every date is a literal; nowIso is always passed.
 */
import { describe, it, expect } from 'vitest';
import { isStale, STALE_DAYS } from '../../shared/contract.js';
import { defaultConfig } from './themes.js';
import {
  STATUSES,
  activityIso,
  olderThanDays,
  statusOf,
  findDuplicates,
  classify,
  summarize,
} from './classify.js';

const NOW = '2026-09-21T12:00:00-05:00';
const RECENT = '2026-09-01T12:00:00-05:00';   // 20 days ago
const OLD = '2026-05-01T12:00:00-05:00';      // 143 days ago
const EXACT_90 = '2026-06-23T12:00:00-05:00'; // exactly 90 days before NOW
const JUST_OVER = '2026-06-23T11:59:59.999-05:00';

/** @returns {import('./survey.js').ProjectFacts} */
function facts(over = {}) {
  return {
    name: 'proj', path: '/tmp/root/proj', kind: 'folder', readable: true,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 3, bytes: 300, empty: false, stack: [], description: null,
    ...over,
  };
}
const config = () => defaultConfig();

describe('activityIso', () => {
  it('takes the later of commit and file time', () => {
    expect(activityIso(facts({ lastCommitIso: OLD, newestFileIso: RECENT }))).toBe(RECENT);
    expect(activityIso(facts({ lastCommitIso: RECENT, newestFileIso: OLD }))).toBe(RECENT);
  });
  it('uses whichever exists, or null', () => {
    expect(activityIso(facts({ lastCommitIso: OLD }))).toBe(OLD);
    expect(activityIso(facts({ newestFileIso: OLD }))).toBe(OLD);
    expect(activityIso(facts())).toBeNull();
  });
});

describe('olderThanDays', () => {
  it('is strict: exactly N days is not older', () => {
    expect(olderThanDays(EXACT_90, NOW, 90)).toBe(false);
    expect(olderThanDays(JUST_OVER, NOW, 90)).toBe(true);
    expect(olderThanDays(RECENT, NOW, 90)).toBe(false);
    expect(olderThanDays(OLD, NOW, 90)).toBe(true);
  });
  it('agrees with the contract isStale at STALE_DAYS', () => {
    for (const iso of [EXACT_90, JUST_OVER, RECENT, OLD]) {
      expect(olderThanDays(iso, NOW, STALE_DAYS)).toBe(isStale(iso, NOW));
    }
  });
  it('honors a custom threshold', () => {
    expect(olderThanDays(RECENT, NOW, 10)).toBe(true);
    expect(olderThanDays(RECENT, NOW, 30)).toBe(false);
  });
});

describe('statusOf', () => {
  it('active by commit, active by file time only', () => {
    expect(statusOf(facts({ kind: 'git', lastCommitIso: RECENT }), config(), NOW)).toBe('active');
    expect(statusOf(facts({ kind: 'git', lastCommitIso: OLD, newestFileIso: RECENT }), config(), NOW)).toBe('active');
  });
  it('stale, and paused when the config says keep', () => {
    expect(statusOf(facts({ lastCommitIso: OLD }), config(), NOW)).toBe('stale');
    const c = config();
    c.paused.proj = '2026-09-01';
    expect(statusOf(facts({ lastCommitIso: OLD }), c, NOW)).toBe('paused');
  });
  it('a paused project that becomes active is active', () => {
    const c = config();
    c.paused.proj = '2026-09-01';
    expect(statusOf(facts({ newestFileIso: RECENT }), c, NOW)).toBe('active');
  });
  it('empty beats everything but unreadable, and a kept empty folder is paused', () => {
    expect(statusOf(facts({ empty: true }), config(), NOW)).toBe('empty');
    expect(statusOf(facts({ empty: true, readable: false }), config(), NOW)).toBe('unknown');
    const c = config();
    c.paused.proj = '2026-09-01';
    expect(statusOf(facts({ empty: true }), c, NOW)).toBe('paused');
  });
  it('unknown when no signal or unreadable', () => {
    expect(statusOf(facts(), config(), NOW)).toBe('unknown');
    expect(statusOf(facts({ readable: false }), config(), NOW)).toBe('unknown');
  });
  it('exactly 90 days is still active; custom threshold applies', () => {
    expect(statusOf(facts({ newestFileIso: EXACT_90 }), config(), NOW)).toBe('active');
    expect(statusOf(facts({ newestFileIso: RECENT }), config(), NOW, 10)).toBe('stale');
  });
  it('STATUSES lists all five', () => {
    expect(STATUSES).toEqual(['active', 'paused', 'stale', 'empty', 'unknown']);
  });
});

describe('findDuplicates', () => {
  const rec = (name, over = {}) => ({ ...facts({ name, path: `/tmp/root/${name}`, ...over }), theme: 'x', status: 'active', activityIso: null });
  it('groups git projects by normalized remote', () => {
    const d = findDuplicates([
      rec('BAT-Scanner', { kind: 'git', remote: 'trmnmc/BAT-Scanner' }),
      rec('BAT-Scanner 2', { kind: 'git', remote: 'trmnmc/bat-scanner' }),
      rec('other', { kind: 'git', remote: 'trmnmc/other' }),
    ]);
    expect(d).toContainEqual({ reason: 'remote', key: 'trmnmc/bat-scanner', names: ['BAT-Scanner', 'BAT-Scanner 2'] });
  });
  it('pairs suffix names with an existing base', () => {
    const d = findDuplicates([rec('SurLeLac'), rec('SurLeLacv2'), rec('lofts-willow-selection'), rec('lofts-willow-selection-2'), rec('alpaca-v2'), rec('tstack2')]);
    expect(d).toContainEqual({ reason: 'name', key: 'SurLeLac', names: ['SurLeLac', 'SurLeLacv2'] });
    expect(d).toContainEqual({ reason: 'name', key: 'lofts-willow-selection', names: ['lofts-willow-selection', 'lofts-willow-selection-2'] });
    expect(d.some((n) => n.names.includes('alpaca-v2'))).toBe(false);
    expect(d.some((n) => n.names.includes('tstack2'))).toBe(false);
  });
  it('returns [] when nothing repeats', () => {
    expect(findDuplicates([rec('a'), rec('b')])).toEqual([]);
  });
});

describe('classify + summarize', () => {
  it('builds records and notices from a survey', () => {
    const survey = {
      projects: [
        facts({ name: 'minecraft-plugins', kind: 'git', lastCommitIso: RECENT }),
        facts({ name: 'alpaca-v2', kind: 'git', lastCommitIso: OLD }),
        facts({ name: 'FUN', empty: true }),
        facts({ name: 'random', newestFileIso: RECENT }),
        facts({ name: 'ghost', readable: false }),
      ],
      looseFiles: ['snapshot.zip'],
      outdated: {},
    };
    const { records, notices } = classify(survey, config(), NOW);
    const byName = Object.fromEntries(records.map((r) => [r.name, r]));
    expect(byName['minecraft-plugins']).toMatchObject({ theme: 'minecraft', status: 'active', activityIso: RECENT });
    expect(byName['alpaca-v2']).toMatchObject({ theme: 'finance', status: 'stale' });
    expect(byName.FUN).toMatchObject({ status: 'empty' });
    expect(byName.random).toMatchObject({ theme: 'unsorted', status: 'active' });
    expect(byName.ghost).toMatchObject({ status: 'unknown' });
    expect(notices.candidates.map((r) => r.name)).toEqual(['alpaca-v2']);
    expect(notices.empties.map((r) => r.name)).toEqual(['FUN']);
    expect(notices.unsorted.map((r) => r.name).sort()).toEqual(['FUN', 'ghost', 'random']);
    expect(notices.looseFiles).toEqual(['snapshot.zip']);
    expect(notices.duplicates).toEqual([]);

    const s = summarize(records);
    expect(s.total).toBe(5);
    expect(s.byStatus).toEqual({ active: 2, paused: 0, stale: 1, empty: 1, unknown: 1 });
    expect(s.byTheme).toEqual({ minecraft: 1, finance: 1, unsorted: 3 });
  });
  it('passes staleDays through', () => {
    const survey = { projects: [facts({ name: 'p', newestFileIso: RECENT })], looseFiles: [], outdated: {} };
    expect(classify(survey, config(), NOW, { staleDays: 10 }).records[0].status).toBe('stale');
  });
});
