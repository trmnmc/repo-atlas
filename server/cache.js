/**
 * Repo Atlas — snapshot disk cache (plain Node ESM).
 *
 * loadCache(file) returns the cached Snapshot, or null for a missing,
 * unreadable, corrupt, or wrong-shaped cache — it NEVER throws; a bad
 * cache always degrades to "no cache, rescan".
 *
 * saveCache(file, snapshot) writes ATOMICALLY: serialize to a unique
 * temp file in the same directory, then rename over the target. A crash
 * mid-write can therefore never leave a torn half-written cache where
 * the real file should be.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** @typedef {import('../shared/contract.js').Snapshot} Snapshot */

/**
 * Minimal structural check that parsed JSON is a plausible Snapshot.
 * @param {unknown} value
 * @returns {value is Snapshot}
 */
function isSnapshotShape(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const s = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof s.generatedAt === 'string' &&
    Array.isArray(s.repos) &&
    Array.isArray(s.attention)
  );
}

/**
 * Load a cached Snapshot from disk. Missing file, unreadable file,
 * invalid JSON, or a non-Snapshot shape all return null — never throw.
 * @param {string} file
 * @returns {Promise<Snapshot | null>}
 */
export async function loadCache(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null; // missing or unreadable
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt
  }
  return isSnapshotShape(parsed) ? parsed : null;
}

/**
 * Atomically persist a Snapshot: write a unique sibling temp file, fsync
 * nothing fancy, rename into place (rename within one directory is atomic
 * on POSIX). The temp file is removed on any failure.
 * @param {string} file
 * @param {Snapshot} snapshot
 * @returns {Promise<void>}
 */
export async function saveCache(file, snapshot) {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
  try {
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
