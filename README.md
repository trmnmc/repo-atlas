# Repo Atlas

A local mission-control for `~/Projects`: a plain-Node scanner surveys every
git repository it can find, and a small Vite/React folio renders the result —
attention first, activity soundings after.

## Quick start

```
npm install
npm start
```

`npm start` builds the folio and starts the server at
**http://localhost:4600**. The first survey of `~/Projects` takes roughly
**60–90 seconds** — the page loads immediately and fills in once the scan
lands, so there is no blank wait once you're past that first boot. Every
scan after the first reads the on-disk cache instantly and then quietly
rescans in the background; a **Rescan** control in the folio also triggers
one on demand.

```
npm test
```

Runs the full suite (`vitest run`) — shared contract, server, and component
tests, non-interactive.

## The Folio

The overview is five numbered plates, in the order the product argues its
case — attention before wallpaper:

- **Fig. 1 — Notices to Mariners.** The attention queue: dirty trees, then
  unpushed commits, then charts gone stale, server-ranked. This is the
  first thing on the page, above the heatmap, on purpose.
- **Fig. 2 — Commit Soundings.** A 12-month heatmap, aggregated across every
  repo. Click a day to narrow Fig. 3 to it; click it again to clear.
- **Fig. 3 — The Year's Passage.** A weekly activity timeline, cross-filtered
  by whatever day Fig. 2 has selected.
- **Fig. 4 — Legend & Reckonings.** Aggregate stats: repo count, commits,
  most-active repo.
- **Fig. 5 — Gazetteer of Repositories.** Every repo, one row each, searchable
  and sortable by name, activity, or total lines of code. This table never
  truncates — it is the completeness guarantee for the whole atlas.

Selecting a repo (from the attention queue, the gazetteer, or the command
palette) opens its drill-down: five more plates, Fig. 6–10, scoped to that
one repository alone — its own heatmap + timeline (Fig. 6), a lines-of-code
breakdown by language (Fig. 7), the recent commit log (Fig. 8), last-touched
files (Fig. 9), and the branch list (Fig. 10).

Two ways to move around without a mouse: **⌘K** opens a fuzzy repo-jump
palette; **j**/**k** (or the arrow keys) walk the active list one row at a
time, with **Enter** to open — both ignore keystrokes while a text field has
focus. A theme toggle in the masthead switches light/dark and remembers the
choice (and otherwise follows the system preference on first load).

## How it surveys

The server is plain Node (`server/index.js`) — zero framework, zero build
step for the server side itself; only the SPA goes through Vite. It talks to
git exclusively through `execFile` (argv arrays, never a shell string), and
every invocation is individually guarded so a repo in a strange state (no
commits, no upstream, detached HEAD) degrades to a partial result instead of
taking the scan down.

Discovery walks `~/Projects` looking for a `.git` entry (directory or file —
linked worktrees use a file), pruning `node_modules`, `dist`, `build`,
`.git`, `vendor`, `.next`, `target`, and `coverage` at readdir time — those
directories are never entered, so a vendored decoy repo under
`node_modules` is never discovered and a monster `node_modules` costs
nothing. The walk stops descending once it finds a repo (no nested-repo
double counting) and never goes deeper than a fixed depth below the root.

Lines of code are classified by file extension (JavaScript, TypeScript,
Python, Go, Rust, CSS, Markdown, and so on — unknown extensions aren't
counted), with the same directory pruning applied, a per-file size cap, and
a per-repo file-count cap so one oversized repo can't stall the survey.

Attention rules, in priority order:

1. **dirty** — `git status --porcelain` is non-empty.
2. **unpushed** — a tracked upstream with commits ahead of it. A repo with
   no upstream is never "unpushed" — it has nowhere to push to, and reads
   as an informational "no remote" marker instead.
3. **stale** — the last commit's author date is *strictly* more than 90 days
   before the survey's timestamp; exactly 90 days is not yet stale.

A repo can carry more than one reason, but the attention queue shows only
its strongest one; ties within a reason break by most-recent activity.
Commit-day bucketing (for the heatmaps) uses the author date's **local
timezone** calendar day, not UTC — a late-night commit doesn't drift onto
the wrong day.

## Organize

```
npm run organize -- [--root <dir>] [--stale-days <n>] [--dry-run]
```

Surveys the top level of `~/Projects` (plain folders count, not only git
repos), gives every project a theme from `~/Projects/projects.json` and a
status — `active`, `paused`, `stale`, `empty`, or `unknown` — then walks
you through three rounds of questions: a theme for each unsorted folder,
archive/keep/skip for each stale project, and the same for empty folders.
One final `y` applies the queued moves into `Outdated/archived-projects/`
or `Outdated/empties/`, each logged in `Outdated/MOVES.log`. It then writes
`PROJECTS.md` (the complete map) and a short block in `CLAUDE.md` for
coding agents. Stale means the later of last commit and newest file time
is strictly more than 90 days old. `--dry-run` prints the report and
writes nothing. Keep answers are remembered in `projects.json`; remove a
name from `paused` to be asked again. The command never deletes, never
moves an active project, and never touches loose files. Run it from a
terminal for normal use. From a script, an agent, or cron, run it with
`--dry-run`. When stdin is not interactive, the tool skips every prompt
and only refreshes the index files. Design:
`docs/superpowers/specs/2026-09-20-organize-projects-design.md`.

## Boundaries

Repo Atlas is **read-only** and **local-git-only**. It never fetches from a
remote, never calls a GitHub/GitLab API, and issues no git write commands —
everything it knows comes from local plumbing (`status`, `log`,
`for-each-ref`, `rev-list @{u}...HEAD`) against what's already on disk.
There's no database: a scan's result is cached as JSON at
`.atlas-cache.json` next to the project root and served from there until
the next scan replaces it. There's no auth — this is a single-user tool
meant to run on `localhost` for the person who owns the machine.

## Development

```
npm run dev     # Vite dev server, hot module reload
npm test        # vitest run — shared/server/component suites
npm run build   # production build of the SPA into dist/
```

The seam between the server and the SPA is `shared/contract.js` — a frozen,
dependency-free ESM module (typedefs, route names, the attention comparator,
the day-bucketing rule, staleness math, and the render-vocabulary class
names) that both sides import directly, so the two halves of the product can
never drift out of shape with each other. Vitest runs with `TZ` pinned to
`America/Chicago` so timezone-sensitive assertions are reproducible on any
machine.
