/**
 * Repo Atlas — organize: CLI entry (plain Node ESM, zero deps).
 *
 *   npm run organize -- [--root <dir>] [--stale-days <n>] [--dry-run]
 *
 * survey → classify → report → (prompts → moves) → write. --dry-run stops
 * after the report and writes nothing, not even a missing projects.json.
 * Ctrl-C at a prompt exits 130 with nothing moved and nothing written.
 * When stdin is not interactive (a pipe, `< /dev/null`, Ctrl-D), every
 * prompt is skipped as if the user pressed Enter: the run finishes,
 * queues no moves, and still writes projects.json, PROJECTS.md, and
 * CLAUDE.md.
 * Exit 1 for bad flags, an unreadable root, a corrupt projects.json, or a
 * present-but-unreadable projects.json/CLAUDE.md (neither is overwritten).
 */

import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { STALE_DAYS, dayKey } from '../../shared/contract.js';
import { readTextOrMissing, writeTextAtomic } from './io.js';
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
  const next = { ...config, overrides: { ...config.overrides }, paused: { ...config.paused } };
  for (const d of decisions) {
    if (d.action === 'theme') next.overrides[d.name] = d.theme;
    else if (d.action === 'keep') next.paused[d.name] = todayKey;
  }
  return next;
}

/**
 * Real terminal prompts. Ctrl-C exits 130 before anything is written.
 *
 * `readline/promises` `question()` never settles on its own if stdin hits
 * EOF before a line arrives (non-TTY stdin: `< /dev/null`, a short pipe,
 * Ctrl-D) — the interface just emits `close`. Left alone, the pending
 * promise dangles, the event loop drains, and the process exits 0 with
 * nothing asked and nothing written. So: once `close` fires, every
 * pending and future `ask()` resolves to `undefined`, which `prompt.js`
 * already treats as skip — the run then finishes the rounds, skips the
 * confirmation, and writes the summary normally.
 */
function makeReadlineAsk() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let closed = false;
  /** @type {Array<() => void>} */
  const onClosePending = [];
  rl.on('close', () => {
    closed = true;
    while (onClosePending.length > 0) onClosePending.shift()();
  });
  rl.on('SIGINT', () => {
    rl.close();
    stdout.write('\nCancelled. Nothing moved, nothing written.\n');
    process.exit(130);
  });
  const ask = (/** @type {string} */ q) => {
    if (closed) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      let settled = false;
      const resolveUndefined = () => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      };
      onClosePending.push(resolveUndefined);
      rl.question(q).then((answer) => {
        if (settled) return;
        settled = true;
        const i = onClosePending.indexOf(resolveUndefined);
        if (i !== -1) onClosePending.splice(i, 1);
        resolve(answer);
      });
    });
  };
  return { ask, close: () => rl.close() };
}

/**
 * @param {unknown} e
 * @returns {e is NodeJS.ErrnoException} true for a rethrown fs read error
 *   (e.g. EACCES) as opposed to a ConfigError or an unrelated bug
 */
function isReadError(e) {
  return typeof e === 'object' && e !== null && typeof (/** @type {any} */ (e).code) === 'string';
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
    if (isReadError(e)) {
      err(`Cannot read ${configFile}: ${/** @type {Error} */ (e).message}`);
      return 1;
    }
    throw e;
  }

  // Read CLAUDE.md's existing content now, next to the config load, so a
  // present-but-unreadable CLAUDE.md exits before projects.json or
  // PROJECTS.md is written (see readTextOrMissing in io.js).
  const claudePath = path.join(root, CLAUDE_FILE);
  let existingClaudeMd;
  try {
    existingClaudeMd = await readTextOrMissing(claudePath);
  } catch (e) {
    err(`Cannot read ${claudePath}: ${/** @type {Error} */ (e).message}`);
    return 1;
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
  await writeTextAtomic(claudePath, spliceClaudeMd(existingClaudeMd, renderClaudeBlock({ records, config })));

  out(`Moved ${moved.done.length}, skipped ${moved.skipped.length}. Wrote ${CONFIG_FILE}, ${INDEX_FILE}, ${CLAUDE_FILE} in ${root}.`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
