/**
 * Repo Atlas — lines-of-code survey for one repository (plain Node ESM).
 *
 * walkLoc(repoPath) walks the working tree classifying line counts by
 * language from file extension. Heavy directories (node_modules, dist,
 * build, .git, vendor, .next, target, coverage) are pruned AT WALK TIME —
 * they are never entered, not filtered afterwards — so a monster
 * node_modules costs nothing. Two caps keep a single repo from stalling
 * the survey: files larger than MAX_FILE_BYTES are skipped entirely, and
 * at most MAX_REPO_FILES files are counted per repo.
 *
 * Never throws: unreadable directories/files and nonexistent paths simply
 * contribute nothing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Directory names never entered during the walk (pruned at readdir). */
export const PRUNED_DIRS = Object.freeze(
  new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    'vendor',
    '.next',
    'target',
    'coverage',
  ]),
);

/** Per-file cap: files larger than this many bytes are skipped. */
export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

/** Per-repo cap: at most this many files are counted. */
export const MAX_REPO_FILES = 10_000;

/**
 * File extension (lowercase, with dot) -> language name.
 * Unknown extensions are not counted at all.
 * @type {Readonly<Record<string, string>>}
 */
export const EXTENSION_LANGUAGES = Object.freeze({
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.md': 'Markdown',
});

/**
 * Count the lines of a text blob: newline-separated, a trailing newline
 * does not create a phantom extra line. Empty content is 0 lines.
 * @param {string} content
 * @returns {number}
 */
export function countLines(content) {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) lines += 1;
  }
  if (content.endsWith('\n')) lines -= 1;
  return lines;
}

/**
 * Survey a repo's working tree: lines of code per language, classified by
 * file extension, with walk-time pruning and size/count caps.
 *
 * @param {string} repoPath
 * @param {{ maxFileBytes?: number, maxFiles?: number }} [opts]
 *   Caps are overridable for tests; production callers use the defaults.
 * @returns {Promise<Record<string, number>>} e.g. { JavaScript: 1204 }
 */
export async function walkLoc(repoPath, opts = {}) {
  const maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES;
  const maxFiles = opts.maxFiles ?? MAX_REPO_FILES;

  /** @type {Record<string, number>} */
  const loc = {};
  let filesCounted = 0;

  /** @param {string} dir */
  async function visit(dir) {
    if (filesCounted >= maxFiles) return;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable or nonexistent: contributes nothing
    }
    // Deterministic walk order so the per-repo file cap is reproducible.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (filesCounted >= maxFiles) return;
      if (entry.isSymbolicLink()) continue; // never follow links (no cycles)
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (PRUNED_DIRS.has(entry.name)) continue; // pruned: NEVER entered
        await visit(full);
      } else if (entry.isFile()) {
        const language = EXTENSION_LANGUAGES[path.extname(entry.name).toLowerCase()];
        if (language === undefined) continue;
        try {
          const stat = await fs.stat(full);
          if (stat.size > maxFileBytes) continue; // oversized: skipped whole
          const content = await fs.readFile(full, 'utf8');
          loc[language] = (loc[language] ?? 0) + countLines(content);
          filesCounted += 1;
        } catch {
          // unreadable file: contributes nothing
        }
      }
    }
  }

  await visit(path.resolve(repoPath));
  return loc;
}
