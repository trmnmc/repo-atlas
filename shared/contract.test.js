/**
 * CONTRACT-LOCK TEST — pins the frozen shared contract.
 *
 * Every assertion here is hand-computed. If this suite fails, the contract
 * has drifted: fix the drift, never the assertion.
 *
 * Runs under TZ=America/Chicago (pinned via vite.config.ts test.env) so the
 * local-timezone day-bucketing assertions are machine-independent.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { Plate } from '../src/components/Plate.tsx';

import {
  ATTENTION_ORDER,
  ATTENTION_REASONS,
  SCAN_PHASES,
  UPSTREAM_STATES,
  attentionComparator,
  sortAttention,
  dayKey,
  STALE_DAYS,
  isStale,
  isScanEvent,
  API_ATLAS,
  API_RESCAN,
  API_SCAN_EVENTS,
  API_REPO_PATTERN,
  apiRepoRoute,
  ROUTES,
  CSS,
  advisoryClass,
  heatmapLevelClass,
} from './contract.js';
import { fixtureSnapshot, fixtureRepo } from './fixtures.js';

describe('test environment', () => {
  it('runs under the pinned timezone America/Chicago', () => {
    expect(process.env.TZ).toBe('America/Chicago');
    // CST = UTC-6 (offset 360), CDT = UTC-5 (offset 300).
    const offset = new Date('2026-01-15T12:00:00Z').getTimezoneOffset();
    expect(offset).toBe(360);
    const dstOffset = new Date('2026-07-15T12:00:00Z').getTimezoneOffset();
    expect(dstOffset).toBe(300);
  });
});

describe('status enums (frozen values)', () => {
  it('pins every attention reason, in priority order', () => {
    expect([...ATTENTION_ORDER]).toEqual(['dirty', 'unpushed', 'stale']);
    expect(ATTENTION_REASONS).toBe(ATTENTION_ORDER);
    expect(Object.isFrozen(ATTENTION_ORDER)).toBe(true);
  });

  it('pins every scan phase', () => {
    expect([...SCAN_PHASES]).toEqual(['start', 'repo', 'done']);
    expect(Object.isFrozen(SCAN_PHASES)).toBe(true);
  });

  it('pins the three-state upstream state values (tracked | none)', () => {
    expect([...UPSTREAM_STATES]).toEqual(['tracked', 'none']);
    expect(Object.isFrozen(UPSTREAM_STATES)).toBe(true);
  });
});

describe('attentionComparator', () => {
  const dirtyNew = { repoId: 'a', reason: 'dirty', lastActivityIso: '2026-07-31T09:00:00.000Z' };
  const dirtyOld = { repoId: 'b', reason: 'dirty', lastActivityIso: '2026-07-01T09:00:00.000Z' };
  const unpushedNew = { repoId: 'c', reason: 'unpushed', lastActivityIso: '2026-07-31T10:00:00.000Z' };
  const unpushedOld = { repoId: 'd', reason: 'unpushed', lastActivityIso: '2026-06-01T10:00:00.000Z' };
  const staleNew = { repoId: 'e', reason: 'stale', lastActivityIso: '2026-04-01T00:00:00.000Z' };
  const staleOld = { repoId: 'f', reason: 'stale', lastActivityIso: '2025-12-25T00:00:00.000Z' };

  it('ranks dirty above unpushed above stale, regardless of recency', () => {
    // dirtyOld is OLDER than unpushedNew and staleNew — reason still wins.
    expect(attentionComparator(dirtyOld, unpushedNew)).toBeLessThan(0);
    expect(attentionComparator(dirtyOld, staleNew)).toBeLessThan(0);
    expect(attentionComparator(unpushedOld, staleNew)).toBeLessThan(0);
    // and symmetrically:
    expect(attentionComparator(unpushedNew, dirtyOld)).toBeGreaterThan(0);
    expect(attentionComparator(staleNew, dirtyOld)).toBeGreaterThan(0);
    expect(attentionComparator(staleNew, unpushedOld)).toBeGreaterThan(0);
  });

  it('breaks ties within a reason by most-recent activity first', () => {
    expect(attentionComparator(dirtyNew, dirtyOld)).toBeLessThan(0);
    expect(attentionComparator(dirtyOld, dirtyNew)).toBeGreaterThan(0);
    expect(attentionComparator(unpushedNew, unpushedOld)).toBeLessThan(0);
    expect(attentionComparator(staleNew, staleOld)).toBeLessThan(0);
  });

  it('returns 0 for identical reason and instant', () => {
    expect(attentionComparator(dirtyNew, { ...dirtyNew, repoId: 'z' })).toBe(0);
  });

  it('sorts a hand-built scrambled matrix into the exact expected order', () => {
    const scrambled = [staleOld, unpushedOld, dirtyOld, staleNew, dirtyNew, unpushedNew];
    const expected = [dirtyNew, dirtyOld, unpushedNew, unpushedOld, staleNew, staleOld];
    expect(scrambled.slice().sort(attentionComparator)).toEqual(expected);
    expect(sortAttention(scrambled)).toEqual(expected);
    // sortAttention must not mutate its input.
    expect(scrambled[0]).toBe(staleOld);
  });
});

describe('dayKey — local-timezone day bucketing', () => {
  it('buckets a UTC instant into its America/Chicago calendar day (winter, CST)', () => {
    // 2026-01-02T03:30Z is 2026-01-01 21:30 CST — the UTC day differs from
    // the local day. THIS is the TZ trap the suite must catch.
    expect(dayKey('2026-01-02T03:30:00Z')).toBe('2026-01-01');
  });

  it('buckets a UTC instant into its America/Chicago calendar day (summer, CDT)', () => {
    // 2026-07-01T02:00Z is 2026-06-30 21:00 CDT.
    expect(dayKey('2026-07-01T02:00:00Z')).toBe('2026-06-30');
  });

  it('keeps a midday UTC instant on the same local day', () => {
    // 2026-03-15T18:00Z is 13:00 CDT (DST began 2026-03-08).
    expect(dayKey('2026-03-15T18:00:00Z')).toBe('2026-03-15');
  });

  it('accepts a Date object', () => {
    expect(dayKey(new Date('2026-01-02T03:30:00Z'))).toBe('2026-01-01');
  });

  it('accepts an ISO string with an explicit offset', () => {
    // 2026-07-04T00:30-05:00 is already local-shaped: 2026-07-04 in Chicago.
    expect(dayKey('2026-07-04T00:30:00-05:00')).toBe('2026-07-04');
  });

  it('zero-pads month and day', () => {
    expect(dayKey('2026-02-03T12:00:00-06:00')).toBe('2026-02-03');
  });
});

describe('staleness boundary', () => {
  const now = '2026-08-01T12:00:00.000Z';
  // 90 days before now: May 3 -> Aug 1 2026 is exactly 90 days.
  const exactly90 = '2026-05-03T12:00:00.000Z';

  it('pins STALE_DAYS to 90', () => {
    expect(STALE_DAYS).toBe(90);
  });

  it('is NOT stale at exactly 90 days (spec: strictly greater than)', () => {
    expect(isStale(exactly90, now)).toBe(false);
  });

  it('IS stale one millisecond past 90 days', () => {
    expect(isStale('2026-05-03T11:59:59.999Z', now)).toBe(true);
  });

  it('is not stale well inside the window, is stale well outside it', () => {
    expect(isStale('2026-07-31T00:00:00.000Z', now)).toBe(false);
    expect(isStale('2026-01-10T14:00:00.000Z', now)).toBe(true);
  });
});

describe('ScanEvent shape', () => {
  it('accepts the three canonical events', () => {
    expect(isScanEvent({ phase: 'start', done: 0, total: 0 })).toBe(true);
    expect(isScanEvent({ phase: 'repo', repo: 'ember-ledger', done: 1, total: 6 })).toBe(true);
    expect(isScanEvent({ phase: 'done', done: 6, total: 6 })).toBe(true);
  });

  it('rejects unknown phases and missing counters', () => {
    expect(isScanEvent({ phase: 'scanning', done: 0, total: 0 })).toBe(false);
    expect(isScanEvent({ phase: 'start', total: 0 })).toBe(false);
    expect(isScanEvent({ phase: 'start', done: 0 })).toBe(false);
    expect(isScanEvent({ phase: 'start', done: '0', total: 0 })).toBe(false);
    expect(isScanEvent(null)).toBe(false);
    expect(isScanEvent('start')).toBe(false);
  });

  it("requires a non-empty repo name on 'repo' and forbids it elsewhere", () => {
    expect(isScanEvent({ phase: 'repo', done: 1, total: 6 })).toBe(false);
    expect(isScanEvent({ phase: 'repo', repo: '', done: 1, total: 6 })).toBe(false);
    expect(isScanEvent({ phase: 'repo', repo: 42, done: 1, total: 6 })).toBe(false);
    expect(isScanEvent({ phase: 'start', repo: 'x', done: 0, total: 0 })).toBe(false);
    expect(isScanEvent({ phase: 'done', repo: 'x', done: 6, total: 6 })).toBe(false);
  });
});

describe('API routes', () => {
  it('pins every route string', () => {
    expect(API_ATLAS).toBe('/api/atlas');
    expect(API_RESCAN).toBe('/api/rescan');
    expect(API_SCAN_EVENTS).toBe('/api/scan-events');
    expect(API_REPO_PATTERN).toBe('/api/repo/:id');
  });

  it('builds per-repo routes with URL-encoding', () => {
    expect(apiRepoRoute('ember-ledger')).toBe('/api/repo/ember-ledger');
    expect(apiRepoRoute('odd id')).toBe('/api/repo/odd%20id');
  });

  it('exposes the same values through ROUTES', () => {
    expect(ROUTES.atlas).toBe(API_ATLAS);
    expect(ROUTES.rescan).toBe(API_RESCAN);
    expect(ROUTES.scanEvents).toBe(API_SCAN_EVENTS);
    expect(ROUTES.repoPattern).toBe(API_REPO_PATTERN);
    expect(ROUTES.repo('x')).toBe('/api/repo/x');
  });
});

describe('CSS render vocabulary', () => {
  it('pins every class-name constant', () => {
    expect(CSS).toEqual({
      plate: 'plate',
      plateCaption: 'plate-caption',
      plateFigure: 'plate-figure',
      plateBody: 'plate-body',
      advisory: 'advisory',
      advisoryDirty: 'advisory--dirty',
      advisoryUnpushed: 'advisory--unpushed',
      advisoryStale: 'advisory--stale',
      advisoryNoRemote: 'advisory--no-remote',
      gazetteerRow: 'gazetteer-row',
      sounding: 'sounding',
      strataBand: 'strata-band',
      heatmapCell: 'heatmap-cell',
      palette: 'palette',
    });
    expect(Object.isFrozen(CSS)).toBe(true);
  });

  it('builds advisory modifier classes, including the no-remote marker', () => {
    expect(advisoryClass('dirty')).toBe('advisory--dirty');
    expect(advisoryClass('unpushed')).toBe('advisory--unpushed');
    expect(advisoryClass('stale')).toBe('advisory--stale');
    expect(advisoryClass('no-remote')).toBe('advisory--no-remote');
  });

  it('builds heatmap intensity classes l0..l4', () => {
    expect([0, 1, 2, 3, 4].map(heatmapLevelClass)).toEqual([
      'heatmap-cell--l0',
      'heatmap-cell--l1',
      'heatmap-cell--l2',
      'heatmap-cell--l3',
      'heatmap-cell--l4',
    ]);
  });
});

describe('canonical fixture Snapshot lock', () => {
  it('pins generatedAt and the repo roster', () => {
    expect(fixtureSnapshot.generatedAt).toBe('2026-08-01T12:00:00.000Z');
    expect(fixtureSnapshot.repos.map((r) => r.id)).toEqual([
      'ember-ledger',
      'field-notes',
      'tide-tables',
      'old-survey',
      'meridian',
      'drift-bottle',
    ]);
  });

  it('covers every required state', () => {
    expect(fixtureRepo('ember-ledger').dirty).toBe(true);
    expect(fixtureRepo('field-notes').dirty).toBe(true);
    expect(fixtureRepo('tide-tables').upstream).toEqual({ state: 'tracked', aheadBy: 3, behindBy: 0 });
    expect(isStale(fixtureRepo('old-survey').lastCommit.iso, fixtureSnapshot.generatedAt)).toBe(true);
    const clean = fixtureRepo('meridian');
    expect(clean.dirty).toBe(false);
    expect(clean.upstream).toEqual({ state: 'tracked', aheadBy: 0, behindBy: 0 });
    expect(isStale(clean.lastCommit.iso, fixtureSnapshot.generatedAt)).toBe(false);
    expect(fixtureRepo('drift-bottle').upstream).toEqual({ state: 'none' });
  });

  it('deep-equal locks the derived attention ordering', () => {
    expect(fixtureSnapshot.attention).toEqual([
      { repoId: 'ember-ledger', reason: 'dirty', lastActivityIso: '2026-07-31T09:14:00.000Z' },
      { repoId: 'field-notes', reason: 'dirty', lastActivityIso: '2026-07-20T18:45:00.000Z' },
      { repoId: 'tide-tables', reason: 'unpushed', lastActivityIso: '2026-07-26T21:30:00.000Z' },
      { repoId: 'old-survey', reason: 'stale', lastActivityIso: '2026-01-10T14:00:00.000Z' },
    ]);
  });

  it('stores attention already sorted per attentionComparator', () => {
    expect(sortAttention(fixtureSnapshot.attention)).toEqual(fixtureSnapshot.attention);
  });

  it('never lists the no-remote repo as unpushed', () => {
    const driftEntries = fixtureSnapshot.attention.filter((e) => e.repoId === 'drift-bottle');
    expect(driftEntries).toEqual([]);
  });

  it('every attention reason is a pinned enum value and repoId resolves', () => {
    for (const entry of fixtureSnapshot.attention) {
      expect(ATTENTION_REASONS).toContain(entry.reason);
      expect(() => fixtureRepo(entry.repoId)).not.toThrow();
    }
  });

  it('commitDays keys are YYYY-MM-DD, values positive ints, spanning ~12 months', () => {
    for (const repo of fixtureSnapshot.repos) {
      for (const [key, count] of Object.entries(repo.commitDays)) {
        expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
    }
    const emberDays = Object.keys(fixtureRepo('ember-ledger').commitDays).sort();
    expect(emberDays[0] >= '2025-08-01').toBe(true);
    expect(emberDays[emberDays.length - 1] <= '2026-07-31').toBe(true);
    expect(emberDays[0] < '2025-09-01').toBe(true); // starts ~12 months back
    expect(emberDays[emberDays.length - 1] > '2026-07-01').toBe(true); // reaches the recent month
    expect(emberDays.length).toBeGreaterThan(60);
  });

  it('fixture is deterministic across imports (no wall clock)', async () => {
    const fresh = await import('./fixtures.js?cachebust=lock');
    expect(fresh.fixtureSnapshot).toEqual(fixtureSnapshot);
  });
});

describe('Plate component lock (frozen frame markup)', () => {
  it('renders frame, figure ordinal, small-caps caption, and children with token classes', () => {
    const { container } = render(
      createElement(
        Plate,
        { figure: 1, caption: 'Notices' },
        createElement('p', null, 'advisory contents'),
      ),
    );
    const frame = container.querySelector(`section.${CSS.plate}`);
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('aria-label')).toBe('Fig. 1 — Notices');
    const caption = frame.querySelector(`header.${CSS.plateCaption}`);
    expect(caption).not.toBeNull();
    expect(caption.querySelector(`.${CSS.plateFigure}`).textContent).toBe('Fig. 1');
    expect(caption.textContent).toContain('Notices');
    const body = frame.querySelector(`div.${CSS.plateBody}`);
    expect(body).not.toBeNull();
    expect(body.textContent).toBe('advisory contents');
  });

  it('appends a caller className to the frame and accepts string figures', () => {
    const { container } = render(
      createElement(Plate, { figure: 'IV', caption: 'Soundings', className: 'wide' }),
    );
    const frame = container.querySelector('section');
    expect(frame.className).toBe(`${CSS.plate} wide`);
    expect(frame.getAttribute('aria-label')).toBe('Fig. IV — Soundings');
  });
});
