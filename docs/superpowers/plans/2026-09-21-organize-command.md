# Organize Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run organize` to repo-atlas. It surveys `~/Projects`, gives every project a theme and a status, proposes archive moves into `Outdated/`, and writes `PROJECTS.md` and a block in `CLAUDE.md`.

**Architecture:** Seven small ESM modules under `server/organize/`, one job each, pure where possible with IO injected. The CLI wires them: survey → classify → report → prompts → moves → write. Nothing outside `server/organize/` changes except one script line in `package.json` and a README section.

**Tech Stack:** Node 22, plain ESM JavaScript with JSDoc, zero runtime dependencies, `node:util` `parseArgs`, `node:readline/promises`, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-20-organize-projects-design.md`

## Global Constraints

- Zero runtime dependencies. Only `node:*` imports in `server/organize/`.
- `shared/contract.js` is frozen. Never edit it. Import `isStale`, `STALE_DAYS`, `dayKey` from it.
- `server/scan.js`, `server/gitFacts.js`, `server/index.js`, `server/cache.js`, `server/loc.js`, and everything under `src/` are not edited. Import `PRUNED_DIRS`, `MAX_REPO_FILES` from `server/loc.js`.
- Git is read-only. Every git call is `execFile('git', [...argv])`, never a shell string, and every call is guarded so a failure returns `null`.
- The tool never deletes. It never moves `active`, `paused`, or `unknown` projects, and never moves loose files.
- Nothing moves without the final `y`. Nothing is written on `--dry-run`.
- Tests never touch `~/Projects`. Every test builds its fixture in `fs.mkdtempSync(path.join(os.tmpdir(), ...))` and removes it in `afterAll`.
- Server test files start with `// @vitest-environment node` (the config default is jsdom).
- `nowIso` is always a parameter. `Date.now()` and `new Date()` appear only in `cli.js` main.
- Archive root is `<root>/Outdated`. Projects go to `Outdated/archived-projects/<name>`, empties to `Outdated/empties/<name>`. Log is `Outdated/MOVES.log`.
- Stale means strictly more than `staleDays` days. Exactly `staleDays` is not stale.
- Commit after every task with a conventional message and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on branch `organize` in `~/Projects/repo-atlas`.

---

## File structure

| File | Responsibility |
|---|---|
| `server/organize/io.js` | Three file helpers: read text or null, atomic text write, append a line. |
| `server/organize/themes.js` | `projects.json` shape, default map, glob matcher, load and save. |
| `server/organize/survey.js` | Read the root. Facts per project via light git calls and a pruned file walk. Loose files. `Outdated/` listing. |
| `server/organize/classify.js` | Activity date, status, theme per project. Duplicate and unsorted notices. Summary counts. |
| `server/organize/render.js` | `PROJECTS.md`, the `CLAUDE.md` block and splice, the console report. |
| `server/organize/prompt.js` | Three prompt rounds and the final confirmation, against an injected `ask`. |
| `server/organize/mover.js` | Plan moves from decisions. Apply them with injected rename and log. |
| `server/organize/cli.js` | Flags, wiring, exit codes, readline. |
| `package.json` | One script line. |
| `README.md` | One section describing the command. |

Each module has a sibling `*.test.js`.

## Shared types (JSDoc, defined once in `survey.js` and `classify.js`, imported by typedef elsewhere)

```js
/**
 * @typedef {Object} ProjectFacts
 * @property {string} name            Directory name.
 * @property {string} path            Absolute path.
 * @property {'git'|'folder'} kind
 * @property {boolean} readable       false when readdir failed; all other facts are then null/0/[]/false.
 * @property {string|null} lastCommitIso   `git log -1 --format=%aI`, git only.
 * @property {boolean} dirty          `git status --porcelain` non-empty, git only.
 * @property {number} aheadBy         `git rev-list --count @{u}..HEAD`, 0 when no upstream.
 * @property {string|null} remote     'owner/repo' for GitHub, else the URL, null when none.
 * @property {string|null} newestFileIso   Newest regular-file mtime inside, pruned walk.
 * @property {number} fileCount       Files seen by the walk (capped).
 * @property {number} bytes           Sum of sizes of files seen by the walk.
 * @property {boolean} empty          Own listing has nothing but .DS_Store.
 * @property {string[]} stack         e.g. ['node', 'claude-md'].
 * @property {string|null} description   README first `# ` heading, else package.json description.
 */

/** @typedef {{ projects: ProjectFacts[], looseFiles: string[], outdated: Record<string, string[]> }} SurveyResult */

/** @typedef {'active'|'paused'|'stale'|'empty'|'unknown'} Status */

/** @typedef {ProjectFacts & { theme: string, status: Status, activityIso: string|null }} ProjectRecord */

/** @typedef {{ names: string[], reason: 'remote'|'name', key: string }} DuplicateNotice */

/**
 * @typedef {Object} Notices
 * @property {ProjectRecord[]} candidates   status 'stale'
 * @property {ProjectRecord[]} empties      status 'empty'
 * @property {ProjectRecord[]} unsorted     theme 'unsorted'
 * @property {DuplicateNotice[]} duplicates
 * @property {string[]} looseFiles
 */

/** @typedef {{ name: string, action: 'theme', theme: string } | { name: string, action: 'keep' } | { name: string, action: 'skip' } | { name: string, action: 'archive', subdir: 'archived-projects'|'empties' }} Decision */

/** @typedef {{ name: string, from: string, to: string }} Move */

/** @typedef {{ themes: Array<{ name: string, match: string[] }>, overrides: Record<string, string>, paused: Record<string, string> }} OrganizeConfig */
```

---

### Task 1: File helpers (`io.js`)

**Files:**
- Create: `server/organize/io.js`
- Test: `server/organize/io.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `readTextOrNull(file): Promise<string|null>`, `writeTextAtomic(file, text): Promise<void>`, `appendLine(file, line): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/io helpers: read-or-null, atomic write, append.
 * Real mktemp directory, removed in afterAll. Never touches ~/Projects.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTextOrNull, writeTextAtomic, appendLine } from './io.js';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-io-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('readTextOrNull', () => {
  it('returns the file text', async () => {
    const f = path.join(root, 'a.txt');
    fs.writeFileSync(f, 'hello\n');
    expect(await readTextOrNull(f)).toBe('hello\n');
  });
  it('returns null for a missing file', async () => {
    expect(await readTextOrNull(path.join(root, 'nope.txt'))).toBeNull();
  });
  it('returns null for a directory', async () => {
    expect(await readTextOrNull(root)).toBeNull();
  });
});

describe('writeTextAtomic', () => {
  it('creates parent directories and writes the text', async () => {
    const f = path.join(root, 'deep', 'er', 'b.md');
    await writeTextAtomic(f, '# B\n');
    expect(fs.readFileSync(f, 'utf8')).toBe('# B\n');
  });
  it('overwrites an existing file', async () => {
    const f = path.join(root, 'c.md');
    await writeTextAtomic(f, 'one\n');
    await writeTextAtomic(f, 'two\n');
    expect(fs.readFileSync(f, 'utf8')).toBe('two\n');
  });
  it('leaves no temp file behind', async () => {
    const dir = path.join(root, 'clean');
    await writeTextAtomic(path.join(dir, 'd.md'), 'x\n');
    expect(fs.readdirSync(dir)).toEqual(['d.md']);
  });
});

describe('appendLine', () => {
  it('creates the file and appends lines with newlines', async () => {
    const f = path.join(root, 'logs', 'moves.log');
    await appendLine(f, 'first');
    await appendLine(f, 'second');
    expect(fs.readFileSync(f, 'utf8')).toBe('first\nsecond\n');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/io.test.js`
Expected: FAIL. `Cannot find module './io.js'`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/io.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/io.js server/organize/io.test.js
git commit -m "feat(organize): file helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Theme config (`themes.js`)

**Files:**
- Create: `server/organize/themes.js`
- Test: `server/organize/themes.test.js`

**Interfaces:**
- Consumes: `readTextOrNull`, `writeTextAtomic` from `./io.js`.
- Produces:
  - `UNSORTED = 'unsorted'`
  - `defaultConfig(): OrganizeConfig` (fresh copy each call)
  - `globToRegExp(pattern: string): RegExp` (case-insensitive, whole-name, `*` only)
  - `matchTheme(name: string, config: OrganizeConfig): string`
  - `themeNames(config: OrganizeConfig): string[]` (config order, no `unsorted`)
  - `isConfigShape(value: unknown): boolean`
  - `class ConfigError extends Error` with `.file`
  - `loadConfig(file: string): Promise<{ config: OrganizeConfig, created: boolean }>`
  - `saveConfig(file: string, config: OrganizeConfig): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/themes: glob matcher, ordered themes, overrides,
 * default config, load (missing → default, corrupt → ConfigError), save.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  UNSORTED,
  defaultConfig,
  globToRegExp,
  matchTheme,
  themeNames,
  isConfigShape,
  ConfigError,
  loadConfig,
  saveConfig,
} from './themes.js';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-themes-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it('matches the whole name, case-insensitive', () => {
    expect(globToRegExp('roblox*').test('ROBLOXXX')).toBe(true);
    expect(globToRegExp('roblox*').test('my-roblox')).toBe(false);
    expect(globToRegExp('*minecraft*').test('SUSHI-GO-MINECRAFT')).toBe(true);
    expect(globToRegExp('pi').test('pi')).toBe(true);
    expect(globToRegExp('pi').test('spotify')).toBe(false);
  });
  it('escapes regex metacharacters other than *', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('a.b').test('a.b')).toBe(true);
    expect(globToRegExp('c++').test('c++')).toBe(true);
  });
  it('matches names with spaces', () => {
    expect(globToRegExp('* project').test('seeing-stars Project')).toBe(true);
    expect(globToRegExp('studio by *').test('studio by spotify fun')).toBe(true);
  });
});

describe('matchTheme', () => {
  const config = {
    themes: [
      { name: 'minecraft', match: ['*minecraft*'] },
      { name: 'finance', match: ['trading-*'] },
      { name: 'ai-tools', match: ['*agent*'] },
    ],
    overrides: { SPORE: 'minecraft' },
    paused: {},
  };
  it('first matching theme wins, in config order', () => {
    expect(matchTheme('trading-agents', config)).toBe('finance');
    expect(matchTheme('minecraft-agents', config)).toBe('minecraft');
    expect(matchTheme('AGENT-ARENA', config)).toBe('ai-tools');
  });
  it('overrides win over patterns', () => {
    expect(matchTheme('SPORE', config)).toBe('minecraft');
  });
  it('falls back to unsorted', () => {
    expect(matchTheme('random', config)).toBe(UNSORTED);
    expect(UNSORTED).toBe('unsorted');
  });
});

describe('defaultConfig', () => {
  it('has ai-tools last so narrow themes win', () => {
    const names = themeNames(defaultConfig());
    expect(names[names.length - 1]).toBe('ai-tools');
    expect(names).toContain('finance');
    expect(names).toContain('minecraft');
  });
  it('routes the known tricky names', () => {
    const c = defaultConfig();
    expect(matchTheme('trading-agents', c)).toBe('finance');
    expect(matchTheme('minecraft-agents', c)).toBe('minecraft');
    expect(matchTheme('claude-1 Project', c)).toBe('music');
    expect(matchTheme('liqrbox-redesign', c)).toBe(UNSORTED);
    expect(matchTheme('game-genie', c)).toBe(UNSORTED);
    expect(matchTheme('LINUX-AI', c)).toBe('hardware');
    expect(matchTheme('repo-atlas', c)).toBe('ai-tools');
  });
  it('returns a fresh object each call', () => {
    const a = defaultConfig();
    a.themes.push({ name: 'x', match: [] });
    expect(defaultConfig().themes.some((t) => t.name === 'x')).toBe(false);
  });
});

describe('isConfigShape', () => {
  it('accepts the default and rejects junk', () => {
    expect(isConfigShape(defaultConfig())).toBe(true);
    expect(isConfigShape(null)).toBe(false);
    expect(isConfigShape({ themes: 'no' })).toBe(false);
    expect(isConfigShape({ themes: [], overrides: {}, paused: {} })).toBe(true);
    expect(isConfigShape({ themes: [{ name: 'a' }], overrides: {}, paused: {} })).toBe(false);
  });
});

describe('loadConfig / saveConfig', () => {
  it('missing file → default config, created: true, nothing written', async () => {
    const f = path.join(root, 'missing', 'projects.json');
    const { config, created } = await loadConfig(f);
    expect(created).toBe(true);
    expect(themeNames(config)).toEqual(themeNames(defaultConfig()));
    expect(fs.existsSync(f)).toBe(false);
  });
  it('round-trips through save', async () => {
    const f = path.join(root, 'projects.json');
    const c = defaultConfig();
    c.overrides.SPORE = 'minecraft';
    c.paused['alpaca-v2'] = '2026-09-21';
    await saveConfig(f, c);
    const { config, created } = await loadConfig(f);
    expect(created).toBe(false);
    expect(config.overrides).toEqual({ SPORE: 'minecraft' });
    expect(config.paused).toEqual({ 'alpaca-v2': '2026-09-21' });
    expect(fs.readFileSync(f, 'utf8').endsWith('\n')).toBe(true);
  });
  it('corrupt JSON → ConfigError naming the file', async () => {
    const f = path.join(root, 'bad.json');
    fs.writeFileSync(f, '{ not json');
    await expect(loadConfig(f)).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig(f)).rejects.toMatchObject({ file: f });
    expect(fs.readFileSync(f, 'utf8')).toBe('{ not json');
  });
  it('wrong shape → ConfigError', async () => {
    const f = path.join(root, 'shape.json');
    fs.writeFileSync(f, '{"themes": 5}');
    await expect(loadConfig(f)).rejects.toBeInstanceOf(ConfigError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/themes.test.js`
Expected: FAIL. `Cannot find module './themes.js'`.

- [ ] **Step 3: Write the implementation**

```js
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
 * never overwritten.
 */

import { readTextOrNull, writeTextAtomic } from './io.js';

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
  const raw = await readTextOrNull(file);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/themes.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/themes.js server/organize/themes.test.js
git commit -m "feat(organize): theme config with ordered glob matcher

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Survey pure helpers (`survey.js`, part 1)

**Files:**
- Create: `server/organize/survey.js`
- Test: `server/organize/survey.test.js`

**Interfaces:**
- Consumes: nothing yet.
- Produces (pure, all exported):
  - `OUTDATED_DIR = 'Outdated'`
  - `isIgnoredName(name: string): boolean` — dot-names and `OUTDATED_DIR`
  - `isEmptyListing(names: string[]): boolean` — nothing but `.DS_Store`
  - `detectStack(names: string[]): string[]` — from top-level entry names
  - `normalizeRemote(url: string|null): string|null` — `owner/repo` for GitHub
  - `parseDescription(readme: string|null, packageJson: string|null): string|null`

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/survey: pure helpers (part 1) and the real-fixture
 * survey (part 2, appended in Task 4).
 */
import { describe, it, expect } from 'vitest';
import {
  OUTDATED_DIR,
  isIgnoredName,
  isEmptyListing,
  detectStack,
  normalizeRemote,
  parseDescription,
} from './survey.js';

describe('isIgnoredName', () => {
  it('ignores dot-names and the Outdated folder', () => {
    expect(OUTDATED_DIR).toBe('Outdated');
    expect(isIgnoredName('.DS_Store')).toBe(true);
    expect(isIgnoredName('.git')).toBe(true);
    expect(isIgnoredName('Outdated')).toBe(true);
    expect(isIgnoredName('repo-atlas')).toBe(false);
    expect(isIgnoredName('BAT-Scanner 2.zip')).toBe(false);
  });
});

describe('isEmptyListing', () => {
  it('treats .DS_Store-only as empty', () => {
    expect(isEmptyListing([])).toBe(true);
    expect(isEmptyListing(['.DS_Store'])).toBe(true);
    expect(isEmptyListing(['.DS_Store', 'a.txt'])).toBe(false);
    expect(isEmptyListing(['node_modules'])).toBe(false);
  });
});

describe('detectStack', () => {
  it('maps top-level markers to stack names, sorted', () => {
    expect(detectStack(['package.json', 'index.html', 'CLAUDE.md'])).toEqual(['claude-md', 'html', 'node']);
    expect(detectStack(['pyproject.toml'])).toEqual(['python']);
    expect(detectStack(['requirements.txt'])).toEqual(['python']);
    expect(detectStack(['Cargo.toml', 'go.mod'])).toEqual(['go', 'rust']);
    expect(detectStack(['Package.swift'])).toEqual(['swift']);
    expect(detectStack(['App.xcodeproj'])).toEqual(['swift']);
    expect(detectStack(['default.project.json'])).toEqual(['roblox']);
    expect(detectStack(['rojo.json'])).toEqual(['roblox']);
    expect(detectStack(['pom.xml'])).toEqual(['java']);
    expect(detectStack(['build.gradle.kts'])).toEqual(['java']);
    expect(detectStack(['seeing-stars.als', 'Samples'])).toEqual(['ableton']);
    expect(detectStack(['README.md'])).toEqual([]);
  });
  it('never duplicates a stack name', () => {
    expect(detectStack(['pyproject.toml', 'requirements.txt'])).toEqual(['python']);
  });
});

describe('normalizeRemote', () => {
  it('reduces GitHub https and ssh URLs to owner/repo', () => {
    expect(normalizeRemote('https://github.com/trmnmc/repo-atlas.git')).toBe('trmnmc/repo-atlas');
    expect(normalizeRemote('https://github.com/trmnmc/repo-atlas')).toBe('trmnmc/repo-atlas');
    expect(normalizeRemote('git@github.com:trmnmc/SWARM.git')).toBe('trmnmc/SWARM');
    expect(normalizeRemote('ssh://git@github.com/trmnmc/moon.git')).toBe('trmnmc/moon');
  });
  it('passes other URLs through trimmed and returns null for null/empty', () => {
    expect(normalizeRemote('https://gitlab.com/a/b.git\n')).toBe('https://gitlab.com/a/b.git');
    expect(normalizeRemote(null)).toBeNull();
    expect(normalizeRemote('   ')).toBeNull();
  });
});

describe('parseDescription', () => {
  it('prefers the first README H1, stripped', () => {
    expect(parseDescription('# Repo Atlas\n\nA local mission-control.\n', '{"description":"x"}')).toBe('Repo Atlas');
    expect(parseDescription('Intro line\n\n# BaT Value Map — scraper\n', null)).toBe('BaT Value Map — scraper');
  });
  it('ignores H2 and falls back to package.json description', () => {
    expect(parseDescription('## Not a title\n', '{"description":"From package"}')).toBe('From package');
    expect(parseDescription(null, '{"description":"From package"}')).toBe('From package');
  });
  it('returns null when neither source has one, and survives bad JSON', () => {
    expect(parseDescription(null, null)).toBeNull();
    expect(parseDescription('no heading\n', '{ nope')).toBeNull();
    expect(parseDescription(null, '{"name":"x"}')).toBeNull();
  });
  it('collapses inner whitespace and caps at 120 characters', () => {
    expect(parseDescription('#   Two   words  \n', null)).toBe('Two words');
    const long = `# ${'x'.repeat(200)}\n`;
    expect(parseDescription(long, null)?.length).toBe(120);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/survey.test.js`
Expected: FAIL. `Cannot find module './survey.js'`.

- [ ] **Step 3: Write the pure half of the module**

```js
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
    const h1 = readme.split(/\r?\n/).find((line) => /^# \S/.test(line));
    if (h1) return tidy(h1.slice(2));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/survey.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/survey.js server/organize/survey.test.js
git commit -m "feat(organize): survey pure helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Survey of the root (`survey.js`, part 2)

**Files:**
- Modify: `server/organize/survey.js` (append below the part-1 helpers)
- Test: `server/organize/survey.test.js` (append a second suite)

**Interfaces:**
- Consumes: `PRUNED_DIRS`, `MAX_REPO_FILES` from `../loc.js`; `readTextOrNull` from `./io.js`; part-1 helpers.
- Produces:
  - `runGit(repoPath: string, args: string[], execFileFn?): Promise<string|null>`
  - `walkFiles(dir: string, { maxFiles? }): Promise<{ newestFileIso: string|null, fileCount: number, bytes: number }>`
  - `readDescription(dir: string): Promise<string|null>`
  - `gitLight(dir: string, execFileFn?): Promise<{ lastCommitIso, dirty, aheadBy, remote }>`
  - `projectFacts(dir: string, { execFileFn?, maxFiles? }): Promise<ProjectFacts>`
  - `listOutdated(outdatedDir: string): Promise<Record<string, string[]>>`
  - `surveyProjects(root: string, { execFileFn?, maxFiles?, concurrency? }): Promise<SurveyResult>`

- [ ] **Step 1: Append the failing fixture suite to `survey.test.js`**

Add these imports at the top of the file (merge with the existing import lines):

```js
import { beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkFiles, projectFacts, listOutdated, surveyProjects } from './survey.js';
```

Append this suite at the end of the file:

```js
/* ------------------------------------------------------------------ */
/* Part 2: real fixture root                                            */
/* ------------------------------------------------------------------ */

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: 'Ada Surveyor',
  GIT_AUTHOR_EMAIL: 'ada@example.test',
  GIT_COMMITTER_NAME: 'Ada Surveyor',
  GIT_COMMITTER_EMAIL: 'ada@example.test',
};
function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-C', cwd, ...args], { env: { ...GIT_ENV, ...extraEnv }, encoding: 'utf8' });
}
function commitAll(cwd, message, iso) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message, '--date', iso], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
}
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function touch(file, iso) {
  const d = new Date(iso);
  fs.utimesSync(file, d, d);
}

const ALPHA_ISO = '2026-06-05T09:00:00-05:00';
const BETA_ISO = '2026-07-10T12:00:00-05:00';
const ONE_ISO = '2026-08-01T10:00:00-05:00';
const JUNK_ISO = '2026-09-15T10:00:00-05:00';

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-survey-'));

  // alpha: git, one commit, README + package.json, clean, no remote
  const alpha = path.join(root, 'alpha');
  fs.mkdirSync(alpha);
  git(alpha, ['init', '-q', '-b', 'main']);
  write(alpha, 'README.md', '# Alpha Project\n\nwords\n');
  write(alpha, 'package.json', '{"name":"alpha","description":"pkg desc"}\n');
  commitAll(alpha, 'first', ALPHA_ISO);

  // beta: cloned from a bare origin (kept under a dot-dir so it is ignored),
  // one commit ahead, one untracked file, remote URL rewritten to GitHub
  const origins = path.join(root, '.origins');
  fs.mkdirSync(origins);
  const bare = path.join(origins, 'beta.git');
  git(root, ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = path.join(origins, 'seed');
  git(root, ['clone', '-q', bare, seed]);
  write(seed, 'a.txt', 'a\n');
  commitAll(seed, 'seed', ALPHA_ISO);
  git(seed, ['push', '-q', 'origin', 'HEAD:main']);
  const beta = path.join(root, 'beta');
  git(root, ['clone', '-q', bare, beta]);
  write(beta, 'b.txt', 'b\n');
  commitAll(beta, 'ahead', BETA_ISO);
  write(beta, 'untracked.txt', 'u\n');
  git(beta, ['remote', 'set-url', 'origin', 'https://github.com/example/beta.git']);

  // gamma: plain folder; node_modules is pruned; .DS_Store ignored
  const gamma = path.join(root, 'gamma');
  write(gamma, 'notes/one.txt', 'hello\n');
  write(gamma, 'node_modules/junk.js', 'x'.repeat(500));
  write(gamma, '.DS_Store', '');
  touch(path.join(gamma, 'notes/one.txt'), ONE_ISO);
  touch(path.join(gamma, 'node_modules/junk.js'), JUNK_ISO);

  // empty: only .DS_Store
  const empty = path.join(root, 'empty');
  write(empty, '.DS_Store', '');

  // Outdated convention + a loose file + an ignored dot-file
  fs.mkdirSync(path.join(root, 'Outdated', 'archived-projects', 'old-one'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Outdated', 'empties'), { recursive: true });
  write(root, 'Outdated/MOVES.log', '');
  write(root, 'snapshot.zip', 'zip');
  write(root, '.hidden', '');

  // capdir: five files, used to prove the cap
  const cap = path.join(root, 'capdir');
  for (let i = 0; i < 5; i += 1) write(cap, `f${i}.txt`, 'x');
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('walkFiles', () => {
  it('finds the newest regular file, skipping pruned dirs and .DS_Store', async () => {
    const r = await walkFiles(path.join(root, 'gamma'));
    expect(Date.parse(r.newestFileIso)).toBe(Date.parse(ONE_ISO));
    expect(r.fileCount).toBe(1);
    expect(r.bytes).toBe(6);
  });
  it('respects the file cap', async () => {
    const r = await walkFiles(path.join(root, 'capdir'), { maxFiles: 3 });
    expect(r.fileCount).toBe(3);
  });
  it('returns nulls and zeros for a missing directory', async () => {
    expect(await walkFiles(path.join(root, 'nope'))).toEqual({ newestFileIso: null, fileCount: 0, bytes: 0 });
  });
});

describe('projectFacts', () => {
  it('reads a clean git repo with no remote', async () => {
    const f = await projectFacts(path.join(root, 'alpha'));
    expect(f.kind).toBe('git');
    expect(f.readable).toBe(true);
    expect(Date.parse(f.lastCommitIso)).toBe(Date.parse(ALPHA_ISO));
    expect(f.dirty).toBe(false);
    expect(f.aheadBy).toBe(0);
    expect(f.remote).toBeNull();
    expect(f.stack).toEqual(['node']);
    expect(f.description).toBe('Alpha Project');
    expect(f.empty).toBe(false);
    expect(f.fileCount).toBeGreaterThan(0);
  });
  it('reads a dirty, ahead repo with a GitHub remote', async () => {
    const f = await projectFacts(path.join(root, 'beta'));
    expect(f.kind).toBe('git');
    expect(f.dirty).toBe(true);
    expect(f.aheadBy).toBe(1);
    expect(f.remote).toBe('example/beta');
    expect(Date.parse(f.lastCommitIso)).toBe(Date.parse(BETA_ISO));
  });
  it('reads a plain folder', async () => {
    const f = await projectFacts(path.join(root, 'gamma'));
    expect(f.kind).toBe('folder');
    expect(f.lastCommitIso).toBeNull();
    expect(f.dirty).toBe(false);
    expect(f.remote).toBeNull();
    expect(Date.parse(f.newestFileIso)).toBe(Date.parse(ONE_ISO));
    expect(f.stack).toEqual([]);
    expect(f.description).toBeNull();
  });
  it('flags an empty folder', async () => {
    const f = await projectFacts(path.join(root, 'empty'));
    expect(f.empty).toBe(true);
    expect(f.newestFileIso).toBeNull();
  });
  it('degrades a missing path to readable:false', async () => {
    const f = await projectFacts(path.join(root, 'ghost'));
    expect(f).toMatchObject({ name: 'ghost', kind: 'folder', readable: false, lastCommitIso: null, fileCount: 0, stack: [] });
  });
});

describe('listOutdated', () => {
  it('lists entries per subfolder, skipping files and dot-names', async () => {
    expect(await listOutdated(path.join(root, 'Outdated'))).toEqual({
      'archived-projects': ['old-one'],
      empties: [],
    });
  });
  it('returns {} when Outdated is missing', async () => {
    expect(await listOutdated(path.join(root, 'nope'))).toEqual({});
  });
});

describe('surveyProjects', () => {
  it('returns projects sorted by name, loose files, and the Outdated listing', async () => {
    const s = await surveyProjects(root);
    expect(s.projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'capdir', 'empty', 'gamma']);
    expect(s.looseFiles).toEqual(['snapshot.zip']);
    expect(s.outdated['archived-projects']).toEqual(['old-one']);
    expect(s.projects.every((p) => p.path.startsWith(root))).toBe(true);
  });
  it('throws when the root does not exist', async () => {
    await expect(surveyProjects(path.join(root, 'missing-root'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new suite fails**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/survey.test.js`
Expected: FAIL. Part-1 tests pass; part-2 fails with `does not provide an export named 'walkFiles'`.

- [ ] **Step 3: Append the IO half to `survey.js`**

Add these imports at the top of `survey.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PRUNED_DIRS, MAX_REPO_FILES } from '../loc.js';
import { readTextOrNull } from './io.js';

const execFileP = promisify(execFile);
```

Append below the part-1 helpers:

```js
/* ------------------------------------------------------------------ */
/* Part 2: disk and git                                                */
/* ------------------------------------------------------------------ */

/** @typedef {Object} ProjectFacts
 * @property {string} name
 * @property {string} path
 * @property {'git'|'folder'} kind
 * @property {boolean} readable
 * @property {string|null} lastCommitIso
 * @property {boolean} dirty
 * @property {number} aheadBy
 * @property {string|null} remote
 * @property {string|null} newestFileIso
 * @property {number} fileCount
 * @property {number} bytes
 * @property {boolean} empty
 * @property {string[]} stack
 * @property {string|null} description
 */
/** @typedef {{ projects: ProjectFacts[], looseFiles: string[], outdated: Record<string, string[]> }} SurveyResult */

/** Default bounded-pool width for per-project facts. */
const DEFAULT_CONCURRENCY = 4;

/** @param {{ name: string }} a @param {{ name: string }} b */
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Run git read-only against a repo. Returns stdout, or null on ANY failure.
 * Same shape as gitFacts.js tryGit; duplicated because gitFacts.js is not
 * edited by this feature.
 * @param {string} repoPath
 * @param {string[]} args
 * @param {typeof execFileP} [execFileFn] injectable for tests
 * @returns {Promise<string|null>}
 */
export async function runGit(repoPath, args, execFileFn = execFileP) {
  try {
    const { stdout } = await execFileFn(
      'git',
      ['-C', repoPath, '-c', 'core.quotepath=false', ...args],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Newest regular-file mtime, file count, and byte total under `dir`, with
 * loc.js pruning, a file cap, no symlink following, and .DS_Store ignored.
 * Never throws.
 * @param {string} dir
 * @param {{ maxFiles?: number }} [opts]
 * @returns {Promise<{ newestFileIso: string|null, fileCount: number, bytes: number }>}
 */
export async function walkFiles(dir, opts = {}) {
  const maxFiles = opts.maxFiles ?? MAX_REPO_FILES;
  /** @type {number|null} */
  let newestMs = null;
  let fileCount = 0;
  let bytes = 0;

  /** @param {string} d */
  async function visit(d) {
    if (fileCount >= maxFiles) return;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort(byName);
    for (const entry of entries) {
      if (fileCount >= maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (PRUNED_DIRS.has(entry.name)) continue;
        await visit(full);
      } else if (entry.isFile()) {
        if (entry.name === '.DS_Store') continue;
        try {
          const st = await fs.stat(full);
          fileCount += 1;
          bytes += st.size;
          if (newestMs === null || st.mtimeMs > newestMs) newestMs = st.mtimeMs;
        } catch {
          // unreadable file contributes nothing
        }
      }
    }
  }

  await visit(path.resolve(dir));
  return {
    newestFileIso: newestMs === null ? null : new Date(newestMs).toISOString(),
    fileCount,
    bytes,
  };
}

/**
 * @param {string} dir
 * @returns {Promise<string|null>}
 */
export async function readDescription(dir) {
  const [readme, pkg] = await Promise.all([
    readTextOrNull(path.join(dir, 'README.md')),
    readTextOrNull(path.join(dir, 'package.json')),
  ]);
  return parseDescription(readme, pkg);
}

/**
 * Four light read-only git calls. Any failure degrades that one fact.
 * @param {string} dir
 * @param {typeof execFileP} [execFileFn]
 * @returns {Promise<{ lastCommitIso: string|null, dirty: boolean, aheadBy: number, remote: string|null }>}
 */
export async function gitLight(dir, execFileFn) {
  const [log, status, ahead, remote] = await Promise.all([
    runGit(dir, ['log', '-1', '--format=%aI'], execFileFn),
    runGit(dir, ['status', '--porcelain'], execFileFn),
    runGit(dir, ['rev-list', '--count', '@{u}..HEAD'], execFileFn),
    runGit(dir, ['remote', 'get-url', 'origin'], execFileFn),
  ]);
  const lastCommitIso = log === null || log.trim() === '' ? null : log.trim();
  const dirty = status !== null && status.trim().length > 0;
  const n = ahead === null ? NaN : Number.parseInt(ahead.trim(), 10);
  return {
    lastCommitIso,
    dirty,
    aheadBy: Number.isFinite(n) && n > 0 ? n : 0,
    remote: normalizeRemote(remote),
  };
}

/**
 * @param {string} name
 * @param {string} dir
 * @returns {ProjectFacts} the readable:false shape
 */
function unreadableFacts(name, dir) {
  return {
    name, path: dir, kind: 'folder', readable: false,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 0, bytes: 0, empty: false, stack: [], description: null,
  };
}

/**
 * @param {string} dir absolute project directory
 * @param {{ execFileFn?: typeof execFileP, maxFiles?: number }} [opts]
 * @returns {Promise<ProjectFacts>}
 */
export async function projectFacts(dir, opts = {}) {
  const name = path.basename(dir);
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return unreadableFacts(name, dir);
  }
  const names = entries.map((e) => e.name);
  const kind = names.includes('.git') ? 'git' : 'folder';
  const [walk, description, git] = await Promise.all([
    walkFiles(dir, { maxFiles: opts.maxFiles }),
    readDescription(dir),
    kind === 'git'
      ? gitLight(dir, opts.execFileFn)
      : Promise.resolve({ lastCommitIso: null, dirty: false, aheadBy: 0, remote: null }),
  ]);
  return {
    name,
    path: dir,
    kind,
    readable: true,
    ...git,
    ...walk,
    empty: isEmptyListing(names),
    stack: detectStack(names),
    description,
  };
}

/**
 * Entry names inside each subfolder of Outdated/, dot-names dropped.
 * Files directly inside Outdated/ (MOVES.log) are not subfolders and are
 * skipped. Missing Outdated/ → {}.
 * @param {string} outdatedDir
 * @returns {Promise<Record<string, string[]>>}
 */
export async function listOutdated(outdatedDir) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(outdatedDir, { withFileTypes: true });
  } catch {
    return {};
  }
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const entry of entries.sort(byName)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const names = await fs.readdir(path.join(outdatedDir, entry.name));
      out[entry.name] = names.filter((n) => !n.startsWith('.')).sort();
    } catch {
      out[entry.name] = [];
    }
  }
  return out;
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Keeps order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function boundedMap(items, limit, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

/**
 * Survey the top level of `root`. Throws only when `root` itself cannot be
 * read; every per-project failure degrades inside projectFacts. Symlinked
 * top-level entries are not directories to readdir and land in looseFiles.
 * @param {string} root
 * @param {{ execFileFn?: typeof execFileP, maxFiles?: number, concurrency?: number }} [opts]
 * @returns {Promise<SurveyResult>}
 */
export async function surveyProjects(root, opts = {}) {
  const rootAbs = path.resolve(root);
  const entries = (await fs.readdir(rootAbs, { withFileTypes: true })).sort(byName);
  /** @type {string[]} */
  const projectDirs = [];
  /** @type {string[]} */
  const looseFiles = [];
  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    if (entry.isDirectory()) projectDirs.push(path.join(rootAbs, entry.name));
    else looseFiles.push(entry.name);
  }
  const projects = await boundedMap(projectDirs, opts.concurrency ?? DEFAULT_CONCURRENCY, (d) =>
    projectFacts(d, opts),
  );
  const outdated = await listOutdated(path.join(rootAbs, OUTDATED_DIR));
  return { projects, looseFiles, outdated };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/survey.test.js`
Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/survey.js server/organize/survey.test.js
git commit -m "feat(organize): survey the projects root with light git facts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Classify (`classify.js`)

**Files:**
- Create: `server/organize/classify.js`
- Test: `server/organize/classify.test.js`

**Interfaces:**
- Consumes: `isStale`, `STALE_DAYS` from `../../shared/contract.js`; `matchTheme`, `UNSORTED` from `./themes.js`; `ProjectFacts`, `SurveyResult` shapes from Task 4.
- Produces:
  - `STATUSES = ['active','paused','stale','empty','unknown']`
  - `activityIso(facts: ProjectFacts): string|null`
  - `olderThanDays(iso: string, nowIso: string, days: number): boolean`
  - `statusOf(facts, config, nowIso, staleDays?): Status`
  - `findDuplicates(records: ProjectRecord[]): DuplicateNotice[]`
  - `classify(survey: SurveyResult, config, nowIso, { staleDays? }): { records: ProjectRecord[], notices: Notices }`
  - `summarize(records): { total: number, byStatus: Record<Status, number>, byTheme: Record<string, number> }`

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/classify: activity date, status rule, duplicates,
 * summary. Pure; every date is a literal; nowIso is always passed.
 */
import { describe, it, expect } from 'vitest';
import { isStale, STALE_DAYS } from '../../shared/contract.js';
import { defaultConfig } from './themes.js';
import {
  STATUSES,
  activityIso,
  olderThanDays,
  statusOf,
  findDuplicates,
  classify,
  summarize,
} from './classify.js';

const NOW = '2026-09-21T12:00:00-05:00';
const RECENT = '2026-09-01T12:00:00-05:00';   // 20 days ago
const OLD = '2026-05-01T12:00:00-05:00';      // 143 days ago
const EXACT_90 = '2026-06-23T12:00:00-05:00'; // exactly 90 days before NOW
const JUST_OVER = '2026-06-23T11:59:59.999-05:00';

/** @returns {import('./survey.js').ProjectFacts} */
function facts(over = {}) {
  return {
    name: 'proj', path: '/tmp/root/proj', kind: 'folder', readable: true,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 3, bytes: 300, empty: false, stack: [], description: null,
    ...over,
  };
}
const config = () => defaultConfig();

describe('activityIso', () => {
  it('takes the later of commit and file time', () => {
    expect(activityIso(facts({ lastCommitIso: OLD, newestFileIso: RECENT }))).toBe(RECENT);
    expect(activityIso(facts({ lastCommitIso: RECENT, newestFileIso: OLD }))).toBe(RECENT);
  });
  it('uses whichever exists, or null', () => {
    expect(activityIso(facts({ lastCommitIso: OLD }))).toBe(OLD);
    expect(activityIso(facts({ newestFileIso: OLD }))).toBe(OLD);
    expect(activityIso(facts())).toBeNull();
  });
});

describe('olderThanDays', () => {
  it('is strict: exactly N days is not older', () => {
    expect(olderThanDays(EXACT_90, NOW, 90)).toBe(false);
    expect(olderThanDays(JUST_OVER, NOW, 90)).toBe(true);
    expect(olderThanDays(RECENT, NOW, 90)).toBe(false);
    expect(olderThanDays(OLD, NOW, 90)).toBe(true);
  });
  it('agrees with the contract isStale at STALE_DAYS', () => {
    for (const iso of [EXACT_90, JUST_OVER, RECENT, OLD]) {
      expect(olderThanDays(iso, NOW, STALE_DAYS)).toBe(isStale(iso, NOW));
    }
  });
  it('honors a custom threshold', () => {
    expect(olderThanDays(RECENT, NOW, 10)).toBe(true);
    expect(olderThanDays(RECENT, NOW, 30)).toBe(false);
  });
});

describe('statusOf', () => {
  it('active by commit, active by file time only', () => {
    expect(statusOf(facts({ kind: 'git', lastCommitIso: RECENT }), config(), NOW)).toBe('active');
    expect(statusOf(facts({ kind: 'git', lastCommitIso: OLD, newestFileIso: RECENT }), config(), NOW)).toBe('active');
  });
  it('stale, and paused when the config says keep', () => {
    expect(statusOf(facts({ lastCommitIso: OLD }), config(), NOW)).toBe('stale');
    const c = config();
    c.paused.proj = '2026-09-01';
    expect(statusOf(facts({ lastCommitIso: OLD }), c, NOW)).toBe('paused');
  });
  it('a paused project that becomes active is active', () => {
    const c = config();
    c.paused.proj = '2026-09-01';
    expect(statusOf(facts({ newestFileIso: RECENT }), c, NOW)).toBe('active');
  });
  it('empty beats everything but unreadable, and a kept empty folder is paused', () => {
    expect(statusOf(facts({ empty: true }), config(), NOW)).toBe('empty');
    expect(statusOf(facts({ empty: true, readable: false }), config(), NOW)).toBe('unknown');
    const c = config();
    c.paused.proj = '2026-09-01';
    expect(statusOf(facts({ empty: true }), c, NOW)).toBe('paused');
  });
  it('unknown when no signal or unreadable', () => {
    expect(statusOf(facts(), config(), NOW)).toBe('unknown');
    expect(statusOf(facts({ readable: false }), config(), NOW)).toBe('unknown');
  });
  it('exactly 90 days is still active; custom threshold applies', () => {
    expect(statusOf(facts({ newestFileIso: EXACT_90 }), config(), NOW)).toBe('active');
    expect(statusOf(facts({ newestFileIso: RECENT }), config(), NOW, 10)).toBe('stale');
  });
  it('STATUSES lists all five', () => {
    expect(STATUSES).toEqual(['active', 'paused', 'stale', 'empty', 'unknown']);
  });
});

describe('findDuplicates', () => {
  const rec = (name, over = {}) => ({ ...facts({ name, path: `/tmp/root/${name}`, ...over }), theme: 'x', status: 'active', activityIso: null });
  it('groups git projects by normalized remote', () => {
    const d = findDuplicates([
      rec('BAT-Scanner', { kind: 'git', remote: 'trmnmc/BAT-Scanner' }),
      rec('BAT-Scanner 2', { kind: 'git', remote: 'trmnmc/bat-scanner' }),
      rec('other', { kind: 'git', remote: 'trmnmc/other' }),
    ]);
    expect(d).toContainEqual({ reason: 'remote', key: 'trmnmc/bat-scanner', names: ['BAT-Scanner', 'BAT-Scanner 2'] });
  });
  it('pairs suffix names with an existing base', () => {
    const d = findDuplicates([rec('SurLeLac'), rec('SurLeLacv2'), rec('lofts-willow-selection'), rec('lofts-willow-selection-2'), rec('alpaca-v2'), rec('tstack2')]);
    expect(d).toContainEqual({ reason: 'name', key: 'SurLeLac', names: ['SurLeLac', 'SurLeLacv2'] });
    expect(d).toContainEqual({ reason: 'name', key: 'lofts-willow-selection', names: ['lofts-willow-selection', 'lofts-willow-selection-2'] });
    expect(d.some((n) => n.names.includes('alpaca-v2'))).toBe(false);
    expect(d.some((n) => n.names.includes('tstack2'))).toBe(false);
  });
  it('returns [] when nothing repeats', () => {
    expect(findDuplicates([rec('a'), rec('b')])).toEqual([]);
  });
});

describe('classify + summarize', () => {
  it('builds records and notices from a survey', () => {
    const survey = {
      projects: [
        facts({ name: 'minecraft-plugins', kind: 'git', lastCommitIso: RECENT }),
        facts({ name: 'alpaca-v2', kind: 'git', lastCommitIso: OLD }),
        facts({ name: 'FUN', empty: true }),
        facts({ name: 'random', newestFileIso: RECENT }),
        facts({ name: 'ghost', readable: false }),
      ],
      looseFiles: ['snapshot.zip'],
      outdated: {},
    };
    const { records, notices } = classify(survey, config(), NOW);
    const byName = Object.fromEntries(records.map((r) => [r.name, r]));
    expect(byName['minecraft-plugins']).toMatchObject({ theme: 'minecraft', status: 'active', activityIso: RECENT });
    expect(byName['alpaca-v2']).toMatchObject({ theme: 'finance', status: 'stale' });
    expect(byName.FUN).toMatchObject({ status: 'empty' });
    expect(byName.random).toMatchObject({ theme: 'unsorted', status: 'active' });
    expect(byName.ghost).toMatchObject({ status: 'unknown' });
    expect(notices.candidates.map((r) => r.name)).toEqual(['alpaca-v2']);
    expect(notices.empties.map((r) => r.name)).toEqual(['FUN']);
    expect(notices.unsorted.map((r) => r.name).sort()).toEqual(['FUN', 'ghost', 'random']);
    expect(notices.looseFiles).toEqual(['snapshot.zip']);
    expect(notices.duplicates).toEqual([]);

    const s = summarize(records);
    expect(s.total).toBe(5);
    expect(s.byStatus).toEqual({ active: 2, paused: 0, stale: 1, empty: 1, unknown: 1 });
    expect(s.byTheme).toEqual({ minecraft: 1, finance: 1, unsorted: 3 });
  });
  it('passes staleDays through', () => {
    const survey = { projects: [facts({ name: 'p', newestFileIso: RECENT })], looseFiles: [], outdated: {} };
    expect(classify(survey, config(), NOW, { staleDays: 10 }).records[0].status).toBe('stale');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/classify.test.js`
Expected: FAIL. `Cannot find module './classify.js'`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Repo Atlas — organize: classification (pure).
 *
 * activity date = later of last commit and newest file time. Status:
 *   unreadable → unknown; empty → paused if kept else empty; no signal → unknown;
 *   not older than staleDays → active; older and in config.paused → paused;
 *   older → stale.
 * Staleness is STRICT (exactly N days is not stale), matching the contract's
 * isStale, which is used verbatim whenever staleDays === STALE_DAYS.
 * Duplicates are report-only: same normalized remote, or a `<base> 2`-style
 * name whose base also exists.
 */

import { isStale, STALE_DAYS } from '../../shared/contract.js';
import { matchTheme, UNSORTED } from './themes.js';

/** @typedef {import('./survey.js').ProjectFacts} ProjectFacts */
/** @typedef {import('./survey.js').SurveyResult} SurveyResult */
/** @typedef {import('./themes.js').OrganizeConfig} OrganizeConfig */
/** @typedef {'active'|'paused'|'stale'|'empty'|'unknown'} Status */
/** @typedef {ProjectFacts & { theme: string, status: Status, activityIso: string|null }} ProjectRecord */
/** @typedef {{ names: string[], reason: 'remote'|'name', key: string }} DuplicateNotice */
/** @typedef {{ candidates: ProjectRecord[], empties: ProjectRecord[], unsorted: ProjectRecord[], duplicates: DuplicateNotice[], looseFiles: string[] }} Notices */

/** @type {readonly Status[]} */
export const STATUSES = Object.freeze(['active', 'paused', 'stale', 'empty', 'unknown']);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {ProjectFacts} facts
 * @returns {string|null}
 */
export function activityIso(facts) {
  const a = facts.lastCommitIso;
  const b = facts.newestFileIso;
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * @param {string} iso
 * @param {string} nowIso
 * @param {number} days
 * @returns {boolean} true when iso is STRICTLY more than `days` before nowIso
 */
export function olderThanDays(iso, nowIso, days) {
  if (days === STALE_DAYS) return isStale(iso, nowIso);
  return Date.parse(nowIso) - Date.parse(iso) > days * MS_PER_DAY;
}

/**
 * @param {ProjectFacts} facts
 * @param {OrganizeConfig} config
 * @param {string} nowIso
 * @param {number} [staleDays]
 * @returns {Status}
 */
export function statusOf(facts, config, nowIso, staleDays = STALE_DAYS) {
  if (!facts.readable) return 'unknown';
  const paused = Object.prototype.hasOwnProperty.call(config.paused, facts.name);
  if (facts.empty) return paused ? 'paused' : 'empty';
  const act = activityIso(facts);
  if (act === null) return 'unknown';
  if (!olderThanDays(act, nowIso, staleDays)) return 'active';
  return paused ? 'paused' : 'stale';
}

/** `<base> 2`, `<base>-2`, `<base>v2`, `<base>-v3`, `<base> copy` */
const SUFFIX_RE = /^(.+?)(?:[ _-]?2|[ _-]?v\d+|[ _-]copy)$/i;

/**
 * @param {ProjectRecord[]} records
 * @returns {DuplicateNotice[]}
 */
export function findDuplicates(records) {
  /** @type {DuplicateNotice[]} */
  const out = [];

  /** @type {Map<string, string[]>} */
  const byRemote = new Map();
  for (const r of records) {
    if (r.kind !== 'git' || r.remote === null) continue;
    const key = r.remote.toLowerCase();
    const list = byRemote.get(key) ?? [];
    list.push(r.name);
    byRemote.set(key, list);
  }
  for (const [key, names] of byRemote) {
    if (names.length > 1) out.push({ reason: 'remote', key, names: names.slice().sort() });
  }

  const byLower = new Map(records.map((r) => [r.name.toLowerCase(), r.name]));
  for (const r of records) {
    const m = r.name.match(SUFFIX_RE);
    if (!m) continue;
    const base = byLower.get(m[1].toLowerCase());
    if (base !== undefined && base !== r.name) {
      out.push({ reason: 'name', key: base, names: [base, r.name] });
    }
  }
  return out;
}

/**
 * @param {SurveyResult} survey
 * @param {OrganizeConfig} config
 * @param {string} nowIso
 * @param {{ staleDays?: number }} [opts]
 * @returns {{ records: ProjectRecord[], notices: Notices }}
 */
export function classify(survey, config, nowIso, opts = {}) {
  const staleDays = opts.staleDays ?? STALE_DAYS;
  const records = survey.projects.map((f) => ({
    ...f,
    theme: matchTheme(f.name, config),
    status: statusOf(f, config, nowIso, staleDays),
    activityIso: activityIso(f),
  }));
  return {
    records,
    notices: {
      candidates: records.filter((r) => r.status === 'stale'),
      empties: records.filter((r) => r.status === 'empty'),
      unsorted: records.filter((r) => r.theme === UNSORTED),
      duplicates: findDuplicates(records),
      looseFiles: survey.looseFiles.slice(),
    },
  };
}

/**
 * @param {ProjectRecord[]} records
 * @returns {{ total: number, byStatus: Record<Status, number>, byTheme: Record<string, number> }}
 */
export function summarize(records) {
  /** @type {Record<Status, number>} */
  const byStatus = /** @type {any} */ (Object.fromEntries(STATUSES.map((s) => [s, 0])));
  /** @type {Record<string, number>} */
  const byTheme = {};
  for (const r of records) {
    byStatus[r.status] += 1;
    byTheme[r.theme] = (byTheme[r.theme] ?? 0) + 1;
  }
  return { total: records.length, byStatus, byTheme };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/classify.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/classify.js server/organize/classify.test.js
git commit -m "feat(organize): classify status, theme, and duplicate notices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Render `PROJECTS.md` and the `CLAUDE.md` block (`render.js`, part 1)

**Files:**
- Create: `server/organize/render.js`
- Test: `server/organize/render.test.js`

**Interfaces:**
- Consumes: `dayKey` from `../../shared/contract.js`; `UNSORTED`, `themeNames` from `./themes.js`; `summarize` from `./classify.js`; `ProjectRecord`, `Notices` shapes.
- Produces:
  - `MARK_BEGIN` (full begin-marker line), `MARK_END = '<!-- atlas:end -->'`
  - `fmtDay(iso: string|null): string` — `YYYY-MM-DD` local or `unknown`
  - `fmtBytes(bytes: number): string` — `0 B`, `12 KB`, `1.2 MB`, `7.2 GB`
  - `groupByTheme(records, config): Array<{ theme: string, records: ProjectRecord[] }>` — config order, `unsorted` last, only non-empty groups, records sorted by name (case-insensitive)
  - `renderProjectsMd({ records, notices, outdated, config, nowIso }): string`
  - `renderClaudeBlock({ records, config }): string`
  - `spliceClaudeMd(existing: string|null, block: string): string`

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/render: PROJECTS.md, CLAUDE.md block + splice.
 * String assertions on a small fixture. Pure; nowIso is a literal.
 */
import { describe, it, expect } from 'vitest';
import { defaultConfig } from './themes.js';
import {
  MARK_BEGIN,
  MARK_END,
  fmtDay,
  fmtBytes,
  groupByTheme,
  renderProjectsMd,
  renderClaudeBlock,
  spliceClaudeMd,
} from './render.js';

const NOW = '2026-09-21T12:00:00-05:00';

function rec(name, over = {}) {
  return {
    name, path: `/tmp/root/${name}`, kind: 'git', readable: true,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 1, bytes: 10, empty: false, stack: [], description: null,
    theme: 'unsorted', status: 'active', activityIso: null,
    ...over,
  };
}

const records = [
  rec('minecraft-plugins', { theme: 'minecraft', stack: ['java'], activityIso: '2026-09-01T12:00:00-05:00', description: 'Plugins' }),
  rec('alpaca-v2', { theme: 'finance', status: 'stale', remote: 'trmnmc/alpaca-v2', stack: ['claude-md', 'node'], activityIso: '2026-06-10T12:00:00-05:00', description: 'Alpaca | Command Center' }),
  rec('random', { theme: 'unsorted', kind: 'folder', activityIso: '2026-08-01T12:00:00-05:00' }),
  rec('FUN', { theme: 'unsorted', kind: 'folder', status: 'empty' }),
];
const notices = { candidates: [records[1]], empties: [records[3]], unsorted: [records[2], records[3]], duplicates: [], looseFiles: ['snapshot.zip', 'ssh-key'] };
const outdated = { 'archived-projects': ['old-one'], empties: [], zips: ['a.zip'] };

describe('fmtDay / fmtBytes', () => {
  it('formats local day and unknown', () => {
    expect(fmtDay('2026-09-01T12:00:00-05:00')).toBe('2026-09-01');
    expect(fmtDay('2026-01-02T03:30:00Z')).toBe('2026-01-01'); // America/Chicago
    expect(fmtDay(null)).toBe('unknown');
  });
  it('formats bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(12 * 1024)).toBe('12 KB');
    expect(fmtBytes(1.2 * 1024 * 1024)).toBe('1.2 MB');
    expect(fmtBytes(7.2 * 1024 ** 3)).toBe('7.2 GB');
  });
});

describe('groupByTheme', () => {
  it('follows config order, unsorted last, sorted by name inside, drops empty groups', () => {
    const groups = groupByTheme(records, defaultConfig());
    expect(groups.map((g) => g.theme)).toEqual(['minecraft', 'finance', 'unsorted']);
    expect(groups[2].records.map((r) => r.name)).toEqual(['FUN', 'random']);
  });
});

describe('renderProjectsMd', () => {
  const md = renderProjectsMd({ records, notices, outdated, config: defaultConfig(), nowIso: NOW });
  it('has the header, the do-not-edit line, and the summary', () => {
    expect(md.startsWith('# Projects\n')).toBe(true);
    expect(md).toContain('Generated 2026-09-21 by `npm run organize` (repo-atlas). Do not edit. Edit projects.json.');
    expect(md).toContain('Summary: 4 projects · 2 active · 0 paused · 1 stale · 1 empty · 0 unknown · 2 unsorted');
  });
  it('renders one section per non-empty theme with the table header', () => {
    expect(md).toContain('## minecraft (1)\n\n| Name | Kind | Status | Stack | Remote | Last activity | Description |\n|---|---|---|---|---|---|---|\n');
    expect(md).toContain('## finance (1)');
    expect(md).toContain('## unsorted (2)');
    expect(md).not.toContain('## roblox');
  });
  it('renders rows with escaped pipes, em dash for no remote, and unknown dates', () => {
    expect(md).toContain('| minecraft-plugins | git | active | java | — | 2026-09-01 | Plugins |');
    expect(md).toContain('| alpaca-v2 | git | stale | claude-md, node | trmnmc/alpaca-v2 | 2026-06-10 | Alpaca \\| Command Center |');
    expect(md).toContain('| FUN | folder | empty | — | — | unknown |  |');
  });
  it('lists Outdated subfolders and loose files, never truncating', () => {
    expect(md).toContain('## Outdated\n\n### archived-projects (1)\n\n- old-one\n');
    expect(md).toContain('### empties (0)\n\n_(none)_\n');
    expect(md).toContain('### zips (1)\n\n- a.zip\n');
    expect(md).toContain('## Loose files at the root\n\n- snapshot.zip\n- ssh-key\n');
  });
  it('says so when Outdated is missing', () => {
    const md2 = renderProjectsMd({ records, notices, outdated: {}, config: defaultConfig(), nowIso: NOW });
    expect(md2).toContain('## Outdated\n\n_(no Outdated folder yet)_\n');
  });
});

describe('renderClaudeBlock / spliceClaudeMd', () => {
  const block = renderClaudeBlock({ records, config: defaultConfig() });
  it('is wrapped in the markers and stays short', () => {
    expect(block.startsWith(MARK_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(MARK_END)).toBe(true);
    expect(block.split('\n').length).toBeLessThanOrEqual(22);
  });
  it('names the map, theme counts, archive convention, and agent rules', () => {
    expect(block).toContain('PROJECTS.md');
    expect(block).toContain('Themes: minecraft (1) · finance (1) · unsorted (2)');
    expect(block).toContain('Outdated/archived-projects/');
    expect(block).toContain('Outdated/MOVES.log');
    expect(block).toContain('Do not create files at the root of ~/Projects.');
    expect(block).toContain('Do not move, rename, or delete project folders.');
  });
  it('splices: missing file → block only', () => {
    expect(spliceClaudeMd(null, block)).toBe(block);
  });
  it('splices: no markers → appended after a blank line', () => {
    const out = spliceClaudeMd('# Mine\n\nkeep me\n', block);
    expect(out.startsWith('# Mine\n\nkeep me\n\n')).toBe(true);
    expect(out.endsWith(block)).toBe(true);
  });
  it('splices: markers present → replaced in place, outside text kept', () => {
    const old = `# Mine\n\n${MARK_BEGIN}\nold stuff\n${MARK_END}\n\ntail note\n`;
    const out = spliceClaudeMd(old, block);
    expect(out).toContain('# Mine\n\n');
    expect(out).toContain('tail note\n');
    expect(out).not.toContain('old stuff');
    expect(out.split(MARK_END).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/render.test.js`
Expected: FAIL. `Cannot find module './render.js'`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Repo Atlas — organize: renderers (pure).
 *
 * renderProjectsMd → the complete map, grouped by theme in config order with
 * `unsorted` last, then Outdated/ contents, then loose files. It never
 * truncates. renderClaudeBlock → the short agent-facing block between two
 * marker comments; spliceClaudeMd puts it into an existing CLAUDE.md
 * without touching the user's own lines. Part 2 (Task 7) adds the console
 * report.
 */

import { dayKey } from '../../shared/contract.js';
import { UNSORTED, themeNames } from './themes.js';
import { summarize } from './classify.js';

/** @typedef {import('./classify.js').ProjectRecord} ProjectRecord */
/** @typedef {import('./classify.js').Notices} Notices */
/** @typedef {import('./themes.js').OrganizeConfig} OrganizeConfig */

export const MARK_BEGIN =
  '<!-- atlas:begin — generated by `npm run organize` in repo-atlas. Edit projects.json, not this block. -->';
export const MARK_END = '<!-- atlas:end -->';

/** Rendered when a table cell has no value. */
const DASH = '—';

/**
 * @param {string|null} iso
 * @returns {string} local YYYY-MM-DD or 'unknown'
 */
export function fmtDay(iso) {
  return iso === null ? 'unknown' : dayKey(iso);
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const text = v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[i]}`;
}

/** @param {string} a @param {string} b */
function ciCompare(a, b) {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/**
 * @param {ProjectRecord[]} records
 * @param {OrganizeConfig} config
 * @returns {Array<{ theme: string, records: ProjectRecord[] }>}
 */
export function groupByTheme(records, config) {
  const order = [...themeNames(config), UNSORTED];
  /** @type {Map<string, ProjectRecord[]>} */
  const buckets = new Map(order.map((t) => [t, []]));
  for (const r of records) {
    if (!buckets.has(r.theme)) buckets.set(r.theme, []); // theme only in overrides
    buckets.get(r.theme).push(r);
  }
  const groups = [];
  for (const [theme, list] of buckets) {
    if (list.length === 0) continue;
    if (theme === UNSORTED) continue; // appended last below
    groups.push({ theme, records: list.slice().sort((a, b) => ciCompare(a.name, b.name)) });
  }
  const unsorted = buckets.get(UNSORTED) ?? [];
  if (unsorted.length > 0) {
    groups.push({ theme: UNSORTED, records: unsorted.slice().sort((a, b) => ciCompare(a.name, b.name)) });
  }
  return groups;
}

/** @param {string} text */
function cell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** @param {ProjectRecord} r */
function row(r) {
  const stack = r.stack.length > 0 ? r.stack.join(', ') : DASH;
  const remote = r.remote ?? DASH;
  const desc = r.description ?? '';
  return `| ${cell(r.name)} | ${r.kind} | ${r.status} | ${stack} | ${cell(remote)} | ${fmtDay(r.activityIso)} | ${cell(desc)} |`;
}

const TABLE_HEAD = '| Name | Kind | Status | Stack | Remote | Last activity | Description |\n|---|---|---|---|---|---|---|';

/**
 * @param {{ records: ProjectRecord[], notices: Notices, outdated: Record<string, string[]>, config: OrganizeConfig, nowIso: string }} input
 * @returns {string}
 */
export function renderProjectsMd({ records, notices, outdated, config, nowIso }) {
  const s = summarize(records);
  const unsortedCount = s.byTheme[UNSORTED] ?? 0;
  const out = [];
  out.push('# Projects', '');
  out.push(`Generated ${dayKey(nowIso)} by \`npm run organize\` (repo-atlas). Do not edit. Edit projects.json.`, '');
  out.push(
    `Summary: ${s.total} projects · ${s.byStatus.active} active · ${s.byStatus.paused} paused · ${s.byStatus.stale} stale · ${s.byStatus.empty} empty · ${s.byStatus.unknown} unknown · ${unsortedCount} unsorted`,
    '',
  );
  for (const g of groupByTheme(records, config)) {
    out.push(`## ${g.theme} (${g.records.length})`, '', TABLE_HEAD);
    for (const r of g.records) out.push(row(r));
    out.push('');
  }
  out.push('## Outdated', '');
  const subs = Object.keys(outdated).sort();
  if (subs.length === 0) {
    out.push('_(no Outdated folder yet)_', '');
  }
  for (const sub of subs) {
    const names = outdated[sub];
    out.push(`### ${sub} (${names.length})`, '');
    if (names.length === 0) out.push('_(none)_');
    for (const n of names) out.push(`- ${n}`);
    out.push('');
  }
  out.push('## Loose files at the root', '');
  if (notices.looseFiles.length === 0) out.push('_(none)_');
  for (const f of notices.looseFiles) out.push(`- ${f}`);
  out.push('');
  return out.join('\n');
}

/**
 * @param {{ records: ProjectRecord[], config: OrganizeConfig }} input
 * @returns {string} block including both markers, ending with a newline
 */
export function renderClaudeBlock({ records, config }) {
  const groups = groupByTheme(records, config);
  const themesLine = groups.map((g) => `${g.theme} (${g.records.length})`).join(' · ');
  return [
    MARK_BEGIN,
    '# ~/Projects',
    '',
    'Map of this folder: PROJECTS.md (generated, complete, grouped by theme).',
    '',
    `Themes: ${themesLine}`,
    '',
    'Archive: Outdated/archived-projects/ holds retired projects. Outdated/empties/ holds empty folders. Every move is logged in Outdated/MOVES.log.',
    '',
    'Rules for agents:',
    "- Each project's own README.md or CLAUDE.md is its entry point. Start there.",
    '- Do not create files at the root of ~/Projects. Work inside one project folder.',
    '- Do not move, rename, or delete project folders. `npm run organize` in repo-atlas does that, with confirmation.',
    MARK_END,
    '',
  ].join('\n');
}

/**
 * @param {string|null} existing current CLAUDE.md text, or null when missing
 * @param {string} block from renderClaudeBlock
 * @returns {string}
 */
export function spliceClaudeMd(existing, block) {
  if (existing === null) return block;
  const start = existing.indexOf(MARK_BEGIN);
  const end = existing.indexOf(MARK_END);
  if (start === -1 || end === -1 || end < start) {
    const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return `${existing}${sep}${block}`;
  }
  const afterEnd = end + MARK_END.length;
  const tail = existing.slice(afterEnd).replace(/^\n/, '');
  return `${existing.slice(0, start)}${block}${tail}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/render.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/render.js server/organize/render.test.js
git commit -m "feat(organize): render PROJECTS.md and the CLAUDE.md block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Console report (`render.js`, part 2)

**Files:**
- Modify: `server/organize/render.js` (append)
- Test: `server/organize/render.test.js` (append)

**Interfaces:**
- Consumes: part-1 helpers, `summarize`, `groupByTheme`.
- Produces:
  - `candidateLine(r: ProjectRecord): string` — one line with kind, last activity, size, remote, and `WARNING:` notes for dirty or unpushed. Reused by `prompt.js`.
  - `renderReport({ records, notices, config, staleDays }): string` — the full plain-text report.

- [ ] **Step 1: Append the failing tests to `render.test.js`**

Add `candidateLine, renderReport` to the import from `./render.js`, then append:

```js
describe('candidateLine', () => {
  it('describes a candidate with warnings', () => {
    const r = rec('daily-ai-updates', { status: 'stale', dirty: true, aheadBy: 2, bytes: 1.4 * 1024 ** 3, remote: 'trmnmc/daily-ai', activityIso: '2026-05-10T12:00:00-05:00' });
    const line = candidateLine(r);
    expect(line).toBe('daily-ai-updates — git · last activity 2026-05-10 · 1.4 GB · remote trmnmc/daily-ai · WARNING: uncommitted changes · WARNING: 2 unpushed commits');
  });
  it('omits warnings and remote when clean', () => {
    const r = rec('random', { kind: 'folder', status: 'stale', bytes: 512, activityIso: '2026-05-10T12:00:00-05:00' });
    expect(candidateLine(r)).toBe('random — folder · last activity 2026-05-10 · 512 B');
  });
});

describe('renderReport', () => {
  const text = renderReport({ records, notices, config: defaultConfig(), staleDays: 90 });
  it('leads with counts', () => {
    expect(text).toContain('Organize report — 4 projects (stale after 90 days)');
    expect(text).toContain('Status: 2 active · 0 paused · 1 stale · 1 empty · 0 unknown');
    expect(text).toContain('Themes: minecraft 1 · finance 1 · unsorted 2');
  });
  it('lists every theme group with aligned rows', () => {
    expect(text).toContain('== minecraft (1)');
    expect(text).toMatch(/minecraft-plugins\s+git\s+active\s+2026-09-01\s+10 B\s+—/);
    expect(text).toContain('== unsorted (2)');
  });
  it('lists the notices', () => {
    expect(text).toContain('== Archive candidates (1)\n  alpaca-v2 — git · last activity 2026-06-10 · 10 B · remote trmnmc/alpaca-v2');
    expect(text).toContain('== Empty folders (1)\n  FUN');
    expect(text).toContain('== Unsorted (2)\n  FUN, random');
    expect(text).toContain('== Possible duplicates (0)\n  (none)');
    expect(text).toContain('== Loose files at the root (2)\n  snapshot.zip, ssh-key');
  });
  it('shows duplicate reasons', () => {
    const t = renderReport({ records, notices: { ...notices, duplicates: [{ reason: 'remote', key: 'trmnmc/x', names: ['A', 'A 2'] }] }, config: defaultConfig(), staleDays: 90 });
    expect(t).toContain('== Possible duplicates (1)\n  A, A 2 — same remote trmnmc/x');
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/render.test.js`
Expected: FAIL. `does not provide an export named 'candidateLine'`.

- [ ] **Step 3: Append the implementation to `render.js`**

```js
/* ------------------------------------------------------------------ */
/* Part 2: console report                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {ProjectRecord} r
 * @returns {string}
 */
export function candidateLine(r) {
  const parts = [`${r.kind}`, `last activity ${fmtDay(r.activityIso)}`, fmtBytes(r.bytes)];
  if (r.remote !== null) parts.push(`remote ${r.remote}`);
  if (r.dirty) parts.push('WARNING: uncommitted changes');
  if (r.aheadBy > 0) parts.push(`WARNING: ${r.aheadBy} unpushed commit${r.aheadBy === 1 ? '' : 's'}`);
  return `${r.name} — ${parts.join(' · ')}`;
}

/** @param {string} text @param {number} width */
function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * @param {{ records: ProjectRecord[], notices: Notices, config: OrganizeConfig, staleDays: number }} input
 * @returns {string}
 */
export function renderReport({ records, notices, config, staleDays }) {
  const s = summarize(records);
  const groups = groupByTheme(records, config);
  const out = [];
  out.push(`Organize report — ${s.total} projects (stale after ${staleDays} days)`);
  out.push(
    `Status: ${s.byStatus.active} active · ${s.byStatus.paused} paused · ${s.byStatus.stale} stale · ${s.byStatus.empty} empty · ${s.byStatus.unknown} unknown`,
  );
  out.push(`Themes: ${groups.map((g) => `${g.theme} ${g.records.length}`).join(' · ')}`);
  out.push('');

  const nameW = Math.max(4, ...records.map((r) => r.name.length)) + 2;
  for (const g of groups) {
    out.push(`== ${g.theme} (${g.records.length})`);
    out.push(`  ${pad('NAME', nameW)}${pad('KIND', 8)}${pad('STATUS', 9)}${pad('LAST', 12)}${pad('SIZE', 9)}REMOTE`);
    for (const r of g.records) {
      out.push(
        `  ${pad(r.name, nameW)}${pad(r.kind, 8)}${pad(r.status, 9)}${pad(fmtDay(r.activityIso), 12)}${pad(fmtBytes(r.bytes), 9)}${r.remote ?? DASH}`,
      );
    }
    out.push('');
  }

  const names = (list) =>
    list.length === 0 ? '  (none)' : `  ${list.slice().sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join(', ')}`;
  out.push(`== Archive candidates (${notices.candidates.length})`);
  if (notices.candidates.length === 0) out.push('  (none)');
  for (const r of notices.candidates) out.push(`  ${candidateLine(r)}`);
  out.push(`== Empty folders (${notices.empties.length})`);
  out.push(names(notices.empties.map((r) => r.name)));
  out.push(`== Unsorted (${notices.unsorted.length})`);
  out.push(names(notices.unsorted.map((r) => r.name)));
  out.push(`== Possible duplicates (${notices.duplicates.length})`);
  if (notices.duplicates.length === 0) out.push('  (none)');
  for (const d of notices.duplicates) {
    const why = d.reason === 'remote' ? `same remote ${d.key}` : `name suffix of ${d.key}`;
    out.push(`  ${d.names.join(', ')} — ${why}`);
  }
  out.push(`== Loose files at the root (${notices.looseFiles.length})`);
  out.push(names(notices.looseFiles));
  out.push('');
  return out.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/render.test.js`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/render.js server/organize/render.test.js
git commit -m "feat(organize): console report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Prompts (`prompt.js`)

**Files:**
- Create: `server/organize/prompt.js`
- Test: `server/organize/prompt.test.js`

**Interfaces:**
- Consumes: `themeNames` from `./themes.js`; `candidateLine` from `./render.js`; `Notices`, `Decision` shapes.
- Produces:
  - `runPrompts({ notices, config, ask, out }): Promise<{ decisions: Decision[], confirmed: boolean }>`
    - `ask: (question: string) => Promise<string>` — returns the raw answer line.
    - `out: (line: string) => void` — console output.
  - `describeMoves(decisions: Decision[]): string[]` — one `name → Outdated/<subdir>/name` line per archive decision.

Rules: an empty or unrecognized answer re-asks, except that an empty answer to a theme or archive question means skip. `ask` returning `undefined` (scripted tests running dry) counts as skip. The final confirmation accepts only `y` or `yes`, case-insensitive. With no archive decisions there is no confirmation and `confirmed` is `false`.

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/prompt: three rounds + final confirmation against a
 * scripted ask(). Pure given ask/out.
 */
import { describe, it, expect } from 'vitest';
import { defaultConfig } from './themes.js';
import { runPrompts, describeMoves } from './prompt.js';

function rec(name, over = {}) {
  return {
    name, path: `/tmp/root/${name}`, kind: 'git', readable: true,
    lastCommitIso: null, dirty: false, aheadBy: 0, remote: null,
    newestFileIso: null, fileCount: 1, bytes: 10, empty: false, stack: [], description: null,
    theme: 'unsorted', status: 'active', activityIso: '2026-05-10T12:00:00-05:00',
    ...over,
  };
}
function harness(answers) {
  const asked = [];
  const lines = [];
  const ask = async (q) => { asked.push(q); return answers.shift(); };
  const out = (l) => lines.push(l);
  return { ask, out, asked, lines };
}
const emptyNotices = { candidates: [], empties: [], unsorted: [], duplicates: [], looseFiles: [] };

describe('round 1: unsorted', () => {
  it('numbers the themes in config order and records a pick as a theme decision', async () => {
    const h = harness(['5', 's']);
    const notices = { ...emptyNotices, unsorted: [rec('random'), rec('moon')] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(h.lines.some((l) => l.includes('1) minecraft'))).toBe(true);
    expect(h.lines.some((l) => l.includes('10) ai-tools'))).toBe(true);
    expect(decisions).toEqual([{ name: 'moon', action: 'theme', theme: 'finance' }]);
    expect(confirmed).toBe(false);
  });
  it('re-asks on an invalid number and treats empty as skip', async () => {
    const h = harness(['99', '2', '']);
    const notices = { ...emptyNotices, unsorted: [rec('a'), rec('b')] };
    const { decisions } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'a', action: 'theme', theme: 'roblox' }]);
    expect(h.asked.length).toBe(3);
  });
});

describe('round 2: archive candidates', () => {
  it('maps a/k/s and shows the candidate line', async () => {
    const h = harness(['a', 'k', 's', 'y']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' }), rec('y', { status: 'stale', dirty: true }), rec('z', { status: 'stale' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([
      { name: 'x', action: 'archive', subdir: 'archived-projects' },
      { name: 'y', action: 'keep' },
      { name: 'z', action: 'skip' },
    ]);
    expect(h.lines.some((l) => l.includes('y — git') && l.includes('WARNING: uncommitted changes'))).toBe(true);
    expect(confirmed).toBe(true);
  });
  it('re-asks on junk', async () => {
    const h = harness(['maybe', 'k']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' })] };
    const { decisions } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'x', action: 'keep' }]);
  });
});

describe('round 3: empties', () => {
  it('archives to the empties subdir', async () => {
    const h = harness(['a', 'yes']);
    const notices = { ...emptyNotices, empties: [rec('FUN', { status: 'empty', kind: 'folder' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'FUN', action: 'archive', subdir: 'empties' }]);
    expect(confirmed).toBe(true);
  });
});

describe('final confirmation', () => {
  it('lists the queued moves and only y/yes confirms', async () => {
    const h = harness(['a', 'n']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(h.lines).toContain('  x → Outdated/archived-projects/x');
    expect(h.asked[h.asked.length - 1]).toBe('Proceed with 1 move? [y/N]: ');
    expect(confirmed).toBe(false);
    expect(decisions).toEqual([{ name: 'x', action: 'archive', subdir: 'archived-projects' }]);
  });
  it('skips confirmation when nothing is queued', async () => {
    const h = harness(['k']);
    const notices = { ...emptyNotices, candidates: [rec('x', { status: 'stale' })] };
    const { confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(confirmed).toBe(false);
    expect(h.asked.length).toBe(1);
    expect(h.lines).toContain('No moves queued.');
  });
  it('a dry ask (undefined) counts as skip everywhere', async () => {
    const h = harness([]);
    const notices = { ...emptyNotices, unsorted: [rec('a')], candidates: [rec('x', { status: 'stale' })], empties: [rec('E', { status: 'empty' })] };
    const { decisions, confirmed } = await runPrompts({ notices, config: defaultConfig(), ...h });
    expect(decisions).toEqual([{ name: 'x', action: 'skip' }, { name: 'E', action: 'skip' }]);
    expect(confirmed).toBe(false);
  });
});

describe('describeMoves', () => {
  it('renders only archive decisions', () => {
    expect(describeMoves([
      { name: 'x', action: 'archive', subdir: 'archived-projects' },
      { name: 'k', action: 'keep' },
      { name: 'E', action: 'archive', subdir: 'empties' },
    ])).toEqual(['  x → Outdated/archived-projects/x', '  E → Outdated/empties/E']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/prompt.test.js`
Expected: FAIL. `Cannot find module './prompt.js'`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Repo Atlas — organize: interactive rounds (pure given ask/out).
 *
 * Round 1 asks a theme for each unsorted folder. Round 2 asks
 * archive/keep/skip for each stale project. Round 3 does the same for empty
 * folders (destination Outdated/empties). Then one confirmation lists every
 * queued move; only y/yes confirms. Empty answers mean skip; junk re-asks;
 * an undefined answer (a scripted ask that ran dry) means skip so tests
 * can never hang.
 */

import { themeNames } from './themes.js';
import { candidateLine } from './render.js';

/** @typedef {import('./classify.js').Notices} Notices */
/** @typedef {import('./themes.js').OrganizeConfig} OrganizeConfig */
/** @typedef {{ name: string, action: 'theme', theme: string } | { name: string, action: 'keep' } | { name: string, action: 'skip' } | { name: string, action: 'archive', subdir: 'archived-projects'|'empties' }} Decision */

/** @param {string|undefined} answer */
function norm(answer) {
  return (answer ?? '').trim().toLowerCase();
}

/**
 * @param {Decision[]} decisions
 * @returns {string[]}
 */
export function describeMoves(decisions) {
  return decisions
    .filter((d) => d.action === 'archive')
    .map((d) => `  ${d.name} → Outdated/${/** @type {any} */ (d).subdir}/${d.name}`);
}

/**
 * Ask archive/keep/skip until a valid answer arrives.
 * @param {string} question
 * @param {(q: string) => Promise<string|undefined>} ask
 * @returns {Promise<'archive'|'keep'|'skip'>}
 */
async function askAks(question, ask) {
  for (;;) {
    const raw = await ask(question);
    if (raw === undefined) return 'skip';
    const a = norm(raw);
    if (a === '' || a === 's') return 'skip';
    if (a === 'a') return 'archive';
    if (a === 'k') return 'keep';
  }
}

/**
 * @param {{ notices: Notices, config: OrganizeConfig, ask: (q: string) => Promise<string|undefined>, out: (line: string) => void }} input
 * @returns {Promise<{ decisions: Decision[], confirmed: boolean }>}
 */
export async function runPrompts({ notices, config, ask, out }) {
  /** @type {Decision[]} */
  const decisions = [];
  const names = themeNames(config);

  // Round 1 — unsorted folders
  const unsorted = notices.unsorted.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const r of unsorted) {
    out(`Unsorted: ${r.name}`);
    names.forEach((t, i) => out(`  ${i + 1}) ${t}`));
    for (;;) {
      const raw = await ask(`Theme for ${r.name} [1-${names.length}, s=skip]: `);
      if (raw === undefined) break;
      const a = norm(raw);
      if (a === '' || a === 's') break;
      const n = Number.parseInt(a, 10);
      if (Number.isInteger(n) && n >= 1 && n <= names.length) {
        decisions.push({ name: r.name, action: 'theme', theme: names[n - 1] });
        break;
      }
    }
  }

  // Round 2 — archive candidates
  for (const r of notices.candidates) {
    out(candidateLine(r));
    const action = await askAks(`Archive ${r.name}? [a=archive, k=keep, s=skip]: `, ask);
    decisions.push(action === 'archive' ? { name: r.name, action, subdir: 'archived-projects' } : { name: r.name, action });
  }

  // Round 3 — empty folders
  for (const r of notices.empties) {
    const action = await askAks(`Move empty folder ${r.name} to Outdated/empties? [a=archive, k=keep, s=skip]: `, ask);
    decisions.push(action === 'archive' ? { name: r.name, action, subdir: 'empties' } : { name: r.name, action });
  }

  // Final confirmation
  const moves = describeMoves(decisions);
  if (moves.length === 0) {
    out('No moves queued.');
    return { decisions, confirmed: false };
  }
  out('Queued moves:');
  for (const line of moves) out(line);
  const raw = await ask(`Proceed with ${moves.length} move${moves.length === 1 ? '' : 's'}? [y/N]: `);
  const a = norm(raw);
  return { decisions, confirmed: a === 'y' || a === 'yes' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/prompt.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/prompt.js server/organize/prompt.test.js
git commit -m "feat(organize): prompt rounds and final confirmation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Mover (`mover.js`)

**Files:**
- Create: `server/organize/mover.js`
- Test: `server/organize/mover.test.js`

**Interfaces:**
- Consumes: `appendLine` from `./io.js`; `OUTDATED_DIR` from `./survey.js`; `Decision`, `Move` shapes.
- Produces:
  - `ARCHIVE_SUBDIR = 'archived-projects'`, `EMPTIES_SUBDIR = 'empties'`, `LOG_FILE = 'MOVES.log'`
  - `moveLogFile(root: string): string` — `<root>/Outdated/MOVES.log`
  - `ensureOutdatedDirs(root: string): Promise<void>` — creates `Outdated/`, both subdirs
  - `planMoves(decisions: Decision[], root: string): Move[]` — archive decisions only, in order
  - `applyMoves(moves: Move[], { nowIso, logFile, rename? }): Promise<{ done: Move[], skipped: Array<{ move: Move, reason: string }> }>`

Reasons are exactly: `destination exists`, `different volume`, `source vanished`, or the error message for anything else. A log line is appended only after a rename succeeds. One failure never stops the others.

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/mover: plan from decisions, apply with real
 * fs.rename in a mktemp root, log after success, skip with reasons.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARCHIVE_SUBDIR, EMPTIES_SUBDIR, LOG_FILE,
  moveLogFile, ensureOutdatedDirs, planMoves, applyMoves,
} from './mover.js';

const NOW = '2026-09-21T12:00:00-05:00';
let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-mover-'));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'file.txt'), 'a\n');
  fs.mkdirSync(path.join(root, 'b'));
  fs.mkdirSync(path.join(root, 'Outdated', 'archived-projects', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'E'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('constants and paths', () => {
  it('names the convention', () => {
    expect(ARCHIVE_SUBDIR).toBe('archived-projects');
    expect(EMPTIES_SUBDIR).toBe('empties');
    expect(LOG_FILE).toBe('MOVES.log');
    expect(moveLogFile('/r')).toBe(path.join('/r', 'Outdated', 'MOVES.log'));
  });
  it('ensureOutdatedDirs creates the three folders', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-ensure-'));
    await ensureOutdatedDirs(r);
    expect(fs.statSync(path.join(r, 'Outdated', 'archived-projects')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(r, 'Outdated', 'empties')).isDirectory()).toBe(true);
    await ensureOutdatedDirs(r); // idempotent
    fs.rmSync(r, { recursive: true, force: true });
  });
});

describe('planMoves', () => {
  it('turns archive decisions into absolute from/to pairs, in order', () => {
    const moves = planMoves([
      { name: 'a', action: 'archive', subdir: 'archived-projects' },
      { name: 'k', action: 'keep' },
      { name: 'E', action: 'archive', subdir: 'empties' },
      { name: 't', action: 'theme', theme: 'games' },
    ], '/r');
    expect(moves).toEqual([
      { name: 'a', from: path.join('/r', 'a'), to: path.join('/r', 'Outdated', 'archived-projects', 'a') },
      { name: 'E', from: path.join('/r', 'E'), to: path.join('/r', 'Outdated', 'empties', 'E') },
    ]);
  });
});

describe('applyMoves', () => {
  it('moves, logs after success, skips with reasons, and keeps going', async () => {
    const logFile = moveLogFile(root);
    const moves = planMoves([
      { name: 'a', action: 'archive', subdir: 'archived-projects' },
      { name: 'b', action: 'archive', subdir: 'archived-projects' }, // destination exists
      { name: 'c', action: 'archive', subdir: 'archived-projects' }, // source vanished
      { name: 'E', action: 'archive', subdir: 'empties' },
    ], root);
    const result = await applyMoves(moves, { nowIso: NOW, logFile });

    expect(result.done.map((m) => m.name)).toEqual(['a', 'E']);
    expect(result.skipped.map((s) => [s.move.name, s.reason])).toEqual([
      ['b', 'destination exists'],
      ['c', 'source vanished'],
    ]);
    expect(fs.existsSync(path.join(root, 'a'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'Outdated', 'archived-projects', 'a', 'file.txt'), 'utf8')).toBe('a\n');
    expect(fs.existsSync(path.join(root, 'b'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Outdated', 'empties', 'E'))).toBe(true);

    const log = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n');
    expect(log).toEqual([
      `${NOW}\t${path.join(root, 'a')}\t${path.join(root, 'Outdated', 'archived-projects', 'a')}`,
      `${NOW}\t${path.join(root, 'E')}\t${path.join(root, 'Outdated', 'empties', 'E')}`,
    ]);
  });
  it('reports a cross-volume rename as different volume and writes no log line', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-xdev-'));
    fs.mkdirSync(path.join(r, 'x'));
    const rename = async () => { const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; };
    const result = await applyMoves(planMoves([{ name: 'x', action: 'archive', subdir: 'archived-projects' }], r), { nowIso: NOW, logFile: moveLogFile(r), rename });
    expect(result.done).toEqual([]);
    expect(result.skipped[0].reason).toBe('different volume');
    expect(fs.existsSync(moveLogFile(r))).toBe(false);
    fs.rmSync(r, { recursive: true, force: true });
  });
  it('does nothing with an empty plan', async () => {
    const result = await applyMoves([], { nowIso: NOW, logFile: moveLogFile(root) });
    expect(result).toEqual({ done: [], skipped: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/mover.test.js`
Expected: FAIL. `Cannot find module './mover.js'`.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/mover.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/mover.js server/organize/mover.test.js
git commit -m "feat(organize): plan and apply archive moves with a log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: CLI wiring, npm script, README (`cli.js`)

**Files:**
- Create: `server/organize/cli.js`
- Test: `server/organize/cli.test.js`
- Modify: `package.json` (scripts block)
- Modify: `README.md` (add a section before `## Boundaries`)

**Interfaces:**
- Consumes: everything from Tasks 1–9; `STALE_DAYS`, `dayKey` from `../../shared/contract.js`.
- Produces:
  - `CONFIG_FILE = 'projects.json'`, `INDEX_FILE = 'PROJECTS.md'`, `CLAUDE_FILE = 'CLAUDE.md'`
  - `parseFlags(argv: string[]): { root: string, staleDays: number, dryRun: boolean }` — throws on bad input
  - `applyDecisionsToConfig(config, decisions, todayKey: string): OrganizeConfig` — pure; `theme` → override, `keep` → paused with `todayKey`, everything else untouched
  - `main(argv: string[], io?: { out?, err?, nowIso?, ask? }): Promise<number>` — exit code; `ask` is `(q) => Promise<string|undefined>`; when omitted on a non-dry run, readline is used

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
/**
 * Repo Atlas — organize/cli: flags, config merge, dry-run writes nothing,
 * a full scripted run moves + writes, error exits. mktemp root only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from './themes.js';
import { CONFIG_FILE, INDEX_FILE, CLAUDE_FILE, parseFlags, applyDecisionsToConfig, main } from './cli.js';

const NOW = '2026-09-21T12:00:00-05:00';
function touch(file, iso) {
  const d = new Date(iso);
  fs.utimesSync(file, d, d);
}
function write(dir, rel, content, iso) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  touch(p, iso);
}
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-cli-'));
  write(root, 'minecraft-plugins/a.txt', 'x', '2026-09-10T12:00:00-05:00'); // active, themed
  write(root, 'old/a.txt', 'x', '2026-01-01T12:00:00-05:00');               // stale, unsorted
  write(root, 'snapshot.zip', 'z', '2026-09-10T12:00:00-05:00');            // loose
  return root;
}
function io(answers = []) {
  const lines = [];
  const errors = [];
  return {
    out: (l) => lines.push(l),
    err: (l) => errors.push(l),
    nowIso: NOW,
    ask: async () => answers.shift(),
    lines,
    errors,
  };
}

describe('parseFlags', () => {
  it('defaults to ~/Projects, 90 days, not dry', () => {
    expect(parseFlags([])).toEqual({ root: path.join(os.homedir(), 'Projects'), staleDays: 90, dryRun: false });
  });
  it('reads all three flags', () => {
    expect(parseFlags(['--root', '/tmp/x', '--stale-days', '30', '--dry-run'])).toEqual({ root: '/tmp/x', staleDays: 30, dryRun: true });
  });
  it('rejects bad stale-days and unknown flags', () => {
    expect(() => parseFlags(['--stale-days', 'soon'])).toThrow(/stale-days/);
    expect(() => parseFlags(['--stale-days', '0'])).toThrow(/stale-days/);
    expect(() => parseFlags(['--bogus'])).toThrow();
  });
});

describe('applyDecisionsToConfig', () => {
  it('records theme picks and keeps, ignores the rest, and does not mutate', () => {
    const c = defaultConfig();
    const next = applyDecisionsToConfig(c, [
      { name: 'moon', action: 'theme', theme: 'games' },
      { name: 'alpaca-v2', action: 'keep' },
      { name: 'x', action: 'archive', subdir: 'archived-projects' },
      { name: 'y', action: 'skip' },
    ], '2026-09-21');
    expect(next.overrides).toEqual({ moon: 'games' });
    expect(next.paused).toEqual({ 'alpaca-v2': '2026-09-21' });
    expect(c.overrides).toEqual({});
    expect(c.paused).toEqual({});
  });
});

describe('main', () => {
  it('--dry-run prints the report and writes nothing', async () => {
    const root = makeRoot();
    const h = io();
    const code = await main(['--root', root, '--dry-run'], h);
    expect(code).toBe(0);
    expect(h.lines.join('\n')).toContain('Organize report — 2 projects');
    expect(h.lines.join('\n')).toContain('Dry run: nothing asked, nothing written.');
    expect(fs.existsSync(path.join(root, CONFIG_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, INDEX_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, CLAUDE_FILE))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Outdated'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a confirmed run moves, logs, and writes the three files', async () => {
    const root = makeRoot();
    // round 1: theme for 'old' → 3) games; round 2: archive 'old'; confirm
    const h = io(['3', 'a', 'y']);
    const code = await main(['--root', root], h);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, 'old'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Outdated', 'archived-projects', 'old', 'a.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'Outdated', 'MOVES.log'), 'utf8')).toContain(`${NOW}\t${path.join(root, 'old')}\t`);

    const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
    expect(config.overrides).toEqual({ old: 'games' });
    expect(config.paused).toEqual({});

    const index = fs.readFileSync(path.join(root, INDEX_FILE), 'utf8');
    expect(index).toContain('## minecraft (1)');
    expect(index).not.toMatch(/^\| old \|/m);
    expect(index).toContain('### archived-projects (1)\n\n- old\n');
    expect(index).toContain('- snapshot.zip');

    const claude = fs.readFileSync(path.join(root, CLAUDE_FILE), 'utf8');
    expect(claude).toContain('<!-- atlas:begin');
    expect(claude).toContain('<!-- atlas:end -->');
    expect(h.lines.join('\n')).toContain(`Moved 1, skipped 0. Wrote ${CONFIG_FILE}, ${INDEX_FILE}, ${CLAUDE_FILE} in ${root}.`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keep saves paused and a cancelled confirmation still writes', async () => {
    const root = makeRoot();
    write(root, 'old2/a.txt', 'x', '2026-01-01T12:00:00-05:00');
    fs.writeFileSync(path.join(root, CLAUDE_FILE), '# Mine\n\nkeep me\n');
    // round 1: skip 'old', skip 'old2'; round 2: keep 'old', archive 'old2'; cancel
    const h = io(['s', 's', 'k', 'a', 'n']);
    const code = await main(['--root', root], h);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, 'old2'))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
    expect(config.paused).toEqual({ old: '2026-09-21' });
    expect(h.lines.join('\n')).toContain('Moves cancelled. Theme picks and keep decisions are still saved.');
    const claude = fs.readFileSync(path.join(root, CLAUDE_FILE), 'utf8');
    expect(claude.startsWith('# Mine\n\nkeep me\n')).toBe(true);
    expect(claude).toContain('<!-- atlas:end -->');
    expect(fs.readFileSync(path.join(root, INDEX_FILE), 'utf8')).toMatch(/^\| old \| folder \| paused \|/m);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 on bad flags, a missing root, and a corrupt config', async () => {
    let h = io();
    expect(await main(['--stale-days', 'x'], h)).toBe(1);
    expect(h.errors[0]).toMatch(/stale-days/);

    h = io();
    expect(await main(['--root', path.join(os.tmpdir(), 'organize-no-such-root-xyz'), '--dry-run'], h)).toBe(1);
    expect(h.errors[0]).toMatch(/Cannot read/);

    const root = makeRoot();
    fs.writeFileSync(path.join(root, CONFIG_FILE), '{ nope');
    h = io();
    expect(await main(['--root', root, '--dry-run'], h)).toBe(1);
    expect(h.errors[0]).toMatch(/projects\.json is unusable/);
    expect(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')).toBe('{ nope');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/cli.test.js`
Expected: FAIL. `Cannot find module './cli.js'`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Repo Atlas — organize: CLI entry (plain Node ESM, zero deps).
 *
 *   npm run organize -- [--root <dir>] [--stale-days <n>] [--dry-run]
 *
 * survey → classify → report → (prompts → moves) → write. --dry-run stops
 * after the report and writes nothing, not even a missing projects.json.
 * Ctrl-C at a prompt exits 130 with nothing moved and nothing written.
 * Exit 1 for bad flags, an unreadable root, or a corrupt projects.json.
 */

import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { STALE_DAYS, dayKey } from '../../shared/contract.js';
import { readTextOrNull, writeTextAtomic } from './io.js';
import { loadConfig, saveConfig, ConfigError } from './themes.js';
import { surveyProjects } from './survey.js';
import { classify } from './classify.js';
import { renderReport, renderProjectsMd, renderClaudeBlock, spliceClaudeMd } from './render.js';
import { runPrompts } from './prompt.js';
import { moveLogFile, ensureOutdatedDirs, planMoves, applyMoves } from './mover.js';

/** @typedef {import('./themes.js').OrganizeConfig} OrganizeConfig */
/** @typedef {import('./prompt.js').Decision} Decision */

export const CONFIG_FILE = 'projects.json';
export const INDEX_FILE = 'PROJECTS.md';
export const CLAUDE_FILE = 'CLAUDE.md';

/**
 * @param {string[]} argv
 * @returns {{ root: string, staleDays: number, dryRun: boolean }}
 */
export function parseFlags(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      'stale-days': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const root = path.resolve(values.root ?? path.join(os.homedir(), 'Projects'));
  const raw = values['stale-days'];
  const staleDays = raw === undefined ? STALE_DAYS : Number(raw);
  if (!Number.isInteger(staleDays) || staleDays < 1) {
    throw new Error(`--stale-days must be a positive whole number, got "${raw}"`);
  }
  return { root, staleDays, dryRun: values['dry-run'] === true };
}

/**
 * @param {OrganizeConfig} config
 * @param {Decision[]} decisions
 * @param {string} todayKey YYYY-MM-DD
 * @returns {OrganizeConfig} a new object; the input is not mutated
 */
export function applyDecisionsToConfig(config, decisions, todayKey) {
  const next = { themes: config.themes, overrides: { ...config.overrides }, paused: { ...config.paused } };
  for (const d of decisions) {
    if (d.action === 'theme') next.overrides[d.name] = d.theme;
    else if (d.action === 'keep') next.paused[d.name] = todayKey;
  }
  return next;
}

/** Real terminal prompts. Ctrl-C exits 130 before anything is written. */
function makeReadlineAsk() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  rl.on('SIGINT', () => {
    rl.close();
    stdout.write('\nCancelled. Nothing moved, nothing written.\n');
    process.exit(130);
  });
  return { ask: (/** @type {string} */ q) => rl.question(q), close: () => rl.close() };
}

/**
 * @param {string[]} argv flags only (no node/script)
 * @param {{ out?: (l: string) => void, err?: (l: string) => void, nowIso?: string, ask?: (q: string) => Promise<string|undefined> }} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const out = io.out ?? ((l) => console.log(l));
  const err = io.err ?? ((l) => console.error(l));
  const nowIso = io.nowIso ?? new Date().toISOString();

  let flags;
  try {
    flags = parseFlags(argv);
  } catch (e) {
    err(/** @type {Error} */ (e).message);
    return 1;
  }
  const { root, staleDays, dryRun } = flags;
  const configFile = path.join(root, CONFIG_FILE);

  let config;
  try {
    ({ config } = await loadConfig(configFile));
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return 1;
    }
    throw e;
  }

  let survey;
  try {
    survey = await surveyProjects(root);
  } catch (e) {
    err(`Cannot read ${root}: ${/** @type {Error} */ (e).message}`);
    return 1;
  }

  let { records, notices } = classify(survey, config, nowIso, { staleDays });
  out(renderReport({ records, notices, config, staleDays }));
  if (dryRun) {
    out('Dry run: nothing asked, nothing written.');
    return 0;
  }

  const rl = io.ask ? { ask: io.ask, close: () => {} } : makeReadlineAsk();
  let decisions;
  let confirmed;
  try {
    ({ decisions, confirmed } = await runPrompts({ notices, config, ask: rl.ask, out }));
  } finally {
    rl.close();
  }

  config = applyDecisionsToConfig(config, decisions, dayKey(nowIso));

  const moves = planMoves(decisions, root);
  let moved = { done: [], skipped: [] };
  if (moves.length > 0 && confirmed) {
    await ensureOutdatedDirs(root);
    moved = await applyMoves(moves, { nowIso, logFile: moveLogFile(root) });
    for (const s of moved.skipped) out(`Skipped ${s.move.name}: ${s.reason}`);
  } else if (moves.length > 0) {
    out('Moves cancelled. Theme picks and keep decisions are still saved.');
  }

  // The index must reflect what is on disk now, so survey again after moves.
  if (moved.done.length > 0) survey = await surveyProjects(root);
  ({ records, notices } = classify(survey, config, nowIso, { staleDays }));

  await saveConfig(configFile, config);
  await writeTextAtomic(
    path.join(root, INDEX_FILE),
    renderProjectsMd({ records, notices, outdated: survey.outdated, config, nowIso }),
  );
  const claudePath = path.join(root, CLAUDE_FILE);
  const existing = await readTextOrNull(claudePath);
  await writeTextAtomic(claudePath, spliceClaudeMd(existing, renderClaudeBlock({ records, config })));

  out(`Moved ${moved.done.length}, skipped ${moved.skipped.length}. Wrote ${CONFIG_FILE}, ${INDEX_FILE}, ${CLAUDE_FILE} in ${root}.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Projects/repo-atlas && npx vitest run server/organize/cli.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the npm script**

In `package.json`, inside `"scripts"`, add after the `"build:demo"` line:

```json
    "organize": "node server/organize/cli.js"
```

Verify: `cd ~/Projects/repo-atlas && npm run organize -- --root "$(mktemp -d)" --dry-run` prints `Organize report — 0 projects (stale after 90 days)` and exits 0.

- [ ] **Step 6: Add the README section**

Insert before `## Boundaries` in `README.md`:

```markdown
## Organize

```
npm run organize -- [--root <dir>] [--stale-days <n>] [--dry-run]
```

Surveys the top level of `~/Projects` (plain folders count, not only git
repos), gives every project a theme from `~/Projects/projects.json` and a
status — `active`, `paused`, `stale`, `empty`, or `unknown` — then walks
you through three rounds of questions: a theme for each unsorted folder,
archive/keep/skip for each stale project, and the same for empty folders.
One final `y` applies the queued moves into `Outdated/archived-projects/`
or `Outdated/empties/`, each logged in `Outdated/MOVES.log`. It then writes
`PROJECTS.md` (the complete map) and a short block in `CLAUDE.md` for
coding agents. Stale means the later of last commit and newest file time
is strictly more than 90 days old. `--dry-run` prints the report and
writes nothing. Keep answers are remembered in `projects.json`; remove a
name from `paused` to be asked again. The command never deletes, never
moves an active project, and never touches loose files. Design:
`docs/superpowers/specs/2026-09-20-organize-projects-design.md`.
```

- [ ] **Step 7: Run the whole suite**

Run: `cd ~/Projects/repo-atlas && npm test`
Expected: all files pass; the 13 pre-existing files still pass and 8 new `server/organize/*.test.js` files are included.

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/repo-atlas
git add server/organize/cli.js server/organize/cli.test.js package.json README.md
git commit -m "feat(organize): CLI entry, npm script, and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Verify against the real folder, push, open the PR

**Files:** none created. This task is verification and delivery.

- [ ] **Step 1: Dry run against the real root (read-only)**

Run: `cd ~/Projects/repo-atlas && npm run organize -- --dry-run | head -60`
Expected: `Organize report — 8x projects (stale after 90 days)` with theme groups, roughly 20 archive candidates including `alpaca-v2`, `daily-ai-updates`, and `tstack2`, two empty folders `FUN` and `DEBUG`, duplicates for `BAT-Scanner`/`BAT-Scanner 2`, `SurLeLac`/`SurLeLacv2`, and the `lofts-willow-selection` pair, and `ssh-key` among loose files. Confirm nothing was written: `ls ~/Projects/projects.json ~/Projects/PROJECTS.md ~/Projects/CLAUDE.md` all report "No such file".

- [ ] **Step 2: Full suite once more**

Run: `cd ~/Projects/repo-atlas && npm test`
Expected: PASS.

- [ ] **Step 3: Push the branch and open the PR**

The user asked for this work to be uploaded to GitHub.

```bash
cd ~/Projects/repo-atlas
git push -u origin organize
gh pr create --base main --head organize --title "feat: organize command for ~/Projects" --body "$(cat <<'EOF'
Adds `npm run organize`: survey ~/Projects (plain folders included), theme and status per project, propose-then-confirm archive moves into Outdated/, and generated PROJECTS.md plus a CLAUDE.md block for agents.

Spec: docs/superpowers/specs/2026-09-20-organize-projects-design.md
Plan: docs/superpowers/plans/2026-09-21-organize-command.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL. Merging is the owner's call.

---

## After the plan: first real run (for the person, not the executor)

1. Move the private key out of the projects folder. Check `~/.ssh/config` and any scripts for the old path first:
   ```bash
   mv ~/Projects/ssh-key ~/Projects/ssh-key.pub ~/.ssh/
   ```
2. `cd ~/Projects/repo-atlas && npm run organize -- --dry-run` and read the report.
3. `npm run organize` and answer the prompts. Keep is remembered; skip is asked again next month.
4. Open `~/Projects/PROJECTS.md` and `~/Projects/CLAUDE.md`. Fix any wrong theme in `~/Projects/projects.json` and run again.
5. Follow-up (spec section 12): push the remote-less projects to GitHub, one decision per repo.
