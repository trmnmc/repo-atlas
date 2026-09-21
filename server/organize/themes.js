/**
 * Repo Atlas — organize: theme config (`projects.json`).
 *
 * The config is the only file the user edits. `themes` is ORDERED: the
 * first theme whose pattern matches wins, so narrow themes go first and
 * the broad `ai-tools` goes last. A pattern is matched against the whole
 * folder name, case-insensitive; `*` matches any run of characters and
 * nothing else is special. `overrides` (name → theme) beat patterns.
 * `paused` (name → ISO date) records "keep" answers so a stale project is
 * not asked about again.
 *
 * loadConfig NEVER writes: a missing file yields the default map with
 * created:true and the CLI decides whether to persist it (never on
 * --dry-run). A corrupt or wrong-shaped file throws ConfigError and is
 * never overwritten. A present-but-unreadable file (EACCES, ...) is not
 * "missing" either: readTextOrMissing rethrows so the caller can tell the
 * two apart and avoid overwriting a file it could not actually read.
 */

import { readTextOrMissing, writeTextAtomic } from './io.js';

/** @typedef {{ themes: Array<{ name: string, match: string[] }>, overrides: Record<string, string>, paused: Record<string, string> }} OrganizeConfig */

/** Theme for a name nothing matches. Never listed in config.themes. */
export const UNSORTED = 'unsorted';

/** @type {Readonly<OrganizeConfig>} */
const DEFAULT_CONFIG = Object.freeze({
  themes: [
    { name: 'minecraft', match: ['*minecraft*', 'minigames*', 'spore', 'sushi-go-*'] },
    { name: 'roblox', match: ['roblox*'] },
    { name: 'games', match: ['dino-*', 'fungame', 'dungeons-*'] },
    { name: 'lofts', match: ['lofts*'] },
    { name: 'finance', match: ['fenley*', 'alpaca*', 'trading-*', 'house-*', 'bat-scanner*'] },
    { name: 'music', match: ['music*', '* project', 'studio by *'] },
    { name: 'discord', match: ['discord*'] },
    { name: 'hardware', match: ['ras-pi', 'pi', 'meta-glasses', 'tailscale-*', 'syncthing*', 'linux-*'] },
    { name: 'writing', match: ['*paper*', '*science*', 'ideas', 'business-*', 'marketing', 'mit-*'] },
    {
      name: 'ai-tools',
      match: ['*claude*', '*agent*', '*-ai*', 'ai-*', 'swarm', 'prompt-*', 'skill-*', 'model-*', 'codex-*', 'tempest', 'tstack*', 'repo-atlas'],
    },
  ],
  overrides: {},
  paused: {},
});

/** @returns {OrganizeConfig} a fresh deep copy of the default map */
export function defaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * @param {string} pattern
 * @returns {RegExp} anchored, case-insensitive; `*` → `.*`, all else literal
 */
export function globToRegExp(pattern) {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`, 'i');
}

/**
 * @param {string} name
 * @param {OrganizeConfig} config
 * @returns {string} theme name or UNSORTED
 */
export function matchTheme(name, config) {
  const override = config.overrides[name];
  if (typeof override === 'string' && override.length > 0) return override;
  for (const theme of config.themes) {
    for (const pattern of theme.match) {
      if (globToRegExp(pattern).test(name)) return theme.name;
    }
  }
  return UNSORTED;
}

/**
 * @param {OrganizeConfig} config
 * @returns {string[]} theme names in config order (UNSORTED not included)
 */
export function themeNames(config) {
  return config.themes.map((t) => t.name);
}

/**
 * @param {unknown} value
 * @returns {value is OrganizeConfig}
 */
export function isConfigShape(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(c.themes)) return false;
  for (const t of c.themes) {
    if (typeof t !== 'object' || t === null) return false;
    const theme = /** @type {Record<string, unknown>} */ (t);
    if (typeof theme.name !== 'string' || !Array.isArray(theme.match)) return false;
    if (!theme.match.every((m) => typeof m === 'string')) return false;
  }
  const isStringMap = (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string');
  return isStringMap(c.overrides) && isStringMap(c.paused);
}

export class ConfigError extends Error {
  /**
   * @param {string} file
   * @param {string} why
   */
  constructor(file, why) {
    super(`projects.json is unusable (${why}): ${file}. Fix or remove it; it will not be overwritten.`);
    this.name = 'ConfigError';
    this.file = file;
  }
}

/**
 * @param {string} file
 * @returns {Promise<{ config: OrganizeConfig, created: boolean }>}
 */
export async function loadConfig(file) {
  const raw = await readTextOrMissing(file);
  if (raw === null) return { config: defaultConfig(), created: true };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(file, 'invalid JSON');
  }
  if (!isConfigShape(parsed)) throw new ConfigError(file, 'wrong shape');
  return { config: parsed, created: false };
}

/**
 * @param {string} file
 * @param {OrganizeConfig} config
 * @returns {Promise<void>}
 */
export async function saveConfig(file, config) {
  await writeTextAtomic(file, `${JSON.stringify(config, null, 2)}\n`);
}
