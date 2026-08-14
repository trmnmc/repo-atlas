/**
 * Repo Atlas — attention classification and ranking engine (plain Node ESM).
 *
 * Pure derivations over RepoSummary values. Builds ON the frozen shared
 * contract: reason priority comes from ATTENTION_ORDER, staleness from
 * isStale, and queue ordering from sortAttention — no comparator logic is
 * duplicated here. `nowIso` is always passed in (use Snapshot.generatedAt);
 * never Date.now() inside these functions.
 */
import { ATTENTION_ORDER, isStale, sortAttention } from '../shared/contract.js';

/** @typedef {import('../shared/contract.js').RepoSummary} RepoSummary */
/** @typedef {import('../shared/contract.js').AttentionReason} AttentionReason */
/** @typedef {import('../shared/contract.js').AttentionEntry} AttentionEntry */

/**
 * lastActivityIso fallback for zero-commit repos (lastCommit null). A dirty
 * repo with no commit history still needs an attention entry; the epoch is a
 * valid ISO instant that Date.parse reads as 0, so through the frozen
 * attentionComparator these entries deterministically rank AFTER any
 * equally-reasoned entry with real commit activity, and tie stably (input
 * order) with each other. Pinned by server/attention.test.js.
 */
const ZERO_COMMIT_ACTIVITY_ISO = '1970-01-01T00:00:00.000Z';

/**
 * @typedef {Object} Classification
 * @property {AttentionReason[]} reasons
 *     Every reason that applies, in ATTENTION_ORDER priority (a repo may be
 *     dirty AND stale). Empty when the repo needs no attention.
 * @property {'dirty' | 'unpushed' | 'stale' | 'ok' | 'no-remote'} displayState
 *     The single state a row renders with: the strongest reason when any
 *     apply; otherwise 'no-remote' for upstream {state:'none'} (an
 *     informational marker, not an attention reason); otherwise 'ok'.
 */

/**
 * Classify one repo against a fixed instant.
 *
 * Domain rules (spec, frozen):
 *   - dirty     — worktree has uncommitted changes (RepoSummary.dirty).
 *   - unpushed  — tracked upstream with aheadBy > 0. A repo with upstream
 *                 {state:'none'} can NEVER be 'unpushed': there is nowhere
 *                 to push. It surfaces as 'no-remote' instead (or by a real
 *                 reason such as dirty/stale when one applies).
 *   - stale     — last commit author date STRICTLY more than 90 days before
 *                 nowIso (contract isStale; exactly 90 days is not stale).
 *                 A zero-commit repo (lastCommit null) has no author date and
 *                 can NEVER be stale — but it can absolutely be dirty.
 *
 * @param {RepoSummary} repo
 * @param {string} nowIso ISO-8601 reference instant (Snapshot.generatedAt).
 * @returns {Classification}
 */
export function classify(repo, nowIso) {
  /** @type {Record<AttentionReason, boolean>} */
  const applies = {
    dirty: repo.dirty,
    unpushed: repo.upstream.state === 'tracked' && repo.upstream.aheadBy > 0,
    stale: repo.lastCommit !== null && isStale(repo.lastCommit.iso, nowIso),
  };
  const reasons = ATTENTION_ORDER.filter((reason) => applies[reason]);
  const displayState =
    reasons.length > 0 ? reasons[0] : repo.upstream.state === 'none' ? 'no-remote' : 'ok';
  return { reasons, displayState };
}

/**
 * Build the pre-sorted attention queue for a snapshot.
 *
 * Each repo needing attention contributes exactly ONE entry, carrying its
 * strongest reason and lastActivityIso = last commit author date — or the
 * epoch fallback for zero-commit repos (a dirty repo with lastCommit null
 * still MUST appear; see ZERO_COMMIT_ACTIVITY_ISO). Repos that are 'ok' or
 * merely 'no-remote' are excluded. Ordering (dirty > unpushed > stale, then
 * most-recent activity first, stable on exact ties) is delegated to the
 * contract's sortAttention.
 *
 * @param {RepoSummary[]} repos
 * @param {string} nowIso ISO-8601 reference instant (Snapshot.generatedAt).
 * @returns {AttentionEntry[]} New array, already sorted for rendering.
 */
export function buildAttention(repos, nowIso) {
  /** @type {AttentionEntry[]} */
  const entries = [];
  for (const repo of repos) {
    const { reasons } = classify(repo, nowIso);
    if (reasons.length === 0) continue;
    entries.push({
      repoId: repo.id,
      reason: reasons[0],
      lastActivityIso: repo.lastCommit !== null ? repo.lastCommit.iso : ZERO_COMMIT_ACTIVITY_ISO,
    });
  }
  return sortAttention(entries);
}
