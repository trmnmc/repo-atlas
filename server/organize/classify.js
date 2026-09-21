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
