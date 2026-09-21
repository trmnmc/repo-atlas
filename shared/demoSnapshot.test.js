/**
 * shared/demoSnapshot.test.js — the demo data source stays honest.
 *
 * demoSnapshot feeds BOTH demo modes (`node server/index.js --demo` and the
 * static single-file build), so its shape must match what a real scan emits.
 */
import { describe, it, expect } from 'vitest';
import { demoSnapshot, makeDemoScanFn } from './demoSnapshot.js';
import { fixtureSnapshot } from './fixtures.js';
import { isScanEvent, sortAttention } from './contract.js';

describe('demoSnapshot', () => {
  it('keeps every fixture repo and adds a server-shaped workingTree to each', () => {
    expect(demoSnapshot.repos.map((r) => r.id)).toEqual(fixtureSnapshot.repos.map((r) => r.id));
    for (const repo of demoSnapshot.repos) {
      const tree = repo.workingTree;
      expect(Object.keys(tree).sort()).toEqual(['modified', 'staged', 'truncated', 'untracked']);
      expect(tree.truncated).toBe(false);
      for (const group of [tree.staged, tree.modified, tree.untracked]) {
        expect(Array.isArray(group)).toBe(true);
        for (const file of group) expect(typeof file).toBe('string');
      }
    }
  });

  it('gives dirty repos a manifest and clean repos an empty tree', () => {
    for (const repo of demoSnapshot.repos) {
      const count =
        repo.workingTree.staged.length +
        repo.workingTree.modified.length +
        repo.workingTree.untracked.length;
      if (repo.dirty) expect(count).toBeGreaterThan(0);
      else expect(count).toBe(0);
    }
  });

  it('does not mutate the frozen fixture', () => {
    for (const repo of fixtureSnapshot.repos) {
      expect(repo).not.toHaveProperty('workingTree');
    }
  });

  it('delivers the attention queue already sorted (the client never re-sorts)', () => {
    expect(demoSnapshot.attention).toEqual(sortAttention(demoSnapshot.attention));
    expect(demoSnapshot.attention).toEqual(fixtureSnapshot.attention);
  });
});

describe('makeDemoScanFn', () => {
  it('replays a full start -> repo* -> done event sequence and returns the snapshot', async () => {
    const events = [];
    const scanFn = makeDemoScanFn({ delayMs: 0 });
    const result = await scanFn('/ignored', {
      onProgress: (event) => events.push(event),
      nowIso: '2026-09-01T00:00:00.000Z',
    });

    const total = demoSnapshot.repos.length;
    expect(events.every(isScanEvent)).toBe(true);
    expect(events[0]).toEqual({ phase: 'start', done: 0, total });
    expect(events.at(-1)).toEqual({ phase: 'done', done: total, total });
    expect(events.filter((e) => e.phase === 'repo').map((e) => e.repo)).toEqual(
      demoSnapshot.repos.map((r) => r.name),
    );
    // The sample's ages are computed against ITS generatedAt; a demo scan must
    // not restamp it, or every "n days ago" and stale verdict would drift.
    expect(result).toEqual(demoSnapshot);
  });
});
