/**
 * server/demo.test.js — `node server/index.js --demo` wiring.
 *
 * Demo mode must never touch the owner's real data: no git scan of
 * ~/Projects, no read or write of the real .atlas-cache.json, no Finder.
 */
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { mainConfig, DEFAULT_CACHE_FILE } from './index.js';
import { scan } from './scan.js';
import { demoSnapshot } from '../shared/demoSnapshot.js';

describe('mainConfig', () => {
  it('runs the real scan against the real cache by default', () => {
    const config = mainConfig(['node', 'server/index.js']);
    expect(config.scanFn).toBe(scan);
    expect(config.cacheFile).toBe(DEFAULT_CACHE_FILE);
    expect(config.repoActionFn).toBeUndefined();
  });

  it('--demo swaps in the sample scan and a throwaway cache', async () => {
    const config = mainConfig(['node', 'server/index.js', '--demo']);
    expect(config.scanFn).not.toBe(scan);
    expect(config.cacheFile).not.toBe(DEFAULT_CACHE_FILE);
    expect(config.cacheFile.startsWith(os.tmpdir())).toBe(true);
    expect(await config.scanFn(config.rootDir, {})).toEqual(demoSnapshot);
  });

  it('--demo refuses native actions: the sample paths do not exist', async () => {
    const config = mainConfig(['node', 'server/index.js', '--demo']);
    await expect(config.repoActionFn('/Users/surveyor/Projects/ember-ledger', 'finder')).rejects.toThrow();
  });
});
