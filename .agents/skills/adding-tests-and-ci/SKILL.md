---
name: adding-tests-and-ci
description: >-
  Where a new test belongs and how to scope CI jobs, steps, and workflow
  triggers so they run only when a change can affect them. Use when adding or
  moving a test, adding or changing a CI job, step, or workflow, or when a job
  is slow or runs on unrelated changes.
scope: dev
metadata:
  internal: true
---

# Adding Tests and CI

## Why this is a cost question

Every agent-native workflow draws on one org-wide pool of GitHub-hosted runners,
about 60 concurrent jobs on the Team plan. Measured 2026-09-29: 57 running and
126–165 queued, and the `Fast tests` gate waited a median 445 s just for a slot.
Minutes are free for this OSS repo; slots are not. A job a change cannot affect
does not just waste its own minutes. It delays every other open PR. Two or three
PR pushes can fill the pool, so scope is the lever, not faster hardware.

`scripts/ci-change-scope.ts` is the one place that decides what a change runs.
It classifies the changed paths into a full or targeted run and emits one output
per check. `ci.yml` jobs gate on those outputs. A `.github/**` change, the
lockfile, root config, or a `scripts/**` change other than a guard script or
root script test forces a full run.

## Adding a test

- **Put it in the workspace of the code it proves.** Targeted runs test the
  changed packages and their dependents (`...{packages/core}`), so a test
  in another package either runs on unrelated changes or never runs on
  the one that breaks it.
- **Prove it at the cheapest tier that can fail for the bug:** a pure
  function, then a component or `.db.test.ts`, then browser E2E last.
  Some E2E suites, such as Design's, run only after merge and cannot fail
  a PR. Do not restate one assertion at several tiers.
  `design-editor-architecture` covers failing-first proof and mutation
  audits.
- **A new test joins an existing lane or job.** It never gets a job of its
  own. A changed root `scripts/*.test.ts`, or the test beside a changed
  guard script, runs in `Security guards` through the `script_tests`
  output.
- **Mind what `vitest --changed` cannot see.** Targeted Core lanes run only
  the tests whose import graph reaches a changed file. A test that reads a
  file from disk (a skill, a fixture, a template) will not rerun when only
  that file changes. Import it, or teach `requiresFullCoreFastTests` in
  `scripts/ci-test-lanes.ts` about the path.
- Never skip, disable, or quarantine a test to get green.

## Test workers

Fast-test lanes run Vitest with `VITEST_CONCURRENCY=100%`, one worker per
core. The shared config's 25% default is for laptops, and on CI's 4-vCPU
runners it meant one worker: a core shard took 542 s at one worker and 201 s
at four, on the same CPU time. So two lanes at full width replace five
single-worker ones, and each lane dropped also saves its ~100 s of setup and a
runner slot. Every core is already busy at 100%, so more workers or lanes buy
nothing.

- **Let CI override the worker count.** A package that pins `maxWorkers`
  goes through `resolveMaxWorkers(process.env, fallback)`; a literal
  overrides the CI setting.
- **Leave headroom for work inside a test body.** Booting PGlite or
  importing a server bundle takes several times longer when every core is
  busy, and a different test crosses the limit each run. The shared config
  allows 30 s; do not add a stricter per-block timeout.
- **Give parallel workers separate databases.** A file that opens the
  database without `DATABASE_URL` gets the default directory, whose lock
  admits one process at a time. Core's Vitest setup gives each worker slot
  its own under a root that belongs to one run, so concurrent runs never
  share one; a test that asserts the default URL clears `DATABASE_URL`
  itself.
- **Keep the forks pool with isolation.** Threads ran slower and failed 79
  tests; turning isolation off gained 7% and failed 129.

## Adding or changing a CI job

| Rule | Why, from this repo |
|---|---|
| Give a job its own check in `CHECK_NAMES` whose condition names the paths that can change its result. Never borrow another job's output. | The Postgres connection budget reused `neon_query_budget` and ran on every template edit. Its probe imports only `@agent-native/core/db`. |
| Per-app work takes a list output, not a boolean. Shared packages or a full run select every app; a template change selects that template; an empty selection turns the check off. If the check is on and the list is empty, the job fails. | `query_budget_apps` and `ssr_boot_apps`: a one-template PR built and measured all 16 templates (12–13 min). When shared code selects every template, `query_budget_matrix` splits them across two jobs. The beta publisher's `discover-sites` publishes only sites whose dependency closure changed. |
| Split the expensive step from the cheap one. Keep the cheap check on every run and gate the expensive step on its narrower inputs. | Android: `expo export` runs whenever a file Metro bundles changes, but the Gradle compile, the bulk of the ~23 min Android job, runs only when `packages/mobile-app`, the lockfile, or the workflow changed. |
| A path filter covers the job's whole dependency closure, including install-time inputs: root `package.json`, `pnpm-workspace.yaml`, the prebuild script, and the lockfile. | The desktop canary filter missed the bundled Chrome extension and then the postinstall inputs. Each gap skipped runs that should have caught a break. `guard:mobile-build-paths` traces Metro's imports and fails when the mobile filter misses one. |
| Subscribe only to events that can change the outcome. Validators pin some trigger sets, e.g. `scripts/validate-*-workflow.ts` and `scripts/package-release-workflow.test.ts`; update them in the same change. | Content product conformance reran on `labeled`/`unlabeled` but never reads labels, and on title edits although it reads the body only for its declaration. |
| Do not add a job for under a minute of work. Checkout, install, and a pool slot cost more than the check. Fold it into a job with the same setup, and do not duplicate what `pnpm guards` already runs. | Consolidation took PR pushes from ~31 to ~23 jobs. It folded PGlite locking into Content DB tests, privacy evals into Brain evals, QA static into Security guards, and the changeset check into Lint & format, and dropped a drizzle guard job `pnpm guards` covered. |
| Batch periodic publishing on a schedule with change detection, instead of once per merge. | Nightly npm snapshots publish every 3 h, and only when a publishable path changed since the last successful scheduled run. |
| PR workflows cancel superseded runs: `group: <name>-${{ github.event.pull_request.number \|\| github.ref }}` with `cancel-in-progress: true`. Publishers on `main` use `cancel-in-progress: false` so a deploy is never killed mid-flight. An event rejected only by a job `if` still joins the run's group and cancels a real run, so filter it in `on:` or give ignored events a throwaway group. | Visual Recap events the gate ignored used to cancel an in-progress recap; they now get a throwaway group. |
| When scope cannot be computed, run everything or fail. Never skip. | An unreadable beta site list, an unknown base, or unrelated history publishes every site. A failed `git diff` fails the step; it is never `\|\| true`. |
| Print what fails, not everything. | The full-tree lint printed ~15k pre-existing warnings over the one error. It now runs `oxlint --quiet`. |

A skipped job counts as passing for required checks, so gating a required job
or step with `if` is safe. Every uppercase key a workflow adds under `env:`
needs a `docs/environment-variables.md` row (`guard:env-documentation`). Prefer
built-in `GITHUB_*` variables over new ones.

## Proving a CI change

- **Classifier:** add `scripts/ci-change-scope.test.ts` cases for each new
  check: on, off, full run, and tooling-only full run. Then run
  `node --experimental-strip-types --test scripts/ci-change-scope.test.ts scripts/ci-build-workspaces.test.ts scripts/ci-test-lanes.test.ts`.
- **Real history:** run `scripts/ci-change-scope.ts` with `GITHUB_OUTPUT` set
  on real `main` commit ranges, and put the before/after in the PR.
- **Shell:** run each new `run:` snippet locally against a matching input
  and an empty one. Run `actionlint` on the workflow when it is available.
- **Mind the self-test gap:** a PR that edits `ci.yml` runs full CI itself,
  so its own checks cannot show the saving. The classifier output is the
  evidence.

## Real failures this replaces

- "whats up with Cold-request query budget. runs on every CI for every
  template? seems wrong"
- "fast lane tests seem absuredly expensive"
- "why is Generate + run standalone Chat running so frequently? shouldnt it
  listen to Chat changes?"
- "so tldr: ~2-3 simultaneous PRs will eat up our entire quota of jobs right"
- "can you make lint & format not print all the warnings?"
