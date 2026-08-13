/**
 * Repo Atlas — tests for the attention classification and ranking engine
 * (server/attention.js).
 *
 * Deterministic: every date is a literal ISO string; NOW is fixed at the
 * fixture's reference instant. No Date.now() anywhere.
 */
import { describe, it, expect } from 'vitest';
import { classify, buildAttention } from './attention.js';
import { fixtureSnapshot } from '../shared/fixtures.js';

/** Fixed "now" for every assertion (matches the shared fixture instant). */
const NOW = '2026-08-01T12:00:00.000Z';

/** Exactly 90 days before NOW (May 28+June 30+July 31+Aug 1 = 90). */
const EXACTLY_90_DAYS_AGO = '2026-05-03T12:00:00.000Z';

/** 90 days and one second before NOW — one tick past the boundary. */
const NINETY_DAYS_ONE_SECOND_AGO = '2026-05-03T11:59:59.000Z';

const TRACKED_SYNCED = { state: 'tracked', aheadBy: 0, behindBy: 0 };
const TRACKED_AHEAD = { state: 'tracked', aheadBy: 3, behindBy: 0 };
const TRACKED_BEHIND = { state: 'tracked', aheadBy: 0, behindBy: 2 };
const NO_REMOTE = { state: 'none' };

let nextId = 0;

/**
 * Minimal RepoSummary for the classifier: only the fields the engine reads
 * (id, dirty, upstream, lastCommit.iso), plus a unique id per call.
 * @param {{ id?: string, dirty?: boolean, upstream?: object, lastIso?: string }} opts
 */
function mkRepo({
  id = `repo-${nextId++}`,
  dirty = false,
  upstream = TRACKED_SYNCED,
  lastIso = '2026-07-30T10:00:00.000Z',
} = {}) {
  return {
    id,
    name: id,
    path: `/Users/surveyor/Projects/${id}`,
    branch: 'main',
    detached: false,
    dirty,
    upstream,
    lastCommit: { iso: lastIso, subject: 'fixture commit', author: 'T. Surveyor' },
  };
}

describe('classify — single-state repos (every displayState)', () => {
  it('dirty repo -> reasons [dirty], displayState dirty', () => {
    expect(classify(mkRepo({ dirty: true }), NOW)).toEqual({
      reasons: ['dirty'],
      displayState: 'dirty',
    });
  });

  it('tracked repo ahead of upstream -> reasons [unpushed], displayState unpushed', () => {
    expect(classify(mkRepo({ upstream: TRACKED_AHEAD }), NOW)).toEqual({
      reasons: ['unpushed'],
      displayState: 'unpushed',
    });
  });

  it('repo with last commit >90 days old -> reasons [stale], displayState stale', () => {
    expect(classify(mkRepo({ lastIso: '2026-01-10T14:00:00.000Z' }), NOW)).toEqual({
      reasons: ['stale'],
      displayState: 'stale',
    });
  });

  it('clean, synced, active repo -> no reasons, displayState ok', () => {
    expect(classify(mkRepo(), NOW)).toEqual({ reasons: [], displayState: 'ok' });
  });

  it('clean, active repo with upstream none -> no reasons, displayState no-remote', () => {
    expect(classify(mkRepo({ upstream: NO_REMOTE }), NOW)).toEqual({
      reasons: [],
      displayState: 'no-remote',
    });
  });

  it('tracked repo merely behind upstream is NOT unpushed', () => {
    expect(classify(mkRepo({ upstream: TRACKED_BEHIND }), NOW)).toEqual({
      reasons: [],
      displayState: 'ok',
    });
  });
});

describe('classify — the exact >90-day stale boundary', () => {
  it('exactly 90 days old is NOT stale', () => {
    const result = classify(mkRepo({ lastIso: EXACTLY_90_DAYS_AGO }), NOW);
    expect(result.reasons).not.toContain('stale');
    expect(result.displayState).toBe('ok');
  });

  it('90 days + 1 second old IS stale', () => {
    expect(classify(mkRepo({ lastIso: NINETY_DAYS_ONE_SECOND_AGO }), NOW)).toEqual({
      reasons: ['stale'],
      displayState: 'stale',
    });
  });
});

describe('classify — multi-reason repos', () => {
  it('dirty AND stale -> both reasons in priority order, displayState dirty', () => {
    expect(classify(mkRepo({ dirty: true, lastIso: '2026-01-10T14:00:00.000Z' }), NOW)).toEqual({
      reasons: ['dirty', 'stale'],
      displayState: 'dirty',
    });
  });

  it('unpushed AND stale -> both reasons, displayState unpushed', () => {
    expect(
      classify(mkRepo({ upstream: TRACKED_AHEAD, lastIso: '2026-01-10T14:00:00.000Z' }), NOW),
    ).toEqual({
      reasons: ['unpushed', 'stale'],
      displayState: 'unpushed',
    });
  });

  it('dirty AND unpushed AND stale -> all three reasons, displayState dirty', () => {
    expect(
      classify(
        mkRepo({ dirty: true, upstream: TRACKED_AHEAD, lastIso: '2026-01-10T14:00:00.000Z' }),
        NOW,
      ),
    ).toEqual({
      reasons: ['dirty', 'unpushed', 'stale'],
      displayState: 'dirty',
    });
  });
});

describe('classify — upstream none is NEVER unpushed', () => {
  it('no-remote repo never gains an unpushed reason, whatever else is true', () => {
    const combos = [
      mkRepo({ upstream: NO_REMOTE }),
      mkRepo({ upstream: NO_REMOTE, dirty: true }),
      mkRepo({ upstream: NO_REMOTE, lastIso: '2026-01-10T14:00:00.000Z' }),
      mkRepo({ upstream: NO_REMOTE, dirty: true, lastIso: '2026-01-10T14:00:00.000Z' }),
    ];
    for (const repo of combos) {
      const { reasons, displayState } = classify(repo, NOW);
      expect(reasons).not.toContain('unpushed');
      expect(displayState).not.toBe('unpushed');
    }
  });

  it('dirty no-remote repo still surfaces as dirty (attention outranks the marker)', () => {
    expect(classify(mkRepo({ upstream: NO_REMOTE, dirty: true }), NOW)).toEqual({
      reasons: ['dirty'],
      displayState: 'dirty',
    });
  });

  it('stale no-remote repo surfaces as stale, not unpushed', () => {
    expect(
      classify(mkRepo({ upstream: NO_REMOTE, lastIso: '2026-01-10T14:00:00.000Z' }), NOW),
    ).toEqual({
      reasons: ['stale'],
      displayState: 'stale',
    });
  });
});

describe('buildAttention — ordering of the full matrix', () => {
  it('orders dirty before unpushed before stale, recency-desc within each band', () => {
    // Hand-built matrix, deliberately shuffled on input.
    const repos = [
      mkRepo({ id: 'stale-new', lastIso: '2026-04-01T09:00:00.000Z' }),
      mkRepo({ id: 'dirty-old', dirty: true, lastIso: '2026-07-01T08:00:00.000Z' }),
      mkRepo({ id: 'ok-repo' }),
      mkRepo({ id: 'unpushed-old', upstream: TRACKED_AHEAD, lastIso: '2026-07-10T12:00:00.000Z' }),
      mkRepo({ id: 'no-remote-repo', upstream: NO_REMOTE }),
      mkRepo({ id: 'dirty-new', dirty: true, lastIso: '2026-07-31T09:00:00.000Z' }),
      mkRepo({ id: 'stale-old', lastIso: '2026-01-01T00:00:00.000Z' }),
      mkRepo({ id: 'unpushed-new', upstream: TRACKED_AHEAD, lastIso: '2026-07-25T12:00:00.000Z' }),
    ];
    expect(buildAttention(repos, NOW).map((e) => e.repoId)).toEqual([
      'dirty-new',
      'dirty-old',
      'unpushed-new',
      'unpushed-old',
      'stale-new',
      'stale-old',
    ]);
  });

  it('excludes ok and clean no-remote repos from the queue entirely', () => {
    const repos = [mkRepo({ id: 'fine' }), mkRepo({ id: 'islander', upstream: NO_REMOTE })];
    expect(buildAttention(repos, NOW)).toEqual([]);
  });

  it('a multi-reason repo appears exactly once, positioned by its strongest reason', () => {
    const repos = [
      mkRepo({ id: 'ahead-only', upstream: TRACKED_AHEAD, lastIso: '2026-07-30T12:00:00.000Z' }),
      mkRepo({
        id: 'dirty-and-stale',
        dirty: true,
        lastIso: '2026-01-10T14:00:00.000Z', // older activity, but dirty outranks
      }),
    ];
    const queue = buildAttention(repos, NOW);
    expect(queue.map((e) => e.repoId)).toEqual(['dirty-and-stale', 'ahead-only']);
    expect(queue.filter((e) => e.repoId === 'dirty-and-stale')).toHaveLength(1);
    expect(queue[0].reason).toBe('dirty');
  });

  it('entries carry lastActivityIso = last commit author date', () => {
    const repos = [mkRepo({ id: 'd', dirty: true, lastIso: '2026-07-31T09:00:00.000Z' })];
    expect(buildAttention(repos, NOW)).toEqual([
      { repoId: 'd', reason: 'dirty', lastActivityIso: '2026-07-31T09:00:00.000Z' },
    ]);
  });

  it('recency tie-break: identical instants keep stable input order within a band', () => {
    const iso = '2026-07-28T12:00:00.000Z';
    const repos = [
      mkRepo({ id: 'first', dirty: true, lastIso: iso }),
      mkRepo({ id: 'second', dirty: true, lastIso: iso }),
    ];
    expect(buildAttention(repos, NOW).map((e) => e.repoId)).toEqual(['first', 'second']);
  });

  it('reproduces the canonical shared fixture attention queue exactly', () => {
    expect(buildAttention(fixtureSnapshot.repos, fixtureSnapshot.generatedAt)).toEqual(
      fixtureSnapshot.attention,
    );
  });
});
