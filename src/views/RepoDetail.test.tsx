/**
 * RepoDetail.test.tsx — mount tests for the per-repo drill-down view.
 *
 * Mounts on fixture repos from shared/fixtures.js (the ONE canonical
 * snapshot used across the codebase). Asserts:
 *   - per-repo scoping: a day present only in ANOTHER repo's commitDays
 *     never renders as a filled cell here
 *   - the no-remote chip never says "unpushed"
 *   - the current branch is marked
 *   - every plate is captioned (five for a clean repo; a dirty repo also
 *     gets Fig. 9a — Unlogged Cargo between Fig. 8 and Fig. 9)
 *   - Fig. 9a answers WHAT is dirty: staged / modified / untracked files
 *     with per-group counts, and the header badge counts them too
 *
 * The canonical fixture is FROZEN and predates repo.workingTree, so the
 * Fig. 9a cases build local repos by spreading a fixture repo and injecting
 * a workingTree of exactly the server's shape:
 *   { staged: string[], modified: string[], untracked: string[],
 *     truncated: boolean }
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RepoDetail } from './RepoDetail.tsx';
import { CSS, dayKey } from '../../shared/contract.js';
import { fixtureSnapshot, fixtureRepo } from '../../shared/fixtures.js';

const CARGO_LABEL = 'Fig. 9a — Unlogged Cargo';

/** The cargo plate, or null when the view rendered none. */
function cargoPlate(container: HTMLElement) {
  return container.querySelector(`[aria-label="${CARGO_LABEL}"]`);
}

/** Rendered paths of one cargo group, in DOM order. */
function groupPaths(container: HTMLElement, group: string) {
  return Array.from(
    container.querySelectorAll(`[data-cargo-group="${group}"] .cargo-file__path`),
  ).map((node) => node.textContent);
}

/** Rendered count text of one cargo group. */
function groupCount(container: HTMLElement, group: string) {
  return container
    .querySelector(`[data-cargo-group="${group}"] .cargo-group__count`)
    ?.textContent;
}

describe('RepoDetail', () => {
  it('renders every captioned plate, in order (dirty repo: Fig. 9a sits between 8 and 9)', () => {
    const repo = fixtureRepo('ember-ledger');
    expect(repo.dirty).toBe(true);
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    const plates = container.querySelectorAll(`.${CSS.plate}`);
    expect(plates.length).toBe(6);

    const captions = Array.from(container.querySelectorAll(`.${CSS.plateCaption}`)).map(
      (node) => node.textContent,
    );
    expect(captions).toEqual([
      'Fig. 6Commit Soundings',
      'Fig. 7Strata of the Codebase',
      'Fig. 8Ship\'s Log',
      'Fig. 9aUnlogged Cargo',
      'Fig. 9Recent Workings',
      'Fig. 10Charted Branches',
    ]);

    // Plate wraps every section with an aria-label "Fig. N — Caption".
    const ariaLabels = Array.from(plates).map((node) => node.getAttribute('aria-label'));
    expect(ariaLabels).toEqual([
      'Fig. 6 — Commit Soundings',
      'Fig. 7 — Strata of the Codebase',
      'Fig. 8 — Ship\'s Log',
      CARGO_LABEL,
      'Fig. 9 — Recent Workings',
      'Fig. 10 — Charted Branches',
    ]);
  });

  it('renders exactly the five committed-history plates for a clean repo', () => {
    const repo = fixtureRepo('meridian');
    expect(repo.dirty).toBe(false);
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    const plates = container.querySelectorAll(`.${CSS.plate}`);
    expect(plates.length).toBe(5);
    const ariaLabels = Array.from(plates).map((node) => node.getAttribute('aria-label'));
    expect(ariaLabels).toEqual([
      'Fig. 6 — Commit Soundings',
      'Fig. 7 — Strata of the Codebase',
      'Fig. 8 — Ship\'s Log',
      'Fig. 9 — Recent Workings',
      'Fig. 10 — Charted Branches',
    ]);
  });

  it('renders the repo name and header', () => {
    const repo = fixtureRepo('ember-ledger');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    expect(container.querySelector('.repo-detail__name')?.textContent).toBe('ember-ledger');
    expect(container.querySelector('.repo-detail__branch')?.textContent).toBe('main');
  });

  /* ----------------------------------------------------------------
     Per-repo scoping — the acceptance criterion's core claim
     ----------------------------------------------------------------

     By hand (verified against shared/fixtures.js via node):
       meridian.commitDays['2025-08-03'] === 5   (nonzero)
       ember-ledger.commitDays has NO '2025-08-03' key (absent -> 0)
     ember-ledger's own heatmap window (endDayKey = its lastCommit day,
     2026-07-31) spans back 53 weeks to 2025-07-27, so 2025-08-03 falls
     inside the rendered grid — meaning if the view ever fed a MERGED
     cross-repo map into Heatmap, this cell would render filled. Fed only
     ember-ledger's own commitDays, it must render level 0 (empty).
     ---------------------------------------------------------------- */
  it('scopes the heatmap to this repo only: another repo\'s commit day never fills a cell here', () => {
    const meridian = fixtureRepo('meridian');
    const ember = fixtureRepo('ember-ledger');
    expect(meridian.commitDays['2025-08-03']).toBe(5);
    expect(ember.commitDays['2025-08-03']).toBeUndefined();

    const { container } = render(<RepoDetail repo={ember} onBack={() => {}} />);
    const cell = container.querySelector('[data-daykey="2025-08-03"]');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-count')).toBe('0');
    expect(cell?.classList.contains(`${CSS.heatmapCell}--l0`)).toBe(true);
    expect(cell?.classList.contains(`${CSS.heatmapCell}--l4`)).toBe(false);
  });

  it('scopes the timeline to this repo only: rendered weekly totals never exceed this repo\'s own commit count', () => {
    // field-notes has sparse, entirely different commitDays than
    // ember-ledger. If the view ever fed a merged/cross-repo map into
    // Timeline, the rendered stem totals would sum to more than
    // field-notes' own commitDays total. Fed only field-notes' own data,
    // they must sum to exactly that.
    const fieldNotes = fixtureRepo('field-notes');
    const expectedTotal = Object.values(fieldNotes.commitDays).reduce((a, b) => a + b, 0);

    const { container } = render(<RepoDetail repo={fieldNotes} onBack={() => {}} />);
    const stems = container.querySelectorAll('.chart-timeline__stem');
    const renderedTotal = Array.from(stems).reduce(
      (sum, stem) => sum + Number(stem.getAttribute('data-total') ?? 0),
      0,
    );
    expect(renderedTotal).toBe(expectedTotal);
  });

  it('scopes the strata chart to this repo\'s own loc only', () => {
    const tideTables = fixtureRepo('tide-tables');
    const { container } = render(<RepoDetail repo={tideTables} onBack={() => {}} />);
    const bands = container.querySelectorAll('.chart-strata__bar > g > .strata-band');
    const languages = Array.from(bands).map((b) => b.getAttribute('data-language'));
    expect(languages).toEqual(['Python', 'Markdown']);
  });

  /* ----------------------------------------------------------------
     Upstream chip
     ---------------------------------------------------------------- */
  it('shows a no-remote chip for a repo with no upstream, and it never says "unpushed"', () => {
    const driftBottle = fixtureRepo('drift-bottle');
    expect(driftBottle.upstream.state).toBe('none');

    const { container } = render(<RepoDetail repo={driftBottle} onBack={() => {}} />);
    const chip = container.querySelector(`.${CSS.advisoryNoRemote}`);
    expect(chip).not.toBeNull();
    expect(chip?.textContent?.toLowerCase()).not.toContain('unpushed');
    expect(container.querySelector(`.${CSS.advisoryUnpushed}`)).toBeNull();
  });

  it('shows ahead/behind counts for a tracked, unpushed repo', () => {
    const tideTables = fixtureRepo('tide-tables');
    expect(tideTables.upstream).toEqual({ state: 'tracked', aheadBy: 3, behindBy: 0 });

    const { container } = render(<RepoDetail repo={tideTables} onBack={() => {}} />);
    const chip = container.querySelector(`.${CSS.advisoryUnpushed}`);
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('3');
    expect(container.querySelector(`.${CSS.advisoryNoRemote}`)).toBeNull();
  });

  it('shows a neutral in-sync chip for a tracked, up-to-date repo (no attention class)', () => {
    const meridian = fixtureRepo('meridian');
    expect(meridian.upstream).toEqual({ state: 'tracked', aheadBy: 0, behindBy: 0 });

    const { container } = render(<RepoDetail repo={meridian} onBack={() => {}} />);
    expect(container.querySelector(`.${CSS.advisoryUnpushed}`)).toBeNull();
    expect(container.querySelector(`.${CSS.advisoryNoRemote}`)).toBeNull();
    expect(container.querySelector('.detail-chip')?.textContent).toContain('in sync');
  });

  /* ----------------------------------------------------------------
     Dirty badge
     ---------------------------------------------------------------- */
  it('shows a dirty badge via the contract advisoryClass for a dirty repo, none for a clean one', () => {
    const dirtyRepo = fixtureRepo('ember-ledger');
    expect(dirtyRepo.dirty).toBe(true);
    const { container: dirtyContainer } = render(<RepoDetail repo={dirtyRepo} onBack={() => {}} />);
    expect(dirtyContainer.querySelector(`.${CSS.advisoryDirty}`)).not.toBeNull();

    const cleanRepo = fixtureRepo('meridian');
    expect(cleanRepo.dirty).toBe(false);
    const { container: cleanContainer } = render(<RepoDetail repo={cleanRepo} onBack={() => {}} />);
    expect(cleanContainer.querySelector(`.${CSS.advisoryDirty}`)).toBeNull();
  });

  /* ----------------------------------------------------------------
     Fig. 9a — Unlogged Cargo: WHAT is dirty
     ---------------------------------------------------------------- */
  it('lists staged, modified and untracked files with per-group counts for a dirty repo', () => {
    const repo = {
      ...fixtureRepo('ember-ledger'),
      workingTree: {
        staged: ['src/ledger.ts', 'src/accounts.ts'],
        modified: ['src/ledger.ts', 'README.md', 'src/rollover.ts'],
        untracked: ['notes/scratch.md'],
        truncated: false,
      },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    const plate = cargoPlate(container);
    expect(plate).not.toBeNull();

    expect(groupPaths(container, 'staged')).toEqual(['src/ledger.ts', 'src/accounts.ts']);
    expect(groupPaths(container, 'modified')).toEqual([
      'src/ledger.ts',
      'README.md',
      'src/rollover.ts',
    ]);
    expect(groupPaths(container, 'untracked')).toEqual(['notes/scratch.md']);

    expect(groupCount(container, 'staged')).toBe('2');
    expect(groupCount(container, 'modified')).toBe('3');
    expect(groupCount(container, 'untracked')).toBe('1');

    // Each group is captioned by its own name.
    const labels = Array.from(
      container.querySelectorAll('.cargo-group__label'),
    ).map((node) => node.textContent);
    expect(labels).toEqual(['staged', 'modified', 'untracked']);

    // No truncation note when the manifest is complete, and no stale line.
    expect(container.querySelector('.cargo-truncated')).toBeNull();
    expect(container.querySelector('.cargo-stale')).toBeNull();
  });

  it('shows a file that is both staged and modified in BOTH groups', () => {
    const repo = {
      ...fixtureRepo('ember-ledger'),
      workingTree: {
        staged: ['src/ledger.ts'],
        modified: ['src/ledger.ts'],
        untracked: [],
        truncated: false,
      },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    expect(groupPaths(container, 'staged')).toEqual(['src/ledger.ts']);
    expect(groupPaths(container, 'modified')).toEqual(['src/ledger.ts']);
    // An empty group is omitted entirely rather than rendered as a zero.
    expect(container.querySelector('[data-cargo-group="untracked"]')).toBeNull();
  });

  it('renders the truncation note when the server capped the manifest', () => {
    const repo = {
      ...fixtureRepo('field-notes'),
      workingTree: {
        staged: [],
        modified: Array.from({ length: 50 }, (_, i) => `notes/entry-${i}.md`),
        untracked: [],
        truncated: true,
      },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    expect(groupPaths(container, 'modified').length).toBe(50);
    expect(groupCount(container, 'modified')).toBe('50');
    expect(container.querySelector('.cargo-truncated')?.textContent).toBe(
      '(list truncated at 50)',
    );
  });

  it('falls back to a rescan line when a dirty repo carries no workingTree (stale cache)', () => {
    const repo = fixtureRepo('ember-ledger');
    expect(repo.dirty).toBe(true);
    expect(repo.workingTree).toBeUndefined();

    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    expect(cargoPlate(container)).not.toBeNull();
    expect(container.querySelector('.cargo-stale')?.textContent).toBe(
      'uncommitted work aboard — rescan for the manifest',
    );
    expect(container.querySelector('.cargo-group')).toBeNull();
  });

  it('falls back to the rescan line when a dirty repo carries an empty workingTree', () => {
    const repo = {
      ...fixtureRepo('ember-ledger'),
      workingTree: { staged: [], modified: [], untracked: [], truncated: false },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    expect(cargoPlate(container)).not.toBeNull();
    expect(container.querySelector('.cargo-stale')).not.toBeNull();
    expect(container.querySelector('.cargo-group')).toBeNull();
  });

  it('renders no Unlogged Cargo plate for a clean repo, even if a workingTree is attached', () => {
    const repo = {
      ...fixtureRepo('meridian'),
      workingTree: {
        staged: [],
        modified: ['src/projection.ts'],
        untracked: [],
        truncated: false,
      },
    };
    expect(repo.dirty).toBe(false);
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    expect(cargoPlate(container)).toBeNull();
    expect(container.querySelector('.cargo-group')).toBeNull();
    expect(container.querySelector('.cargo-stale')).toBeNull();
  });

  it('keeps vermilion attention-only: cargo file paths carry no advisory class', () => {
    const repo = {
      ...fixtureRepo('ember-ledger'),
      workingTree: {
        staged: [],
        modified: ['src/ledger.ts'],
        untracked: ['notes/scratch.md'],
        truncated: false,
      },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const plate = cargoPlate(container);
    expect(plate).not.toBeNull();
    expect(plate?.querySelector(`.${CSS.advisoryDirty}`)).toBeNull();
    expect(plate?.querySelector('[class*="advisory"]')).toBeNull();
  });

  /* ----------------------------------------------------------------
     Dirty badge counts
     ---------------------------------------------------------------- */
  it('counts the working tree in the dirty header badge, omitting empty groups', () => {
    const repo = {
      ...fixtureRepo('ember-ledger'),
      workingTree: {
        staged: [],
        modified: ['src/ledger.ts', 'README.md'],
        untracked: ['notes/scratch.md'],
        truncated: false,
      },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const badge = container.querySelector(`.detail-chip.${CSS.advisoryDirty}`);
    expect(badge?.textContent).toBe('dirty — 2 modified, 1 untracked');
  });

  it('counts staged files in the dirty header badge when there are any', () => {
    const repo = {
      ...fixtureRepo('ember-ledger'),
      workingTree: {
        staged: ['src/accounts.ts'],
        modified: ['src/ledger.ts'],
        untracked: [],
        truncated: false,
      },
    };
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const badge = container.querySelector(`.detail-chip.${CSS.advisoryDirty}`);
    expect(badge?.textContent).toBe('dirty — 1 staged, 1 modified');
  });

  it('keeps the plain dirty badge when no workingTree is available', () => {
    const repo = fixtureRepo('ember-ledger');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const badge = container.querySelector(`.detail-chip.${CSS.advisoryDirty}`);
    expect(badge?.textContent).toBe('dirty');
  });

  /* ----------------------------------------------------------------
     Detached HEAD
     ---------------------------------------------------------------- */
  it('renders a detached-HEAD repo by its abbreviated sha, not as a branch name', () => {
    const detachedRepo = { ...fixtureRepo('meridian'), detached: true, branch: 'a1b2c3d' };
    const { container } = render(<RepoDetail repo={detachedRepo} onBack={() => {}} />);
    expect(container.querySelector('.repo-detail__branch')?.textContent).toBe('detached @ a1b2c3d');
  });

  /* ----------------------------------------------------------------
     Branch list
     ---------------------------------------------------------------- */
  it('marks the current branch and lists tip dates for every branch', () => {
    const repo = fixtureRepo('meridian');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const rows = container.querySelectorAll('.branch-list__row');
    expect(rows.length).toBe(repo.branches.length);

    const current = container.querySelector('.branch-list__row--current');
    expect(current).not.toBeNull();
    expect(current?.getAttribute('data-current')).toBe('true');
    expect(current?.textContent).toContain('main');
    expect(current?.querySelector('.branch-list__marker')?.textContent).not.toBe('');

    rows.forEach((row, i) => {
      expect(row.querySelector(`.${CSS.sounding}`)?.textContent).toBe(repo.branches[i].lastCommitIso);
    });

    const nonCurrent = container.querySelectorAll('.branch-list__row:not(.branch-list__row--current)');
    nonCurrent.forEach((row) => {
      expect(row.querySelector('.branch-list__marker')?.textContent).toBe('');
    });
  });

  /* ----------------------------------------------------------------
     Commit log
     ---------------------------------------------------------------- */
  it('lists recent commits with iso date, subject, and author', () => {
    const repo = fixtureRepo('ember-ledger');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const rows = container.querySelectorAll('.commit-log__row');
    expect(rows.length).toBe(repo.recentCommits.length);
    rows.forEach((row, i) => {
      const commit = repo.recentCommits[i];
      expect(row.querySelector('.commit-log__date')?.textContent).toBe(commit.iso);
      expect(row.querySelector('.commit-log__subject')?.textContent).toBe(commit.subject);
      expect(row.querySelector('.commit-log__author')?.textContent).toBe(commit.author);
    });
  });

  /* ----------------------------------------------------------------
     Touched files
     ---------------------------------------------------------------- */
  it('lists last-touched files with path and last-changed date', () => {
    const repo = fixtureRepo('tide-tables');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);
    const rows = container.querySelectorAll('.touched-files__row');
    expect(rows.length).toBe(repo.touchedFiles.length);
    rows.forEach((row, i) => {
      const file = repo.touchedFiles[i];
      expect(row.querySelector('.touched-files__path')?.textContent).toBe(file.path);
      expect(row.querySelector('.touched-files__date')?.textContent).toBe(file.lastIso);
    });
  });

  /* ----------------------------------------------------------------
     Local day-click filter wire
     ---------------------------------------------------------------- */
  it('wires Heatmap day clicks to the Timeline filter, locally within the view', () => {
    const repo = fixtureRepo('ember-ledger');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    expect(container.querySelector('svg[data-filter-day]')?.getAttribute('data-filter-day')).toBe('');

    const cell = container.querySelector('[data-daykey="2026-01-22"]');
    expect(cell).not.toBeNull();
    fireEvent.click(cell);

    const timelineSvg = container.querySelector('.chart-timeline');
    expect(timelineSvg?.getAttribute('data-filter-day')).toBe('2026-01-22');
  });

  /* ----------------------------------------------------------------
     Back navigation
     ---------------------------------------------------------------- */
  it('invokes onBack when the back control is activated', () => {
    const onBack = vi.fn();
    const repo = fixtureRepo('ember-ledger');
    const { container } = render(<RepoDetail repo={repo} onBack={onBack} />);
    const back = container.querySelector('.repo-detail__back');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
