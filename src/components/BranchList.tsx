/**
 * BranchList — "Charted Branches" plate content: a repo's branches, current
 * branch first (contract RepoSummary.branches ordering). Bare markup,
 * props-in only (no fetching, no Plate wrapper — the view owns the Plate).
 *
 * Survey Folio identity: the current branch carries a small asterisk-style
 * survey marker (as a chart marks the surveyor's present position); every
 * branch's tip date renders in mono tabular figures (contract `.sounding`).
 */
import { CSS } from '../../shared/contract.js';

export interface BranchEntry {
  name: string;
  current: boolean;
  lastCommitIso: string;
}

export interface BranchListProps {
  /** Current branch first, then by lastCommitIso descending (contract shape). */
  branches: BranchEntry[];
}

export function BranchList({ branches }: BranchListProps) {
  const entries = Array.isArray(branches) ? branches : [];

  if (entries.length === 0) {
    return <p className="detail-empty">No branches.</p>;
  }

  return (
    <ul className="branch-list">
      {entries.map((branch) => (
        <li
          key={branch.name}
          className={`branch-list__row${branch.current ? ' branch-list__row--current' : ''}`}
          data-current={branch.current ? 'true' : 'false'}
        >
          <span className="branch-list__marker" aria-hidden="true">
            {branch.current ? '✳' : ''}
          </span>
          <span className="branch-list__name">
            {branch.name}
            {branch.current && <span className="detail-visually-hidden"> (current)</span>}
          </span>
          <span className={`branch-list__tip ${CSS.sounding}`}>{branch.lastCommitIso}</span>
        </li>
      ))}
    </ul>
  );
}

export default BranchList;
