/**
 * shared/demoSnapshot.js — the sample Snapshot behind both demo modes.
 *
 * Repo Atlas surveys YOUR local repositories, so a hosted copy has nothing to
 * read. Demo mode swaps the git scan for this canned Snapshot:
 *
 *   node server/index.js --demo    (server/index.js main entry)
 *   npm run build:demo             (src/demo/demoBackend.ts, static single file)
 *
 * One source for both, so the two demos cannot drift apart.
 *
 * It is DERIVED from the frozen canonical fixture (shared/fixtures.js), never
 * a copy and never an edit: the fixture predates repo.workingTree, so each
 * repo is spread and given a tree of exactly the server's shape. Without one,
 * Fig. 9a would show its degraded "rescan for the manifest" line on every
 * dirty repo and the demo would hide the plate.
 */
import { fixtureSnapshot } from './fixtures.js';

const CLEAN_TREE = Object.freeze({ staged: [], modified: [], untracked: [], truncated: false });

/** Uncommitted work for the fixture's dirty repos, keyed by repo id. */
const DEMO_TREES = {
  'ember-ledger': {
    staged: ['src/ledger.ts', 'src/rollover.ts'],
    modified: ['src/accounts.ts', 'README.md'],
    untracked: ['notes/july-reconcile.md'],
    truncated: false,
  },
  'field-notes': {
    staged: [],
    modified: ['notes/app.js'],
    untracked: ['notes/2026-07-21.md', 'notes/2026-07-22.md'],
    truncated: false,
  },
};

export const demoSnapshot = {
  ...fixtureSnapshot,
  repos: fixtureSnapshot.repos.map((repo) => {
    const tree = DEMO_TREES[repo.id] ?? CLEAN_TREE;
    return {
      ...repo,
      workingTree: {
        staged: [...tree.staged],
        modified: [...tree.modified],
        untracked: [...tree.untracked],
        truncated: tree.truncated,
      },
    };
  }),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A scan() stand-in that replays demoSnapshot through onProgress, so a demo
 * rescan shows the real "Surveying n/total" bar. It returns the snapshot with
 * its OWN generatedAt: every age and stale verdict in the sample is computed
 * against that instant, so restamping it with the wall clock would drift them.
 * @param {{ delayMs?: number }} [opts]
 */
export function makeDemoScanFn({ delayMs = 120 } = {}) {
  return async function demoScan(_rootDir, { onProgress } = {}) {
    const total = demoSnapshot.repos.length;
    onProgress?.({ phase: 'start', done: 0, total });
    let done = 0;
    for (const repo of demoSnapshot.repos) {
      await sleep(delayMs);
      done += 1;
      onProgress?.({ phase: 'repo', repo: repo.name, done, total });
    }
    onProgress?.({ phase: 'done', done, total });
    return demoSnapshot;
  };
}
