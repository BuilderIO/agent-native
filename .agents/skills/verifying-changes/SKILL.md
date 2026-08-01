---
name: verifying-changes
description: >-
  Concrete, per-area proof that a change actually works before reporting it
  fixed, done, or "should work now" — which dev server, test command, or
  invocation proves a template UI change, an action, a migration, a guard, or
  a core/package change. Use before every wrap-up, and before stopping
  mid-task to ask permission instead of continuing.
scope: dev
metadata:
  internal: true
---

# Verifying Changes

## When this applies

Before telling the user a fix, feature, or bug is done, find the row below for
the area you touched and do it. "I changed the code and it looks right" is not
proof — it's the exact gap this skill exists to close. A failing check is a
reason to keep working, not a reason to stop, ask, or report done anyway.

## Do NOT report done in these situations

- The change is "obviously correct" or one line — obvious fixes are the ones
  that ship broken most often; run the row below anyway.
- You verified a similar path earlier in the session — re-run against the
  actual latest edit, not a memory of an earlier pass.
- The user didn't explicitly ask you to test it — test it anyway; verify-
  before-done is a standing rule here, not an opt-in.
- The full test suite is slow or flaky — run the targeted command for the
  changed area (below) instead of skipping verification entirely.
- You're mid-task and unsure whether to keep going — keep going. Only stop for
  a missing credential, an ambiguous decision only the user can make, or a
  destructive action that needs confirmation. Silence from the user means
  keep working, not pause and wait.
- You genuinely cannot run anything — say so out loud (see below); never let
  "unverified" read as "done".

## Proof by area

| You changed | What proves it | Command |
| --- | --- | --- |
| Template UI/behavior (`templates/<app>/app/**`) | Drive the real page and check console + network, not just the diff | `pnpm --filter <app> dev` (or root `pnpm dev` for the gateway), then click through the exact flow with whatever browser tool is available; check for console errors and failed (4xx/5xx) requests on that page |
| An action (`templates/<app>/actions/*.ts`) | Call it with representative args and inspect the real return value | `cd templates/<app> && pnpm action <name> --key value`; for a write, follow with `pnpm action db-query --sql "SELECT ..."` to confirm the row actually landed |
| Schema/migration | Boot the app so migrations run, then read back the new column/table | `pnpm --filter <app> dev` once, then `cd templates/<app> && pnpm action db-query --sql "..."` (`action` is a per-template script, not a root one); `pnpm guard:additive-migrations` catches destructive DDL before CI does |
| A guard/lint script (`scripts/guard-*.{mjs,ts}`) | Run it directly against a case that should now pass and one that should still fail | `pnpm guard:<name>` (name matches the `package.json` script); `pnpm guards` for the full sweep |
| `packages/core` or another publishable package | Run that package's actual tests, not just typecheck | `pnpm --filter @agent-native/core exec vitest --run <changed.spec.ts>`, or `pnpm test:core-integration` for cross-cutting paths |
| Cross-cutting change, or unsure which area | Workspace-wide pass | `pnpm run prep` (fmt + typecheck + `test:fast` + `guards`, run in parallel) |
| Docs only (`.md`, `AGENTS.md`, `SKILL.md`) | Nothing to run | Say "docs-only, no runtime check applies" — don't invent a verification step |

`pnpm test:fast` excludes `.db.test.ts` / `.integration.*` / `.e2e.*` /
`.live.*` / `.perf.*` suites. If your change touches one of those, name and
run that specific file — `test:fast` passing does not cover it.

## Production forensics

When inspecting production runs, query interactive and scheduled/background
work as separate populations before summarizing reliability. Report both
`id NOT LIKE 'job-%'` and `id LIKE 'job-%'` (or the repo's current equivalent),
including app, run count, completed count, failure count, and top terminal
reasons for each slice. A healthy interactive sample does not prove scheduled
jobs work.

## When you can't verify

State it plainly and name what would close the gap: "I could not run this —
verifying it needs `<command>` or a browser check of `<page>`." Never write
"should be fixed" or "this resolves it" without having actually run the check
above.

## Real failures this replaces

- "still getting it friend. this is the third time you said you fixed it when
  you didn't. please reproduce end to end and verify"
- "did you test end to end? can you do so in the browser and confirm?" — asked
  on nearly every wrap-up before this rule existed
- "ok so should work now?? i am getting sick of saying 'try this' and it still
  not working. you confident?"
- "my analytics dashboards ALWAYS fail ... i have asked agents to fix this for
  weeks at least 10x and they always say they did and then the emails keep
  failing"
- "WHY THE FUCK DO YOU KEEP STOPPING" / "sorry what is still queued? you
  should be doing everything now don't queue" — stopping mid-task instead of
  finishing and verifying
