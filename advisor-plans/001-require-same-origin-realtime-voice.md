# Plan 001: Require same-origin realtime voice writes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the files listed as in scope. If a STOP condition occurs, stop and report
> rather than improvising. Skip updating `advisor-plans/README.md` when a
> reviewer says it owns the index.
>
> **Drift check (run first)**:
> `git diff --stat e678d89913..HEAD -- packages/core/src/server/realtime-voice.ts packages/core/src/server/realtime-voice.spec.ts packages/core/src/server/transcribe-voice.ts packages/core/src/server/google-realtime-session.ts`
> If an in-scope file changed, compare the current-state excerpts below with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (hours)
- **Risk**: MED - an overly strict check could block the supported Tauri client
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `e678d89913`, 2026-07-10

## Why this matters

The authenticated realtime voice session and tool endpoints accept cookie-backed
POST requests without checking their browser origin. The tool endpoint can reach
the central action executor, including mutating actions and approval handling.
Adjacent voice POST endpoints explicitly reject cross-site requests because
production cookies use `SameSite=None; Secure`; the realtime routes need the same
policy while retaining the documented Tauri development and production origins.

## Current state

- `packages/core/src/server/realtime-voice.ts:302-310` authenticates the session
  POST but performs no origin check before provider work.
- `packages/core/src/server/realtime-voice.ts:530-538` authenticates the tool POST
  but performs no origin check before parsing and executing the requested tool.
- `packages/core/src/server/transcribe-voice.ts:78-125` contains the established
  policy: compare `Origin` to `Host`, allow the narrow Tauri origins, fall back
  to `Sec-Fetch-Site`, and allow non-browser clients with neither header.
- `packages/core/src/server/google-realtime-session.ts:25-57` independently
  duplicates that policy, so a third local copy would create avoidable drift.
- `packages/core/src/server/realtime-voice.spec.ts:191-208` already establishes
  the route-level test style with fake H3 events and executor call assertions.

The repository security convention is server-side enforcement on state-changing
routes. Preserve support for `tauri://localhost`, `http(s)://tauri.localhost`
against a loopback app host, and `http://localhost:1420` against a loopback app
host.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused tests | `corepack pnpm --filter @agent-native/core exec vitest --run src/server/realtime-voice.spec.ts src/server/transcribe-voice.spec.ts src/server/google-realtime-session.spec.ts --passWithNoTests` | exit 0; all selected tests pass |
| Typecheck | `corepack pnpm --filter @agent-native/core typecheck` | exit 0; no errors |
| Format check | `corepack pnpm exec oxfmt --check packages/core/src/server/request-origin.ts packages/core/src/server/request-origin.spec.ts packages/core/src/server/realtime-voice.ts packages/core/src/server/realtime-voice.spec.ts packages/core/src/server/transcribe-voice.ts packages/core/src/server/google-realtime-session.ts` | exit 0 |

## Suggested executor toolkit

- Read `.agents/skills/security/SKILL.md` before editing because this is a
  cookie-authenticated mutation boundary.

## Scope

**In scope** (the only files to modify):

- `packages/core/src/server/request-origin.ts` (create)
- `packages/core/src/server/request-origin.spec.ts` (create)
- `packages/core/src/server/realtime-voice.ts`
- `packages/core/src/server/realtime-voice.spec.ts`
- `packages/core/src/server/transcribe-voice.ts`
- `packages/core/src/server/google-realtime-session.ts`
- one new `.changeset/*.md` file for `@agent-native/core` with a patch release

**Out of scope**:

- Cookie configuration, authentication/session behavior, CORS middleware, or
  action approval semantics.
- Broad CSRF refactors outside these three voice route modules.
- Any new origin allow-list or environment variable.

## Git workflow

- Stay on the operator-selected branch/worktree. Do not create, switch, reset,
  rebase, or stash branches unless the operator explicitly authorizes it.
- Do not commit, push, or open a PR unless the operator explicitly requests it.
- Never add co-author attribution.

## Steps

### Step 1: Extract the established origin policy

Create `packages/core/src/server/request-origin.ts` exporting a named
`isSameOriginRequest(event: H3Event): boolean`. Move the established logic and
its explanatory comment from `transcribe-voice.ts` without changing behavior.
Replace the local implementations in `transcribe-voice.ts` and
`google-realtime-session.ts` with imports from the helper. Remove imports that
become unused.

Create `request-origin.spec.ts` with table-driven coverage for: matching
Origin/Host; mismatched web origin; malformed Origin; `sec-fetch-site` values
`same-origin`, `none`, and `cross-site`; neither browser header; all three
currently supported Tauri origin shapes; and rejection of those same shapes
when the app host is not loopback.

**Verify**: run the focused tests command. Expected: exit 0.

### Step 2: Guard both realtime voice POST routes

Import the shared helper in `realtime-voice.ts`. After confirming the method is
POST and before authenticating or reading the body, reject a failed origin check
with HTTP 403 and `{ error: "Cross-origin request rejected" }` in both the
session and tool handlers.

Extend `realtime-voice.spec.ts` so a cross-site session request and a cross-site
tool request both return 403. Assert that the session case does not resolve
credentials or call upstream fetch, and the tool case does not call
`executeTool`. Update fake same-origin requests with the minimum headers needed
without weakening the production helper.

**Verify**: run the focused tests command. Expected: exit 0 and the two new route
regression cases pass.

### Step 3: Record and validate the package fix

Add a patch changeset stating that realtime voice session and tool routes now
reject cross-site browser requests. Run oxfmt in write mode only on the modified
TypeScript files, then run typecheck and the format check.

**Verify**: `corepack pnpm --filter @agent-native/core typecheck` and the format
check both exit 0.

## Test plan

- Shared policy unit tests cover ordinary web, header fallback, non-browser, and
  supported desktop-origin cases.
- Route tests prove the check is wired before provider cost and tool execution.
- Existing transcribe and Google realtime tests prove extraction preserves
  behavior.

## Done criteria

- [ ] Both realtime voice POST handlers return 403 for a cross-site browser
      origin before resolving credentials or executing a tool.
- [ ] Supported Tauri origins and non-browser callers retain current behavior.
- [ ] Only one `isSameOriginRequest` implementation remains under
      `packages/core/src/server`.
- [ ] Focused tests, core typecheck, and format check exit 0.
- [ ] A patch changeset for `@agent-native/core` exists.
- [ ] No files outside the in-scope list are modified.

## STOP conditions

- The live origin policies differ materially from the excerpts or new supported
  origin cases have been added since the planned commit.
- A supported client sends an Origin shape not represented above; report it
  rather than broadening trust heuristically.
- The fix appears to require cookie, CORS, auth, or approval changes.
- A verification fails twice after one reasonable correction.

## Maintenance notes

All future cookie-authenticated browser POST routes should reuse the shared
helper. Reviewers should scrutinize exact host/protocol comparisons and ensure
the fallback still rejects `sec-fetch-site: cross-site`.

