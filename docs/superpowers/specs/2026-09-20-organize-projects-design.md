# Organize `~/Projects` — design

Date: 2026-09-20
Status: approved in conversation, pending written review
Owner: Truman (trmnmc)

## 1. Purpose

`~/Projects` holds 104 top-level entries and 50 GB. Forty-five are git repos, 44 are plain folders, 15 are loose files. Names mix ALL-CAPS, kebab-case, and spaces. Duplicates sit next to their originals. Nothing says which projects are alive.

This design adds an `organize` command to `repo-atlas`, the local scanner that already surveys `~/Projects`. The command groups projects by theme, marks each one active, paused, or stale, proposes archive moves for stale ones, and writes an index that people and coding agents can read.

### Goals, in priority order

1. Find things fast. Every project has a theme. The index groups by theme.
2. Know what is alive. Every project has a status from a clear rule.
3. Safe ground for agents. A `CLAUDE.md` at the root gives every agent session the map and the rules.

Disk space is not a goal. Any reclaim is a side effect.

### Decisions already made

| Question | Decision |
|---|---|
| Move active projects into category folders? | No. Active projects keep their paths. Only archives move. |
| How is status decided? | A 90-day date rule proposes. The user confirms each move. Nothing moves without a yes. |
| Non-code items (Ableton projects, wavs, zips, app downloads)? | Leave in place. List them in the index. Never move them. |
| One-time or repeatable? | Repeatable. Run monthly. |
| Build fresh or extend? | Extend `repo-atlas`. It already scans this folder and already has the 90-day rule. |
| Archive destination? | Reuse the existing `Outdated/` convention: `archived-projects/`, `empties/`, `zips/`. |

## 2. Vocabulary

**Root.** `~/Projects` by default. Overridable with `--root`.

**Project.** Any directory at the top level of the root, except `Outdated` and names starting with a dot.

**Kind.** `git` when the directory contains a `.git` entry (directory or file). Otherwise `folder`.

**Loose file.** Any non-directory at the top level. Listed in the index. Never moved.

**Activity date.** The later of two signals:

- For `git` projects, the author date of the last commit.
- For every project, the newest modification time of any regular file inside it. Directory times do not count. The walk skips the scanner's pruned directories (`node_modules`, `dist`, `build`, `.git`, `vendor`, `.next`, `target`, `coverage`), ignores `.DS_Store`, and stops after 10,000 files. The same walk sums file sizes, so the size shown in reports is approximate: pruned directories and files past the cap are not counted.

When both signals are missing, the activity date is unknown.

**Stale.** Activity date is strictly more than `staleDays` before now. `staleDays` defaults to `STALE_DAYS` from `shared/contract.js`, which is 90. The `--stale-days` flag overrides it. The comparison uses the contract's `isStale`.

**Empty.** The directory's own listing has no entries other than `.DS_Store`.

**Status.** One of:

| Status | Meaning | Proposed for a move? |
|---|---|---|
| `active` | Activity within `staleDays`. | Never. |
| `paused` | Stale, but the user answered keep. Recorded in `projects.json`. | Not again, until the user removes it from `paused`. |
| `stale` | Stale and not paused. | Yes, to `Outdated/archived-projects/<name>`. |
| `empty` | Empty directory. | Yes, to `Outdated/empties/<name>`. |
| `unknown` | No activity signal, or unreadable. | Never. Shown in the report. |

**Theme.** A name from `projects.json`. `unsorted` when nothing matches.

**Duplicate notice.** Report-only. Raised when two `git` projects share a normalized remote URL, or when a name has the shape `<base> 2`, `<base>-2`, `<base>v2`, `<base>-v<n>`, or `<base> copy` and `<base>` also exists as a project.

## 3. Files at the root

Three files live at the root of `~/Projects`. The user edits one. The tool writes two.

### 3.1 `projects.json` — source of truth, user-edited

```json
{
  "themes": [
    { "name": "minecraft", "match": ["*minecraft*", "minigames*", "spore", "sushi-go-*"] },
    { "name": "roblox", "match": ["roblox*"] },
    { "name": "games", "match": ["dino-*", "fungame", "dungeons-*"] },
    { "name": "lofts", "match": ["lofts*"] },
    { "name": "finance", "match": ["fenley*", "alpaca*", "trading-*", "house-*", "bat-scanner*"] },
    { "name": "music", "match": ["music*", "* project", "studio by *"] },
    { "name": "discord", "match": ["discord*"] },
    { "name": "hardware", "match": ["ras-pi", "pi", "meta-glasses", "tailscale-*", "syncthing*", "linux-*"] },
    { "name": "writing", "match": ["*paper*", "*science*", "ideas", "business-*", "marketing", "mit-*"] },
    { "name": "ai-tools", "match": ["*claude*", "*agent*", "*-ai*", "ai-*", "swarm", "prompt-*", "skill-*", "model-*", "codex-*", "tempest", "tstack*", "repo-atlas"] }
  ],
  "overrides": {},
  "paused": {}
}
```

Rules:

- `themes` is ordered. The first theme with a matching pattern wins. Narrow themes go first and broad ones last. That is why `ai-tools` is last: its `*agent*` pattern would otherwise take `trading-agents` from `finance` and `minecraft-agents` from `minecraft`.
- A pattern is matched against the whole folder name, case-insensitive. `*` matches any run of characters. No other glob syntax.
- `overrides` maps a folder name to a theme name. Overrides win over patterns. The tool writes here when the user picks a theme for an unsorted folder.
- `paused` maps a folder name to the ISO date the user answered keep. The tool writes here.
- The file is JSON because `repo-atlas` has no runtime dependencies and keeps none.
- When the file is missing, the tool uses the map above and writes it in step 5. On `--dry-run` the map is used in memory and nothing is written. When the file is corrupt, the tool stops with a clear message and does not overwrite it.

The map above already applies two corrections from review: `liqrbox*` is not in `lofts`, and `game-genie` is not in `roblox`. Both fall to `unsorted` until the user picks.

### 3.2 `PROJECTS.md` — generated, complete

Written atomically (temp file, then rename), the same way `server/cache.js` writes the snapshot. Overwritten on every run that reaches the write step.

Layout:

```
# Projects

Generated 2026-09-20 by `npm run organize` (repo-atlas). Do not edit. Edit projects.json.

Summary: 85 projects · 64 active · 0 paused · 19 stale · 2 empty · 0 unknown · 12 unsorted

## ai-tools (24)

| Name | Kind | Status | Stack | Remote | Last activity | Description |
|---|---|---|---|---|---|---|
| CLAUDE-CREW | git | active | node | — | 2026-09-20 | Claude Crew |

## minecraft (7)
...

## unsorted (12)
...

## Outdated

### archived-projects (4)
- Alpaca-dashboard
...

### empties (7)
...

### zips (17)
...

## Loose files at the root

- BAT-Scanner 2.zip
- ssh-key
...
```

Column sources:

- Stack: top-level markers only. `package.json` → node. `pyproject.toml` or `requirements.txt` → python. `Cargo.toml` → rust. `go.mod` → go. `Package.swift` or `*.xcodeproj` → swift. `default.project.json` or `rojo.json` → roblox. `pom.xml`, `build.gradle`, `build.gradle.kts` → java. `*.als` → ableton. `index.html` → html. `CLAUDE.md` → claude-md. Several may apply.
- Remote: `git remote get-url origin`, shown as `owner/repo` for GitHub URLs, otherwise the URL as given. `—` when none.
- Last activity: the activity date as `YYYY-MM-DD` in local time, or `unknown`.
- Description: the first `# ` heading of `README.md`, else the `description` field of `package.json`, else empty.

This file never truncates. It is the complete map.

### 3.3 `CLAUDE.md` — agent hook, one generated block

Claude Code loads this file for any session under `~/Projects`. Lines outside the markers belong to the user and survive every run. The tool owns the block between the markers and keeps it near twenty lines, because every session pays for it in tokens. The counts below are examples.

```
<!-- atlas:begin — generated by `npm run organize` in repo-atlas. Edit projects.json, not this block. -->
# ~/Projects

Map of this folder: PROJECTS.md (generated, complete, grouped by theme).

Themes: ai-tools (24) · minecraft (7) · roblox (2) · games (3) · lofts (6) · finance (8) · music (6) · discord (2) · hardware (6) · writing (7) · unsorted (12)

Archive: Outdated/archived-projects/ holds retired projects. Outdated/empties/ holds empty folders. Every move is logged in Outdated/MOVES.log.

Rules for agents:
- Each project's own README.md or CLAUDE.md is its entry point. Start there.
- Do not create files at the root of ~/Projects. Work inside one project folder.
- Do not move, rename, or delete project folders. `npm run organize` in repo-atlas does that, with confirmation.
<!-- atlas:end -->
```

When the file has no markers, the block is appended. When it has markers, the block between them is replaced.

## 4. The `organize` command

Run from the `repo-atlas` folder:

```
npm run organize
```

Flags:

| Flag | Default | Effect |
|---|---|---|
| `--root <dir>` | `~/Projects` | Folder to organize. |
| `--stale-days <n>` | 90 (contract `STALE_DAYS`) | Staleness threshold. |
| `--dry-run` | off | Print the report. Ask nothing. Write nothing. |

### Step 1 — survey

Read the top level of the root. For each project directory collect:

| Fact | Source |
|---|---|
| `name`, `path`, `kind` | readdir |
| `lastCommitIso` | `git log -1 --format=%aI` (git only) |
| `dirty` | `git status --porcelain` non-empty (git only) |
| `aheadBy` | `git rev-list --count @{u}..HEAD`; 0 when there is no upstream (git only) |
| `remote` | `git remote get-url origin` (git only) |
| `newestFileIso`, `fileCount`, `bytes` | pruned, capped walk |
| `empty` | own listing has nothing but `.DS_Store` |
| `stack` | top-level markers |
| `description` | README heading, else package description |

Every git call uses `execFile` with an argv array, never a shell string. Every call is guarded. A failure leaves that fact null and the survey continues. Loose files are collected by name only.

The survey also lists the entry names inside each subfolder of `Outdated/`, so the index can show what is already archived. The survey result is:

```js
/** @typedef {{ projects: ProjectFacts[], looseFiles: string[], outdated: Record<string, string[]> }} SurveyResult */
```

### Step 2 — classify

Pure. Input: facts, `projects.json`, `nowIso`. Output: one record per project with `theme`, `status`, `activityIso`, plus notice lists (duplicates, unsorted, loose files).

### Step 3 — report

Always printed, including on `--dry-run`:

1. Summary counts by status and by theme.
2. The full table grouped by theme, same columns as `PROJECTS.md`.
3. Archive candidates with kind, last activity, size, and a `dirty` or `unpushed` warning where it applies.
4. Unsorted folders.
5. Duplicate notices.
6. Loose files at the root.

### Step 4 — prompts

Skipped on `--dry-run`. Three rounds:

1. **Unsorted folders**, one at a time. Pick a theme by number, or `s` to skip. A pick is queued as an override.
2. **Archive candidates**, one at a time, with the warning line when the repo is dirty or has unpushed commits. `a` archive, `k` keep, `s` skip. Keep is queued as `paused` with today's date. Skip queues nothing and comes back next run.
3. **Empty folders**, same prompt, destination `Outdated/empties/`.

Then one final confirmation that lists every queued move with its destination. `y` proceeds. Anything else cancels the moves. Theme picks and keep decisions are still saved.

Ctrl-C at any prompt exits with nothing moved and nothing written.

### Step 5 — apply and write

Sub-steps 1 to 4 run only when the final confirmation was `y` and at least one move is queued. Sub-steps 5 to 8 run on every non-dry run, including after a cancelled confirmation.

1. Create `Outdated/`, `Outdated/archived-projects/`, and `Outdated/empties/` if missing.
2. Run each move with `fs.rename`. Same volume only.
3. After each successful rename, append one tab-separated line to `Outdated/MOVES.log`: ISO timestamp with offset, source path, destination path.
4. A failed move is reported and the others continue.
5. Write `projects.json` with the new overrides and paused entries. Records reflect the moves that succeeded: a moved project leaves the theme tables and appears under `Outdated`.
6. Write `PROJECTS.md` atomically.
7. Splice the block into `CLAUDE.md`.
8. Print a summary: moves done, moves skipped, files written.

Exit code 0 when the run completes, even with skipped moves. Exit code 1 on an unexpected error or a corrupt `projects.json`.

### Monthly use

When no round has anything to ask, the run goes from report to write with no prompt. That is the normal case after the first cleanup.

## 5. Code layout

All new code lives in `server/organize/`. One module per job, a test beside each.

| Module | Job | Pure? |
|---|---|---|
| `survey.js` | `surveyProjects(root, { nowIso, execFileFn })` → facts and loose files | No. IO injected for tests. |
| `classify.js` | `classify(facts, config, nowIso)` → records and notices | Yes |
| `themes.js` | `matchTheme(name, config)`, `defaultConfig()`, `loadConfig(file)`, `saveConfig(file, config)` | Matcher yes. Load and save are thin IO. |
| `render.js` | `renderProjectsMd(records, notices, outdated, nowIso)`, `renderClaudeBlock(records)`, `spliceClaudeMd(existing, block)` | Yes |
| `prompt.js` | `runPrompts(records, config, ask)` → decisions | Yes, given the injected `ask` |
| `mover.js` | `planMoves(decisions, root)`, `applyMoves(plan, { rename, appendLog })` | Plan yes. Apply has IO injected. |
| `cli.js` | Flag parsing, wiring, console output | No |

`package.json` gains one line: `"organize": "node server/organize/cli.js"`.

### What the organizer imports

- `isStale`, `STALE_DAYS` from `shared/contract.js`.
- `PRUNED_DIRS`, `MAX_REPO_FILES` from `server/loc.js`.

### What does not change

- `shared/contract.js` is frozen and is not edited.
- `server/scan.js`, `server/gitFacts.js`, `server/index.js`, `server/cache.js`, and the React folio are not edited.
- The dashboard keeps its current behavior, including walking into `Outdated/`.

### Data shapes

```js
/** @typedef {Object} ProjectFacts
 *  name, path, kind: 'git'|'folder',
 *  lastCommitIso: string|null, dirty: boolean, aheadBy: number, remote: string|null,
 *  newestFileIso: string|null, fileCount: number, bytes: number, empty: boolean,
 *  stack: string[], description: string|null, readable: boolean */

/** @typedef {ProjectFacts & { theme: string, status: 'active'|'paused'|'stale'|'empty'|'unknown', activityIso: string|null }} ProjectRecord */

/** @typedef {{ name: string, action: 'archive'|'keep'|'skip'|'theme', theme?: string }} Decision */

/** @typedef {{ name: string, from: string, to: string }} Move */
```

## 6. Error handling

| Situation | Behavior |
|---|---|
| A git call fails in one repo | That fact is null. The file-time signal decides alone. Survey continues. |
| A project directory is unreadable | `readable: false`, status `unknown`. Listed. Never proposed. |
| `projects.json` missing | Created with the default map before classify. |
| `projects.json` corrupt | Stop with a message naming the file. Never overwrite it. Exit 1. |
| `CLAUDE.md` missing | Created with the block only. |
| `CLAUDE.md` without markers | Block appended at the end. |
| `CLAUDE.md` with markers | Block between markers replaced. |
| Move destination exists | Skipped, reported. |
| Move across volumes (`EXDEV`) | Skipped, reported. |
| Move source vanished (`ENOENT`) | Skipped, reported. |
| Ctrl-C during prompts | Exit. Nothing moved. Nothing written. |

## 7. Safety invariants

1. The tool never deletes anything.
2. The tool never moves a project with status `active`, `paused`, or `unknown`.
3. The tool never moves a loose file.
4. The tool never moves anything without the final `y`.
5. Every successful move has a line in `Outdated/MOVES.log`. Undo is one `mv` per line.
6. No git write command is ever issued. Git is read-only, as everywhere else in `repo-atlas`.

## 8. Testing

Vitest, following the repo's patterns. `TZ` is pinned to `America/Chicago` by the existing config.

| Module | Test approach |
|---|---|
| `classify.js` | Fixture facts, pinned `nowIso`. Cases: active by commit, active by file time only, stale, paused, empty, unknown, duplicate by remote, duplicate by name suffix, exactly 90 days is not stale. |
| `themes.js` | Matcher: case-insensitive, `*` semantics, order wins, override wins, no match → `unsorted`. Load: missing → default, corrupt → throws. |
| `render.js` | Snapshot-style string assertions for a small fixture. Splice: no markers, markers present, file missing. |
| `prompt.js` | Scripted `ask` returning canned answers. Assert decisions and that skip records nothing. |
| `mover.js` | Temp directory. Real `fs.rename`. Assert log lines, destination-exists refusal, continue after one failure. |
| `survey.js` | Temp directory with a tiny real git repo, a plain folder with files, an empty folder, and a loose file. Assert facts. |
| `cli.js` | One `--dry-run` smoke test against the temp fixture. Assert no file written and exit 0. |

No test touches `~/Projects`.

## 9. First-run checklist

These steps are for the person, not the tool:

1. Move `~/Projects/ssh-key` and `ssh-key.pub` to `~/.ssh/`. Check `~/.ssh/config` and any scripts for the old path first.
2. Run `npm run organize -- --dry-run` and read the report.
3. Run `npm run organize` and answer the prompts.
4. Open `PROJECTS.md` and `CLAUDE.md` and adjust `projects.json` if a theme is wrong.
5. Commit and push `repo-atlas` to `trmnmc/repo-atlas`.

## 10. Out of scope

- Theme and status shown in the dashboard. Would need additive fields on `RepoSummary`.
- Skipping `Outdated/` in the dashboard walk. Pre-existing behavior.
- Moving zips into `Outdated/zips/`. The user chose to leave loose files alone.
- An undo command. `MOVES.log` makes undo a one-line `mv`.
- Pushing remote-less projects to GitHub. Not part of organizing the folder.

## 11. Prior art considered

Nine GitHub searches across four channels, READMEs grepped on seven finalists. Every tool discovers projects by finding a `.git` entry. None handles plain folders, and none proposes archive moves.

| Repo | Stars | Last commit | License | Why not |
|---|---|---|---|---|
| nosarthur/gita | 1,941 | 2026-03-31 | MIT | Git-only. Groups stored under `~/.config`, not in the folder. No staleness, no moves. |
| alajmo/mani | 769 | 2026-05-19 | MIT | Git-only auto-discovery. Tags but no staleness or moves. Second scanner next to `repo-atlas`. |
| timabell/gitopolis | 68 | 2026-05-11 | AGPL-3.0 | Git-only. Tags and a `move` command. No staleness. |
| Bharath-code/git-scope | 121 | 2026-09-04 | MIT | Status TUI. No tags, index, or moves. |
| bircni/git-statuses | 138 | 2026-08-24 | MIT | Status table only. |
| epilande/repos | 39 | 2026-06-03 | MIT | Its 90-day filter selects GitHub repos to clone. Mirror image. |

`repo-atlas` wins because it already scans this folder with this rule, has tests, and adds no runtime.
