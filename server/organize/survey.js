/**
 * Repo Atlas — organize: survey of the projects root (plain Node ESM).
 *
 * Part 1 (this task): pure helpers — name filters, stack detection from
 * top-level entry names, remote normalization, description extraction.
 * Part 2 (Task 4): the file walk, light git facts, and surveyProjects().
 *
 * A "project" is a top-level directory of the root that is not the
 * Outdated folder and does not start with a dot. Loose files follow the
 * same dot rule. Nothing here talks to git or the disk.
 */

/** Archive root folder name inside the projects root. */
export const OUTDATED_DIR = 'Outdated';

/**
 * @param {string} name top-level entry name
 * @returns {boolean} true for dot-names and the Outdated folder
 */
export function isIgnoredName(name) {
  return name.startsWith('.') || name === OUTDATED_DIR;
}

/**
 * @param {string[]} names a directory's own entry names
 * @returns {boolean} true when nothing but .DS_Store is present
 */
export function isEmptyListing(names) {
  return names.every((n) => n === '.DS_Store');
}

/**
 * Top-level marker → stack name. Checked by exact name or by extension.
 * @type {ReadonlyArray<{ stack: string, names?: string[], exts?: string[] }>}
 */
const STACK_MARKERS = Object.freeze([
  { stack: 'node', names: ['package.json'] },
  { stack: 'python', names: ['pyproject.toml', 'requirements.txt'] },
  { stack: 'rust', names: ['Cargo.toml'] },
  { stack: 'go', names: ['go.mod'] },
  { stack: 'swift', names: ['Package.swift'], exts: ['.xcodeproj'] },
  { stack: 'roblox', names: ['default.project.json', 'rojo.json'] },
  { stack: 'java', names: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { stack: 'ableton', exts: ['.als'] },
  { stack: 'html', names: ['index.html'] },
  { stack: 'claude-md', names: ['CLAUDE.md'] },
]);

/**
 * @param {string[]} names a project's top-level entry names
 * @returns {string[]} sorted, unique stack names
 */
export function detectStack(names) {
  const found = new Set();
  for (const marker of STACK_MARKERS) {
    const byName = marker.names?.some((n) => names.includes(n)) ?? false;
    const byExt = marker.exts?.some((ext) => names.some((n) => n.toLowerCase().endsWith(ext))) ?? false;
    if (byName || byExt) found.add(marker.stack);
  }
  return [...found].sort();
}

/**
 * @param {string|null} url raw `git remote get-url origin` output
 * @returns {string|null} 'owner/repo' for GitHub, else the trimmed URL
 */
export function normalizeRemote(url) {
  if (url === null) return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return `${m[1]}/${m[2]}`;
  return trimmed;
}

/** Longest description kept. */
const DESCRIPTION_MAX = 120;

/**
 * @param {string|null} readme README.md text
 * @param {string|null} packageJson package.json text
 * @returns {string|null}
 */
export function parseDescription(readme, packageJson) {
  if (readme !== null) {
    const h1 = readme.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
    if (h1) return tidy(h1.slice(1));
  }
  if (packageJson !== null) {
    try {
      const pkg = JSON.parse(packageJson);
      if (typeof pkg.description === 'string' && pkg.description.trim().length > 0) {
        return tidy(pkg.description);
      }
    } catch {
      // bad JSON contributes nothing
    }
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string} single-spaced, trimmed, capped
 */
function tidy(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
}
