# Plan 002: Cancel BigQuery jobs when polling times out

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the files listed as in scope. If a STOP condition occurs, stop and report
> rather than improvising. Skip updating `advisor-plans/README.md` when a
> reviewer says it owns the index.
>
> **Drift check (run first)**:
> `git diff --stat e678d89913..HEAD -- templates/analytics/server/lib/bigquery.ts templates/analytics/server/lib/bigquery.spec.ts`
> If an in-scope file changed, compare the current-state excerpts below with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (hours)
- **Risk**: LOW - the new call runs only after the existing poll ceiling
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e678d89913`, 2026-07-10

## Why this matters

Analytics stops polling an incomplete BigQuery job after 60 seconds but leaves
the warehouse job running. The user sees a timeout while the query can continue
consuming quota and cost with no consumer waiting for its result. Abort-driven
cancellation already exists; the same best-effort cleanup should run when the
application's polling ceiling expires.

## Current state

- `templates/analytics/server/lib/bigquery.ts:306-326` defines
  `cancelQueryJob(projectId, jobId, token)` as best-effort cleanup.
- `templates/analytics/server/lib/bigquery.ts:478-502` cancels only when the
  caller's AbortSignal fires inside the polling loop.
- `templates/analytics/server/lib/bigquery.ts:504-506` throws the 60-second
  timeout error without calling `cancelQueryJob`.
- `templates/analytics/server/lib/bigquery.spec.ts:50-84` is the exemplar: fake
  timers and a fetch mock prove abort stops polling and sends the cancel POST.

Keep cleanup best-effort so a failed BigQuery cancel request never replaces the
existing, actionable timeout error.

## Commands you will need

| Purpose       | Command                                                                                                                       | Expected on success    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Focused tests | `corepack pnpm --filter analytics exec vitest --run server/lib/bigquery.spec.ts --config vitest.config.ts --passWithNoTests`  | exit 0; all tests pass |
| Typecheck     | `corepack pnpm --filter analytics typecheck`                                                                                  | exit 0; no errors      |
| Format check  | `corepack pnpm exec oxfmt --check templates/analytics/server/lib/bigquery.ts templates/analytics/server/lib/bigquery.spec.ts` | exit 0                 |

## Scope

**In scope** (the only files to modify):

- `templates/analytics/server/lib/bigquery.ts`
- `templates/analytics/server/lib/bigquery.spec.ts`
- one new entry under `templates/analytics/changelog/`

**Out of scope**:

- Changing the 60-second limit, poll interval, query byte cap, or cache policy.
- BigQuery pagination, query validation, credential resolution, or action-level
  error messages.
- Retrying cancellation or surfacing cancellation failures to the user.

## Git workflow

- Stay on the operator-selected branch/worktree. Do not create, switch, reset,
  rebase, or stash branches unless the operator explicitly authorizes it.
- Do not commit, push, or open a PR unless the operator explicitly requests it.
- Never add co-author attribution.

## Steps

### Step 1: Characterize timeout cleanup

Add a test beside the abort case that keeps every poll response incomplete,
advances fake timers through all 60 polling intervals, and asserts:

1. `runQuery` rejects with `BigQuery query timed out after 60 seconds`.
2. The final fetch is a POST to the submitted job's `/cancel` endpoint.
3. A failed cancel fetch still preserves the same timeout rejection.

Structure the mock so query submission, polling, and cancellation calls are
distinguishable. Do not assert only call counts.

**Verify**: run the focused test command before the source fix. Expected: the
new cancellation assertion fails for the current implementation, proving the
test detects the bug.

### Step 2: Cancel before raising the timeout

In the existing `if (!data.jobComplete)` branch, await
`cancelQueryJob(projectId, jobId, token)` immediately before throwing the
existing timeout error. Do not change the message or make cancellation failure
observable; `cancelQueryJob` already contains the intended best-effort handling.

**Verify**: run the focused test command. Expected: exit 0, including abort,
successful timeout cancellation, and failed-cancel preservation cases.

### Step 3: Record and validate the template fix

From `templates/analytics`, run:
`agent-native changelog add "Timed-out BigQuery jobs are now cancelled so they stop consuming warehouse quota." --type fixed`.
Run oxfmt in write mode only on the two modified TypeScript files, then run the
Analytics typecheck and format check.

**Verify**: focused tests, Analytics typecheck, and format check all exit 0; one
new pending changelog entry exists.

## Test plan

- Existing abort test remains green.
- New fake-timer test proves the exact 60-poll boundary triggers cleanup.
- New cancellation-failure case proves cleanup cannot mask the timeout.

## Done criteria

- [ ] An incomplete submitted job is cancelled after the existing poll limit.
- [ ] Cancellation failure preserves the exact timeout error.
- [ ] Focused tests, Analytics typecheck, and format check exit 0.
- [ ] One Analytics fixed changelog entry exists.
- [ ] No files outside the in-scope list are modified.

## STOP conditions

- The polling loop or timeout branch differs from the current-state excerpts.
- BigQuery now supplies a different job or location identifier needed for
  cancellation; report the API-shape mismatch instead of guessing.
- The fix requires changing timeout duration, polling behavior, or user-facing
  action errors.
- A verification fails twice after one reasonable correction.

## Maintenance notes

If polling later becomes configurable or moves to a durable job runner, retain
cleanup for every terminal local wait path. Reviewers should confirm the cancel
call targets the submitted job id and remains best-effort.
