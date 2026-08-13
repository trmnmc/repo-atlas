# SPEC — Repo Atlas

<!-- Instantiated at kickoff 2026-08-13. Frozen after user confirmation. -->

## Idea

A local mission-control dashboard for everything under `~/Projects`. A small Node
server scans every git repo and serves a Vite + React SPA that leads with *what
needs attention* (dirty trees, unpushed commits, stale projects), backed by
activity heatmaps, a timeline, and per-repo drill-down.

## Audience

Truman — a solo dev with dozens of local repos in varying states of activity.

## Must-haves

<!-- The PLAN gate holds until every box below is covered by a backlog item.
     Checked off only after conductor verification, never by claim. -->

- [ ] Auto-scan all git repos under ~/Projects (depth-limited, skips node_modules): name, path, branch, dirty status, ahead/behind of local tracking ref, last-commit date, commit history, language/LOC breakdown
- [ ] Attention-first overview + activity views: ranked attention queue (dirty tree, unpushed commits, stale >90 days) on top; GitHub-style 12-month commit heatmap and activity timeline (aggregate + per-repo) below
- [ ] Per-project drill-down: languages, LOC, recent commits, last-touched files, branch list
- [ ] Live refresh: rescan endpoint + UI button; data updates without restarting the server

## Nice-to-haves

- Search/filter/sort (activity, size, staleness)
- Dark/light theme
- Aggregate stats row (total repos, commits this month, most-active repo)
- Keyboard navigation

## Non-goals

- No network/GitHub API — local git data only; ahead/behind from local tracking refs, never fetch
- No database — scan on demand, JSON cache on disk
- Read-only — no git operations from the UI (v2 escape hatch: open-in-editor/terminal actions)
- No auth / multi-user

## Taste notes

Hand-rolled SVG charts (no chart library). Information-dense but calm; restrained
palette; not a generic admin template. Fast: cached load < 2s, full rescan async
with progress. The first screen answers "what needs my attention", not commit
wallpaper.

## Domain rules

- Heatmap counts = commits per day, bucketed by author date in local timezone.
- Dirty = any staged, unstaged, or untracked change (`git status --porcelain` non-empty).
- Stale = last commit author date > 90 days before now.
- Unpushed = ahead-count > 0 vs the local upstream tracking ref; repos with no upstream are "no remote", never "unpushed".
- LOC breakdown = classify by file extension; exclude node_modules, dist, .git, vendored dirs.
- Attention queue rank: dirty first, then unpushed, then stale; ties broken by most-recent activity.
- All of the above are hand-computable against a fixture repo set without reading app code.

## Definition of done

`npm start` serves the dashboard at http://localhost:4600; every git repo under
~/Projects is listed with correct branch/dirty/last-commit; heatmap + timeline
render from real commit data; per-repo drill-down works; Rescan updates data
without restart; `npm test` (vitest, non-interactive) green, including
component-mount tests for every exported hook.

## Commands

- run: `npm start`
- test: `npm test`

## Spec digest

- Local mission-control for ~/Projects: Node scanner + Vite/React SPA on :4600; attention queue first, then heatmap/timeline/drill-down.
- Must-haves: auto-scan git repos, attention+activity views, per-repo drill-down, live rescan without restart.
- Non-goals: no network/GitHub API, no DB, read-only UI, no auth.
- Taste: hand-rolled SVG, dense-but-calm, fast; QA hand-computes expected outputs from Domain rules against fixture repos.
