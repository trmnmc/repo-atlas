# repo-atlas — run retro

Run: 2026-08-13 | cycles run: 15 | stop reason: WRAP_UP at VALUE_LOOP exhaustion (~85 min before stop_at; only the deferred morning bundle remained)

## What worked

- Contract-freeze-first wave structure: T-001 froze contract/tokens/Plate in cycle 3; every later wave (k=2–3, cycles 4–6) merged with ZERO same-file conflicts and git auto-merged the single shared-file case cleanly (cycles 4, 5, 6, 10)
- Conductor-authored builder-blind checks caught what suites could not: behind-only clone parse check (cycle 4), node_modules decoy repo (cycle 5), mutation probe on the contract lock (cycle 3), persistent-SSE done-count probe (cycle 11)
- Adversarial review-fix earned its cost: 10 findings, 8 reproduced with runnable evidence, including two HIGH bugs (SSE reconnect loop, dead polling fallback) that 199 green tests never touched (cycle 10)
- Taste pass produced the single highest-value item of the night: the "loop dead-ends where it should climax" fundamental, fixed and live-verified same night (cycles 13–14)
- Routing: fable on correctness core (contract, gitFacts, attention, scanner, SSE fix) returned zero verify failures across 6 items; the one repeated verify failure was a sonnet chart item that passed on opus escalation (cycles 7–8)
- Live-look passes after user-visible merges found 9 real rendered-page defects across cycles 6–7 that unit suites missed entirely

## What thrashed

- F-013 chart fixes failed the live gate at attempt 1 — why: the sonnet builder fixed to its own internal metric (final-point y) instead of the measured geometry; opus attempt 2 with the exact measured coordinates landed (cycles 7–8)
- Conductor false-fail on F-013 attempt 2 — why: the browse daemon kept a stale SPA page instance across `goto` after a rebuild; served-bundle grep + hard reload disproved it. Cost ~15 min of re-measurement (cycle 8)
- P-018 selection persistence reverted on first merge — why: module-level persisted state leaked across tests (the old click-nav test started from a stale cursor); reland dropped the module fallback for storage-only + beforeEach hygiene (cycle 14)
- F-014 builder died at the StructuredOutput retry cap with zero output — why: unknown (workflow-level), item relanded cleanly on opus next cycle (cycles 8–9)
- review-fix fixer for the 4 server findings was BLOCKED — why: the workflow assigned it a SWARM worktree instead of a target worktree (tool bug, journaled; fixes relanded as R-015 next cycle) (cycles 10–11)

## Pacing honesty

- Governor clamps: 0 cycles (weekly.ok false all night — governor disengaged); full-mode overrides: 0; promote-rung promotions: 0. Gear held 4–5 on hysteresis while ρ ran 0.38→6+; no window reset occurred before stop, so no under-utilization to report. Voluntary idle cycles: 0.

## Config recommendations

- [qa] Hard-reload the browser page after any server rebuild/restart before judging a fix — a stale SPA instance survives goto and produces false gate failures [apply: prompt qa "After any server rebuild or restart, hard-reload the page before judging — a stale SPA instance survives goto"] [confidence: high] [source: 2026-08-13 repo-atlas]
- [prompt] Persisted UI state (module vars, sessionStorage) must be reset in test beforeEach — cursor/selection persistence broke an unrelated green test at merge [apply: prompt builder "Any persisted UI state (storage or module-level) must be cleared in beforeEach of every test file that mounts the component"] [confidence: high] [source: 2026-08-13 repo-atlas]
- [process] When a fix targets a live-measured defect, put the measured coordinates/output in the item context and verify against re-measurement, not the suite — the suite passed both times the live bug persisted [confidence: high] [source: 2026-08-13 repo-atlas]
- [process] review-fix fixers can be assigned a SWARM worktree by the workflow (hard-rule-5 fence caught it; fixes were lost that cycle) — inspect worktree assignment in review-fix.js before next run [confidence: med] [source: 2026-08-13 repo-atlas]
- [routing] Fable-on-core (contract/git plumbing/attention/scanner) produced 6/6 first-attempt verified items; keep route_class core aggressive [apply: routing core-logic->fable] [confidence: high] [source: 2026-08-13 repo-atlas]

## House-rules proposals

- [ui] A drill-down opened from an alert/badge must answer the question the badge raised, on that same screen (the dirty badge's "which files?" was unanswered until the taste gate caught it)
- [ui] Cross-filters must filter something the user can enumerate (rows, lists), never only a text readout

## Applied lessons check

- L-002 (core->fable): re-observed — 6/6 core items first-attempt verified (cycles 3–5, 11)
- L-003 (hand-computed QA scenarios): re-observed — QA executor's independent git answer keys over 39 repos (cycle 12)
- L-006 (vm collision scan): not-exercised — ESM/Vite target, no classic scripts
- L-007 (live browser look): re-observed — 9 rendered-page defects found that suites missed (cycles 6–7)
- L-008 (conductor sole committer): re-observed — zero unauthorized commits to main all night
- L-011 (hook mount tests): re-observed — enforced in T-007/T-010; no mount-crash class bug appeared
- L-016 (disjoint fixer scopes): contradicted in part — the review-fix workflow itself assigned two fixers the same file (useAtlas.ts); git auto-merged cleanly this time, but the workflow does not enforce the rule (cycle 10)
- L-018 (post-merge look passes): re-observed — cycle 6/7 look passes each caught real defects
- L-020 (env hygiene beforeEach): re-observed in spirit — the P-018 storage-state leak is the same class (cycle 14)
