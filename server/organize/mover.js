/**
 * Repo Atlas — organize: archive moves.
 *
 * planMoves is pure: archive decisions → {name, from, to}. applyMoves runs
 * fs.rename one move at a time (same volume only — EXDEV is reported, never
 * worked around with a copy), refuses an existing destination, reports a
 * vanished source, and appends one tab-separated log line ONLY after a
 * rename succeeds. One failure never stops the others. Nothing here ever
 * deletes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { appendLine } from './io.js';
import { OUTDATED_DIR } from './survey.js';

/** @typedef {import('./prompt.js').Decision} Decision */
/** @typedef {{ name: string, from: string, to: string }} Move */

export const ARCHIVE_SUBDIR = 'archived-projects';
export const EMPTIES_SUBDIR = 'empties';
export const LOG_FILE = 'MOVES.log';

/** @param {string} root */
export function moveLogFile(root) {
  return path.join(root, OUTDATED_DIR, LOG_FILE);
}

/** @param {string} root */
export async function ensureOutdatedDirs(root) {
  await fs.mkdir(path.join(root, OUTDATED_DIR, ARCHIVE_SUBDIR), { recursive: true });
  await fs.mkdir(path.join(root, OUTDATED_DIR, EMPTIES_SUBDIR), { recursive: true });
}

/**
 * @param {Decision[]} decisions
 * @param {string} root
 * @returns {Move[]}
 */
export function planMoves(decisions, root) {
  /** @type {Move[]} */
  const moves = [];
  for (const d of decisions) {
    if (d.action !== 'archive') continue;
    moves.push({
      name: d.name,
      from: path.join(root, d.name),
      to: path.join(root, OUTDATED_DIR, d.subdir, d.name),
    });
  }
  return moves;
}

/** @param {string} p */
async function exists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Move[]} moves
 * @param {{ nowIso: string, logFile: string, rename?: (from: string, to: string) => Promise<void> }} opts
 * @returns {Promise<{ done: Move[], skipped: Array<{ move: Move, reason: string }> }>}
 */
export async function applyMoves(moves, { nowIso, logFile, rename = fs.rename }) {
  /** @type {Move[]} */
  const done = [];
  /** @type {Array<{ move: Move, reason: string }>} */
  const skipped = [];
  for (const move of moves) {
    await fs.mkdir(path.dirname(move.to), { recursive: true });
    if (await exists(move.to)) {
      skipped.push({ move, reason: 'destination exists' });
      continue;
    }
    try {
      await rename(move.from, move.to);
    } catch (err) {
      const code = /** @type {{ code?: string, message?: string }} */ (err).code;
      const reason =
        code === 'EXDEV' ? 'different volume'
        : code === 'ENOENT' ? 'source vanished'
        : /** @type {Error} */ (err).message;
      skipped.push({ move, reason });
      continue;
    }
    await appendLine(logFile, `${nowIso}\t${move.from}\t${move.to}`);
    done.push(move);
  }
  return { done, skipped };
}
