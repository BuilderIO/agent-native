---
name: build-an-app
description: >-
  Fast end-to-end workflow for turning this starter into a working domain app
  from a short or vague request. Use when asked to build, make, create, or
  prototype an app, tool, tracker, dashboard, booking, inventory, or CRM
  system with Agent-Native. Read before the first edit.
scope: both
metadata:
  internal: true
---

# Build an App

Done means one useful domain workflow with a designed route, shared UI/agent
actions, correct access, agent context, and a smoke run that proves its key
rule. Finish a narrow slice before expanding it.

This skill edits source files. If this session cannot write files (a deployed
app's runtime agent), say the change needs a code session and stop.

The four-area parity rule from `adding-a-feature` (UI, action, instructions,
application state) applies to everything you add. This skill supplies the
order and decisions; use the edit-point reference for the scaffold you have.

## 1. Orient

Read `AGENTS.md`, this skill, and only the files you will edit. Skip broad repo
surveys, `README.md`, and `DESIGN.md`. Use the bundled docs/source commands in
`AGENTS.md` only to answer a concrete API question; do not web-research
framework APIs.

## 2. Decide

Choose these six things before writing code:

1. **Slice**: the one workflow that proves the app. For a booking app: create a
   booking, reject an overlap, cancel, weekly grid per room. Name what you are
   deferring (recurrence, notifications, roles, integrations) unless requested.
2. **Who sees each table**: pick one row of the access table in
   `references/data-and-access.md`: private, team-visible, shared on invite, or a
   child that inherits its parent's access. Making a team resource private per
   user is the usual wrong turn. Everyone then sees an empty list, and no
   conflict check can see anyone else's rows.
3. **Invariants**: rules that must hold under concurrent requests (no overlap,
   stock never negative, unique slug). Enforce them in a write action inside a
   transaction or with a database constraint; the UI alone is insufficient.
4. **Actions**: `list-<things>`, `create-<thing>`, a single `update-<thing>`
   patch per resource, and the domain verbs (`cancel-booking`). Fewer,
   orthogonal tools make the agent choose better.
5. **Route**: give the domain its own route (for example, `/rooms`). Preserve
   existing routes and set `app.homePath` so sign-in lands on the domain when
   that is the requested home screen.
6. **Agent context**: URL ids and filters (for example `roomId`, `week`) that
   belong in `navigation`.

## 3. Build: write everything, then verify once

In a generated app, read `package.json` at
`["agent-native"].scaffold.template` and choose the matching reference:

- `chat`: `references/edit-points-chat.md`
- `default`: `references/edit-points-default.md`
- workspace root: use `adding-workspace-apps` to create an app, then follow the
  new app's own `AGENTS.md` and scaffold reference.
- another domain template: use its `AGENTS.md` and `adding-a-feature`; do not
  apply Chat or default shell instructions to it.

If metadata is absent, inspect the actual route, layout, plugin, and navigation
files before choosing an edit point. Do not infer a shell from the app name.

Write the UI, actions, instructions, and state before running the verification
steps below. Do not leave placeholder or comment-only screens.

`references/rooms-example.md` gives a booking slice to adapt. It was verified
against the Chat starter; use the selected edit-point reference for the shell.
Use `frontend-design` for a deliberate visual direction and finish the
requested screens and interactions.

### Data

- Use PostgreSQL only, and keep migrations additive: new columns are nullable
  or have a default, and nothing is dropped or renamed. Never edit an applied
  entry; append a new named one.
- Set `ownerEmail` from `ctx.userEmail` and `orgId` from `ctx.orgId` on inserts
  where those columns exist. Never rely on a development identity fallback.
- Ids are text from `crypto.randomUUID()`.
- Bound every list (a time range or `.limit()`), select only the columns it
  renders, and index the columns it filters and sorts on.
- Store normalized UTC ISO timestamps; collect/display local times in the
  user's timezone. Validate offsets at the action boundary before parsing.

The access table, the concurrency pattern, and the security rules are in
`references/data-and-access.md`.

### Actions

- `schema` is zod, with `.describe()` on every field stating its units and
  format (for example, "ISO 8601 date-time with offset").
- Reads use `http: { method: "GET" }` and `readOnly: true`. Leave writes on the
  default POST so `useActionMutation` needs no `method`.
- Reject with `fail(message, { errorCode, statusCode })` from
  `@agent-native/core/action`: 409 for a conflict, 404 for not found, 403 for
  forbidden. A returned `{ error }` is counted as success everywhere, and a
  bare `throw` reaches the browser as a generic 500.
- Return plain objects that include the `id`. Keep LLM calls out of actions;
  AI-shaped work belongs in the agent chat.
- When the request is batch-shaped ("add these 20"), write one action that
  takes an array and writes it in one transaction.

### UI

- Load and write data with `useActionQuery` and `useActionMutation` from
  `@agent-native/core/client/hooks`. No `fetch`, and no `/api/*` routes for app
  data. Those routes are only for uploads, webhooks, OAuth callbacks, and streaming.
- While data loads, show a `Skeleton` in the shape of the final layout, not a
  spinner or "Loading…".
- Writes should feel instant. In `onMutate`, update `["action", "<name>", params]`
  with `setQueryData`; in `onError`, roll back and show
  `toast.error(actionErrorMessage(error) ?? "<fallback>")`.
- Import controls from `@/components/ui/*`. When one is missing (dialog,
  select, skeleton, alert-dialog), add a one-line re-export like `button.tsx`:
  `export * from "@agent-native/toolkit/ui/dialog";`.
- Use Tabler icons only. Confirm with `AlertDialog`; never use `window.confirm`,
  `alert`, or `prompt`.
- Don't add a page title that repeats the nav item, a subtitle under a title,
  or a stats strip. The data is the page. For visual direction, see `frontend-design`.
- Follow the app's existing localization pattern for user-facing copy.
- Add a pure `link` builder with `buildDeepLink()` to actions that create or
  list navigable resources; see `adding-a-feature` for the shape.

### Agent instructions

Append one section of about 1,500 characters at most to `AGENTS.md`. The
runtime prompt cuts the file off at 6,000 characters. Cover:

- a one-line purpose with the routes
- the invariants, and how to report a rejection
- time and format conventions
- the new `navigation` fields
- an action table with unpadded cells

Keep the action table aligned with the scaffold's primary tool list when one
exists; other actions should remain discoverable through `tool-search`. Leave
unrelated AGENTS.md sections, README, and DESIGN.md as they are.

### Real-time

Agent writes need no wiring, because the chat run refreshes action queries
after each tool. Add `useDbSync({ realtime: { reason } })` to a page only when
other people change its data while it is open and the user must see the change
before refreshing. A booking grid doesn't qualify: the server rejects bookings
made from a stale view. See `real-time-sync`.

## 4. Verify, once, in this order

1. Start `pnpm exec agent-native dev` in the background, without `--open`, and
   wait for the ready URL. Startup regenerates `.generated/action-types.d.ts`
   and the actions registry, so a typecheck run before this is meaningless.
   Local dev on loopback signs you in automatically; do not create accounts or
   set `AUTH_DISABLED`.
2. Run `pnpm typecheck`, then `pnpm agent-native:doctor` (or
   `pnpm exec agent-native doctor`). Fix every finding, then rerun only what failed.
3. Check the agent path. Call a guarded write twice with the same input via
   `pnpm action <name> --key value`. The second call must fail with the expected
   message; read back the saved state through the matching list/get action.
   The CLI prints the failure message, not its structured `errorCode`, so also
   verify any code-specific behavior in the action contract or browser.
4. Run one browser smoke on the domain route:
   - create a record
   - trigger the rejection: a toast appears and nothing is written
   - cancel or undo, repeat the previously rejected write, and confirm it
     succeeds

   Inspect console and network failures. Fix errors from the new route or actions
   and identify existing scaffold messages separately. The only expected 4xx/5xx
   is the rejection being tested. Capture the finished workflow.
5. Stop the dev server and close the tab.

Skip the production build, unrelated test suites, and README or DESIGN rewrites.
To triage failures, see `references/verification.md`.

## 5. Report

State what works and the proof, what you deferred, and anything the user still
has to do (for example, set `DATABASE_URL` before deploying). Never report a
check you didn't run.

## Related

- `adding-a-feature`: the parity checklist for each later feature in this app.
- `frontend-design`, `actions`, `sharing`, `real-time-sync`, and `security`:
  go deeper on one area when the references aren't enough.
