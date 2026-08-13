/**
 * RepoDetail.test.tsx — mount tests for the per-repo drill-down view.
 *
 * Mounts on fixture repos from shared/fixtures.js (the ONE canonical
 * snapshot used across the codebase). Asserts:
 *   - per-repo scoping: a day present only in ANOTHER repo's commitDays
 *     never renders as a filled cell here
 *   - the no-remote chip never says "unpushed"
 *   - the current branch is marked
 *   - all five plates are captioned
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RepoDetail } from './RepoDetail.tsx';
import { CSS, dayKey } from '../../shared/contract.js';
import { fixtureSnapshot, fixtureRepo } from '../../shared/fixtures.js';

describe('RepoDetail', () => {
  it('renders all five captioned plates, in order', () => {
    const repo = fixtureRepo('ember-ledger');
    const { container } = render(<RepoDetail repo={repo} onBack={() => {}} />);

    const plates = container.querySelectorAll(`.${CSS.plate}`);
    expect(plates.length).toBe(5);

    const captions = Array.from(container.querySelectorAll(`.${CSS.plateCaption}`)).map(
      (node) => node.textContent,
    );
    expect(captions).toEqual([
      'Fig. 6Commit Soundings',
      'Fig. 7Strata of the Codebase',
      'Fig. 8Ship\'s Log',
      'Fig. 9Recent Workings',
      'Fig. 10Charted Branches',
    ]);

    // Plate wraps every section with an aria-label "Fig. N — Caption".
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
