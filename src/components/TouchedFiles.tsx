/**
 * TouchedFiles — "Recent Workings" plate content: a repo's most recently
 * touched files, most recent first. Bare markup, props-in only (no
 * fetching, no Plate wrapper — the view owns the Plate).
 *
 * Survey Folio identity: the last-changed date renders in mono tabular
 * figures (contract `.sounding`); the path stays in the serif body face.
 */
import { CSS } from '../../shared/contract.js';

export interface TouchedFileEntry {
  path: string;
  lastIso: string;
  commits: number;
}

export interface TouchedFilesProps {
  /** Most recently touched first (contract RepoSummary.touchedFiles shape). */
  files: TouchedFileEntry[];
}

export function TouchedFiles({ files }: TouchedFilesProps) {
  const entries = Array.isArray(files) ? files : [];

  if (entries.length === 0) {
    return <p className="detail-empty">No recently touched files.</p>;
  }

  return (
    <ul className="touched-files">
      {entries.map((file) => (
        <li key={file.path} className="touched-files__row" data-path={file.path}>
          <span className="touched-files__path">{file.path}</span>
          <span className={`touched-files__date ${CSS.sounding}`}>{file.lastIso}</span>
        </li>
      ))}
    </ul>
  );
}

export default TouchedFiles;
