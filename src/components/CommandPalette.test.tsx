/**
 * CommandPalette.test.tsx — mount tests for the Cmd+K fuzzy repo-jump
 * palette and its companion useCommandPalette() hook.
 *
 * Fixture repos are local to this file (not shared/fixtures.js) so the
 * fuzzy-match fixtures can be hand-picked: `ember-ledger` is the only
 * repo whose name+path contains "ember" as a subsequence, and
 * `swarm-orchestrator` is the only one containing "swm" as a subsequence
 * (none of the others have a "w" at all) — so query -> expected match is
 * unambiguous in every test below.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  CommandPalette,
  fuzzyScore,
  rankRepos,
  useCommandPalette,
} from './CommandPalette.tsx';
import type { RepoSummary } from './CommandPalette.tsx';

const REPOS: RepoSummary[] = [
  { id: 'ember-ledger', name: 'ember-ledger', path: '/Users/x/Projects/ember-ledger' },
  { id: 'swarm-orchestrator', name: 'swarm-orchestrator', path: '/Users/x/Projects/swarm-orchestrator' },
  { id: 'field-notes', name: 'field-notes', path: '/Users/x/Projects/field-notes' },
  { id: 'tide-tables', name: 'tide-tables', path: '/Users/x/Projects/tide-tables' },
];

/* ------------------------------------------------------------------
   fuzzyScore / rankRepos — pure logic
   ------------------------------------------------------------------ */

describe('fuzzyScore', () => {
  it('matches a subsequence and returns null for a non-subsequence', () => {
    expect(fuzzyScore('swm', 'swarm-orchestrator')).not.toBeNull();
    expect(fuzzyScore('zzz', 'swarm-orchestrator')).toBeNull();
  });

  it('scores a tighter/earlier match higher than a looser one', () => {
    const tight = fuzzyScore('ember', 'ember-ledger');
    const loose = fuzzyScore('ember', 'x-e-m-b-e-r-loose-string-that-is-much-longer');
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight as number).toBeGreaterThan(loose as number);
  });
});

describe('rankRepos', () => {
  it('narrows to only repos whose name+path contains the query as a subsequence', () => {
    const matched = rankRepos(REPOS, 'swm');
    expect(matched.map((r) => r.id)).toEqual(['swarm-orchestrator']);
  });

  it('returns every repo, name-sorted, for an empty query', () => {
    const all = rankRepos(REPOS, '');
    expect(all.map((r) => r.id)).toEqual(
      REPOS.map((r) => r.id).slice().sort((a, b) => a.localeCompare(b)),
    );
  });
});

/* ------------------------------------------------------------------
   useCommandPalette — the exported hook, mounted
   ------------------------------------------------------------------ */

function PaletteHost() {
  const { open, setOpen } = useCommandPalette();
  return (
    <CommandPalette
      repos={REPOS}
      open={open}
      onClose={() => setOpen(false)}
      onNavigate={() => {}}
    />
  );
}

describe('useCommandPalette', () => {
  it('mounts cleanly closed, and opens on a Cmd+K (or Ctrl+K) keydown', () => {
    render(<PaletteHost />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByRole('dialog', { name: 'Jump to repository' })).toBeTruthy();
  });

  it('also opens on Ctrl+K, and toggles closed on a second press', () => {
    render(<PaletteHost />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* ------------------------------------------------------------------
   CommandPalette — controlled component
   ------------------------------------------------------------------ */

describe('CommandPalette', () => {
  it('renders nothing while closed', () => {
    render(
      <CommandPalette repos={REPOS} open={false} onClose={() => {}} onNavigate={() => {}} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('typing narrows the results fuzzily ("swm" matches the swarm-ish repo only)', () => {
    render(<CommandPalette repos={REPOS} open onClose={() => {}} onNavigate={() => {}} />);

    const input = screen.getByRole('textbox', { name: /search repositories/i });
    fireEvent.change(input, { target: { value: 'swm' } });

    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute('data-repo-id')).toBe('swarm-orchestrator');
  });

  it('Enter navigates to the top match id and closes', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette repos={REPOS} open onClose={onClose} onNavigate={onNavigate} />);

    const input = screen.getByRole('textbox', { name: /search repositories/i });
    fireEvent.change(input, { target: { value: 'ember' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('ember-ledger');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown moves the selection before Enter picks it', () => {
    const onNavigate = vi.fn();
    render(<CommandPalette repos={REPOS} open onClose={() => {}} onNavigate={onNavigate} />);

    const input = screen.getByRole('textbox', { name: /search repositories/i });
    // Empty query -> all four repos, alphabetical: ember-ledger, field-notes,
    // swarm-orchestrator, tide-tables. Row 0 is ember-ledger; one ArrowDown
    // moves the selection to field-notes.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('field-notes');
  });

  it('Escape closes without navigating', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette repos={REPOS} open onClose={onClose} onNavigate={onNavigate} />);

    const input = screen.getByRole('textbox', { name: /search repositories/i });
    fireEvent.change(input, { target: { value: 'ember' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('clicking the backdrop closes without navigating', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette repos={REPOS} open onClose={onClose} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('palette-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('clicking a result row navigates to that repo and closes', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette repos={REPOS} open onClose={onClose} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('tide-tables'));

    expect(onNavigate).toHaveBeenCalledWith('tide-tables');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('autofocuses the search input on open', () => {
    render(<CommandPalette repos={REPOS} open onClose={() => {}} onNavigate={() => {}} />);
    const input = screen.getByRole('textbox', { name: /search repositories/i });
    expect(document.activeElement).toBe(input);
  });
});
