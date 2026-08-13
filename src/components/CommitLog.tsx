/**
 * CommitLog — "Ship's Log" plate content: a repo's recent commits, newest
 * first. Bare markup, props-in only (no fetching, no Plate wrapper — the
 * view owns the Plate).
 *
 * Survey Folio identity: the author date renders in mono tabular figures
 * (contract `.sounding`), matching every other measured value in the
 * folio; subject and author stay in the serif body face.
 */
import { CSS } from '../../shared/contract.js';

export interface CommitLogEntry {
  hash: string;
  iso: string;
  subject: string;
  author: string;
}

export interface CommitLogProps {
  /** Newest first (contract RepoSummary.recentCommits shape). */
  commits: CommitLogEntry[];
}

export function CommitLog({ commits }: CommitLogProps) {
  const entries = Array.isArray(commits) ? commits : [];

  if (entries.length === 0) {
    return <p className="detail-empty">No recent commits.</p>;
  }

  return (
    <ul className="commit-log">
      {entries.map((commit) => (
        <li key={commit.hash} className="commit-log__row" data-hash={commit.hash}>
          <span className={`commit-log__date ${CSS.sounding}`}>{commit.iso}</span>
          <span className="commit-log__subject">{commit.subject}</span>
          <span className="commit-log__author">{commit.author}</span>
        </li>
      ))}
    </ul>
  );
}

export default CommitLog;
