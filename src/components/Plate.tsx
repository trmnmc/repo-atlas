/**
 * Plate — the frozen engraved-figure frame (FROZEN after wave 1; never edit).
 *
 * Every dashboard region renders inside a Plate: ruled border, "Fig. N"
 * ordinal, small-caps serif caption, then children. Uses ONLY token classes
 * from src/styles/tokens.css, referenced via the shared contract's CSS
 * constants so markup and stylesheet cannot drift.
 *
 * Usage:
 *   <Plate figure={1} caption="Notices">
 *     ...advisory rows...
 *   </Plate>
 */
import type { ReactNode } from 'react';
import { CSS } from '../../shared/contract.js';

export interface PlateProps {
  /** Figure ordinal — rendered as "Fig. N". Strings allowed ("IV", "3a"). */
  figure: number | string;
  /** Small-caps caption text, e.g. "Notices" -> "Fig. 1 — Notices". */
  caption: string;
  /** Plate contents. */
  children?: ReactNode;
  /** Extra class(es) appended to the plate frame. */
  className?: string;
}

export function Plate({ figure, caption, children, className }: PlateProps) {
  const frameClass = className ? `${CSS.plate} ${className}` : CSS.plate;
  return (
    <section className={frameClass} aria-label={`Fig. ${figure} — ${caption}`}>
      <header className={CSS.plateCaption}>
        <span className={CSS.plateFigure}>{`Fig. ${figure}`}</span>
        <span>{caption}</span>
      </header>
      <div className={CSS.plateBody}>{children}</div>
    </section>
  );
}

export default Plate;
