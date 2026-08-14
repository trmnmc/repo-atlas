/**
 * ScanBar — the survey instrument bar: a Rescan control plus, while a scan
 * is in flight, a live "surveying… n/total" reading drawn as a moving
 * sounding line (the same thin-ink idiom as the Timeline chart).
 *
 * Props-in only; the shell owns useAtlas and passes `scanning`/`progress`
 * straight through, so the reading is whatever the scan events said —
 * never an estimate, never an animation pretending to be progress. When
 * `total` is still 0 (enumeration hasn't finished, which the contract
 * explicitly allows on the 'start' event) the line sits at zero and the
 * reading honestly says "0/0".
 */
import { CSS } from '../../shared/contract.js';

export interface ScanBarProps {
  scanning: boolean;
  progress: { done: number; total: number };
  onRescan: () => void;
}

/** The in-flight reading's prefix. Exported so tests assert the real string. */
export const SURVEYING_LABEL = 'surveying…';

const LINE_W = 100;
const LINE_H = 8;
const LINE_Y = LINE_H / 2;

export function ScanBar({ scanning, progress, onRescan }: ScanBarProps) {
  const done = Number.isFinite(progress?.done) ? progress.done : 0;
  const total = Number.isFinite(progress?.total) ? progress.total : 0;
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const markX = ratio * LINE_W;

  return (
    <div className="scanbar">
      <button
        type="button"
        className="scanbar__button"
        onClick={onRescan}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            // Stop the keydown from bubbling to the window-level
            // useKeyboardNav Enter handler (bound by AttentionQueue),
            // which would otherwise hijack this button's Enter/Space and
            // overwrite location.hash with the queue's active row.
            event.stopPropagation();
          }
        }}
        disabled={scanning}
        aria-label="Rescan the projects directory"
      >
        {scanning ? 'Surveying' : 'Rescan'}
      </button>

      <div className="scanbar__gauge" role="status" aria-live="polite">
        {scanning && (
          <span className={`scanbar__reading ${CSS.sounding}`} data-done={done} data-total={total}>
            {`${SURVEYING_LABEL} ${done}/${total}`}
          </span>
        )}
        <svg
          className={`scanbar__line${scanning ? ' scanbar__line--running' : ''}`}
          viewBox={`0 0 ${LINE_W} ${LINE_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={
            scanning ? `Survey progress, ${done} of ${total} repositories` : 'Survey at rest'
          }
          data-ratio={ratio}
        >
          <line
            className="scanbar__line-base"
            x1={0}
            y1={LINE_Y}
            x2={LINE_W}
            y2={LINE_Y}
          />
          {scanning && (
            <>
              <line
                className="scanbar__line-run"
                x1={0}
                y1={LINE_Y}
                x2={markX}
                y2={LINE_Y}
              />
              {/* The head of the run is a vertical survey tick, not a dot:
                  this SVG stretches with preserveAspectRatio="none", which
                  smears a circle into a lozenge. A tick with a non-scaling
                  stroke stays a hairline at any width. */}
              <line
                className="scanbar__line-mark"
                x1={markX}
                y1={0}
                x2={markX}
                y2={LINE_H}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

export default ScanBar;
