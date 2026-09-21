/**
 * Repo Atlas — organize: file helpers (plain Node ESM, zero deps).
 *
 * readTextOrNull(file) never throws: missing, unreadable, or a directory
 * all return null. writeTextAtomic(file, text) mirrors server/cache.js:
 * unique sibling temp file, then rename (atomic within one directory on
 * POSIX); the temp file is removed on any failure. appendLine(file, line)
 * creates the parent directory and appends `line + '\n'`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} file
 * @returns {Promise<string|null>}
 */
export async function readTextOrNull(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writeTextAtomic(file, text) {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * @param {string} file
 * @param {string} line
 * @returns {Promise<void>}
 */
export async function appendLine(file, line) {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${line}\n`, 'utf8');
}
