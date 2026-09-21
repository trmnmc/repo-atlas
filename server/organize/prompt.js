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
