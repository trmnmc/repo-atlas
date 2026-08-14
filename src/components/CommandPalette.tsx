/**
 * CommandPalette — Cmd+K fuzzy repo-jump, layered on top of the folio's
 * existing j/k row navigation (useKeyboardNav, frozen, elsewhere). This is
 * a SELF-CONTAINED component: it ships its own scoped styles (built from
 * tokens.css variables only — no new stylesheet file, since src/styles/*
 * is frozen/out of scope for this item) and does not depend on any other
 * component.
 *
 * Survey Folio identity: a small floating chart-index card — hairline
 * border, paper surface, mono input, results rendered as compact
 * gazetteer-style rows. Built on the frozen contract's `.palette` render
 * vocabulary class family (CSS.palette, the swatch/legend-row class) the
 * same way Gazetteer builds `gazetteer-row` -> `gazetteer__*` extension
 * classes: this component's own `palette__*` modifiers extend it into a
 * command-palette card, using ONLY tokens.css custom properties for color,
 * type, spacing, and motion.
 *
 * ---------------------------------------------------------------------
 * WIRING (App.tsx owns this — CommandPalette.tsx is out of scope for this
 * item's file set, so App.tsx is NOT edited here; the conductor applies
 * the two lines below). Two-line adoption:
 *
 *   const { open, setOpen } = useCommandPalette();
 *   <CommandPalette repos={snapshot?.repos ?? []} open={open} onClose={() => setOpen(false)} onNavigate={openRepo} />
 *
 * `openRepo` is App.tsx's existing `(repoId: string) => void` hash-router
 * callback (already used by Overview/Gazetteer onSelect). See
 * src/components/paletteWiring.md for the fuller walkthrough.
 * ---------------------------------------------------------------------
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CSS } from '../../shared/contract.js';

/** Minimal structural view of a RepoSummary — id/name/path is all a jump needs. */
export interface RepoSummary {
  id: string;
  name: string;
  path: string;
}

export interface CommandPaletteProps {
  /** The fixture repo set to search over (Snapshot.repos, or a subset). */
  repos: RepoSummary[];
  /** Controlled open state — App.tsx supplies this from useCommandPalette(). */
  open: boolean;
  /** Fired on Escape, backdrop click, or after a successful navigate. */
  onClose: () => void;
  /** Fired with the chosen repo's id; caller is responsible for routing. */
  onNavigate: (repoId: string) => void;
}

interface ScoredRepo {
  repo: RepoSummary;
  score: number;
}

/**
 * Simple subsequence fuzzy score, no dependencies. Returns `null` when
 * `query`'s characters do not all appear in `target`, in order
 * (case-insensitive). Higher scores are better matches: consecutive runs
 * and early-string hits are rewarded, and longer targets are very mildly
 * penalized so a tight exact-ish match outranks a loose one buried in a
 * longer string.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return 0;

  let score = 0;
  let searchFrom = 0;
  let streak = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], searchFrom);
    if (idx === -1) return null;

    if (idx === searchFrom) {
      streak += 1;
      score += 2 + streak; // consecutive-match bonus grows with streak length
    } else {
      streak = 0;
      score += 1;
    }
    if (idx === 0) score += 3; // bonus for matching right at the start

    searchFrom = idx + 1;
  }

  score -= (t.length - q.length) * 0.01; // mild penalty for excess length
  return score;
}

/**
 * Rank `repos` against `query` by fuzzy-matching "name path" as one
 * haystack. Non-matches are dropped; ties fall back to name so results are
 * a stable total order for a given input.
 */
export function rankRepos(repos: RepoSummary[], query: string): RepoSummary[] {
  const all = Array.isArray(repos) ? repos : [];
  if (query.trim().length === 0) {
    return all.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  const scored: ScoredRepo[] = [];
  for (const repo of all) {
    const haystack = `${repo.name} ${repo.path}`;
    const score = fuzzyScore(query, haystack);
    if (score !== null) scored.push({ repo, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.repo.name.localeCompare(b.repo.name);
  });

  return scored.map((entry) => entry.repo);
}

/**
 * useCommandPalette — owns the global Cmd+K / Ctrl+K keydown listener and
 * the palette's open state. Exported so the shell can adopt the palette
 * with two lines (see the file-header comment above). Pressing Cmd+K (or
 * Ctrl+K, for non-Mac keyboards) toggles the palette open/closed;
 * preventDefault stops the browser's own bindings (e.g. Firefox's "quick
 * find") from firing alongside it.
 */
export function useCommandPalette(): { open: boolean; setOpen: (open: boolean) => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key?.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { open, setOpen };
}

export function CommandPalette({ repos, open, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => rankRepos(repos, query), [repos, query]);

  // Reset to a clean slate every time the palette opens. The input itself
  // carries `autoFocus` (below) — the component unmounts entirely while
  // closed (see the `if (!open) return null` guard), so a fresh mount is
  // exactly the moment autoFocus fires; no imperative focus() needed here.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Keep the active row in range as results narrow.
  useEffect(() => {
    setActiveIndex((current) => {
      if (results.length === 0) return 0;
      return Math.min(current, results.length - 1);
    });
  }, [results.length]);

  if (!open) return null;

  function choose(repoId: string) {
    onNavigate(repoId);
    onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : Math.min(current + 1, results.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : Math.max(current - 1, 0)));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[activeIndex];
      if (chosen) choose(chosen.id);
    }
  }

  return (
    <div
      className="palette-cmdk__backdrop"
      data-testid="palette-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Self-contained styling: tokens.css vars only, no new stylesheet file
          (src/styles/* is frozen/out of scope for this item). */}
      <style>{PALETTE_STYLES}</style>
      <div
        className={`${CSS.plate} palette-cmdk`}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to repository"
      >
        <div className={`${CSS.palette} palette-cmdk__legend`}>
          <span className="palette__label">Jump to repository</span>
          <span className="palette__label palette-cmdk__hint">Esc to close</span>
        </div>
        <input
          ref={inputRef}
          type="text"
          className={`palette-cmdk__input ${CSS.sounding}`}
          placeholder="repo name or path…"
          aria-label="Search repositories to jump to"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-cmdk__results" role="listbox" aria-label="Matching repositories">
          {results.map((repo, index) => (
            <div
              key={repo.id}
              role="option"
              aria-selected={index === activeIndex}
              data-repo-id={repo.id}
              className={`${CSS.gazetteerRow} palette-cmdk__row${
                index === activeIndex ? ' palette-cmdk__row--active' : ''
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(repo.id)}
            >
              <span className="palette-cmdk__row-name">{repo.name}</span>
              <span className={`palette-cmdk__row-path ${CSS.sounding}`}>{repo.path}</span>
            </div>
          ))}
          {results.length === 0 && (
            <p className="palette-cmdk__empty">No repository answers to “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Scoped styles for the palette card. Every color/space/type value comes
 * from a tokens.css custom property — nothing here is a bespoke hex or
 * pixel value, per the frozen render-vocabulary contract.
 */
const PALETTE_STYLES = `
.palette-cmdk__backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ink) 40%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: var(--space-7);
  z-index: 1000;
}
.palette-cmdk {
  width: min(32rem, calc(100vw - var(--space-6)));
  max-height: min(28rem, calc(100vh - var(--space-7) * 2));
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  gap: var(--space-3);
}
.palette-cmdk__legend {
  justify-content: space-between;
}
.palette-cmdk__hint {
  color: var(--ink-faint);
}
.palette-cmdk__input {
  width: 100%;
  box-sizing: border-box;
  background: var(--paper-sunken);
  border: var(--hairline) solid var(--rule);
  color: var(--ink);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-md);
  outline: none;
}
.palette-cmdk__input:focus {
  border-color: var(--rule-strong);
}
.palette-cmdk__results {
  overflow-y: auto;
}
.palette-cmdk__row {
  cursor: pointer;
  justify-content: space-between;
}
.palette-cmdk__row--active {
  background: var(--paper-sunken);
}
.palette-cmdk__row-name {
  color: var(--ink);
}
.palette-cmdk__row-path {
  color: var(--ink-muted);
}
.palette-cmdk__empty {
  color: var(--ink-faint);
  font-size: var(--text-sm);
  padding: var(--space-2) 0;
}
`;

export default CommandPalette;
