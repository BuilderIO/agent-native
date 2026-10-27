---
name: audit-log
description: >-
  Durable, access-scoped, append-only record of who changed what app data,
  when, and whether it was the agent or a human. Use when adding an activity
  feed or change history, declaring what a mutating action targets, auditing
  sensitive reads, or answering "what did the agent change / who edited this".
scope: dev
metadata:
  internal: true
---

# Audit Log

## Rule

Every mutating action automatically records an audit event — **no wiring
needed**. The framework captures who/what/when/from-where at the `defineAction`
seam, redacts credentials, and attributes the change to a human or the agent
(with the agent thread/turn that caused it). You only touch `audit` config to
make events *more useful* (declare the target) or to opt a read in / a noisy
write out.

This is distinct from:

- **observability** — sampled agent-run telemetry (traces, evals), developer-facing.
- **tracking** — fire-and-forget product analytics to external SaaS.

Audit is complete, durable, locally queryable, and scoped to the data it
describes.

## Declare the target so it lands in the owner's trail

By default an event is scoped to the **actor** (you see your own changes and the
agent's changes on your behalf). To make a change to a *shared* resource show up
in the **owner's** audit trail, declare the target:

```ts
defineAction({
  description: "Delete a recording",
  schema: z.object({ id: z.string() }),
  audit: {
    // type + id label the event; ownerEmail/orgId/visibility scope who can read it.
    target: (args, result, meta) => ({
      type: "recording",
      id: args.id,
      // Optional — defaults to the actor. Set when editing someone else's resource.
      ownerEmail: result?.ownerEmail,
      visibility: "org",
    }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => { /* ... */ },
});
```

`target`, `ownerEmail`, `visibility`, and `summary` are all optional. The
minimum useful addition is `target: () => ({ type, id })`.

## Defaults and how to override them

- **Mutations** (anything not GET / `readOnly`) are audited automatically.
- **Read-only** actions are skipped. Audit a sensitive read (secret access, bulk
  export) with `audit: { onRead: true }`.
- **High-frequency framework actions** (app-state sync, context-xray, navigate,
  appearance) are skipped by default. Force one on with `audit: { enabled: true }`.
- **Opt a noisy write out** with `audit: { enabled: false }`.
- **Skip capturing arguments** (large/sensitive payloads) with
  `audit: { recordInputs: false }`. Inputs are credential-redacted regardless.
- **Refusals** — a thrown error with `statusCode` 401 or 403 records as
  `status: "denied"`, so a refused attempt shows up as an attempt.
- **Probes** — a health or capability probe sends `{ "__probe__": true }` as
  its only argument. If it is rejected it records nothing; if it executes, or
  carries any other argument, it records like any call. Do not invent another
  probe shape in a client; the recorder only knows this one.
- **Outside agents** — a call over an agent protocol (`mcp`, `webmcp`, or
  `a2a`) records as `agent` with the user's email, like the app's own agent
  (`tool`); `caller` names the protocol. Classify a new agent-only caller in
  `AGENT_AUDIT_CALLERS`, not in a per-action `audit` config.
- **Client and approval** — keep four facts in four fields. `actorEmail` is
  the principal the call runs as, never evidence of approval. `caller` and
  `actorKind` are the execution source. `reportedClientName` /
  `reportedClientVersion` are the MCP client's self-reported `clientInfo` for
  that individual `tools/call`; `initialize`-only values are not carried
  forward. `oauthClientId` is the OAuth client its credential was issued to.
  `approval` (`agent-chat`, `a2a-review`, `mcp-client-accepted` or
  `mcp-review`) records the authorization signal for that call. `agent-chat`
  is a person's approval in agent chat; `a2a-review` is the owner's approval
  of a paused A2A call on its review page; `mcp-client-accepted` means the MCP
  client accepted its elicitation, and the server cannot verify who responded;
  `mcp-review` is the signed-in owner's approval of a direct MCP call on its
  review page. The recorder reads approval from the invocation's execution
  frame, never from its context.
  Never infer approval from the email, and never backfill these fields on
  older rows.
- **Attribution comes from one helper** — `recordActionAudit` and
  `recordOrgAdminAuditEvent` require an `attribution` (source, reported
  client, OAuth client, approval, run and network ids), and only
  `auditAttribution(ctx)` makes one; a Nitro route outside any action uses
  `routeAuditAttribution(event)`. Never copy `caller`, `threadId` or the client
  fields into a hand-built context: a field the copy forgets is stored as null.
  A call without one throws `AuditAttributionError` instead of losing its row.
- **Approval and an audit override belong to one invocation** — the
  dispatcher that runs a call opens its execution frame and puts the evidence
  there: the agent loop's approval key for a call a person approved, the MCP
  handler's accepted elicitation, and an approved A2A replay's task ids and
  `a2a-review`, which must not become its `threadId` or `runId` because those
  load the task's journal and ledger. `auditAttribution(ctx)` reads only the
  current frame, so the action's own row and a row its body records carry
  them. Every `defineAction` call and every `runActionInvocation` opens a new
  frame, so another action it calls, a recursive call, or a later call with a
  kept context records none, whatever context it is given. A frame's evidence
  belongs only to rows about its own call, written before the promise `run`
  returned settles: a timer, unawaited promise or job write it leaves
  running records none, and neither does work done later while consuming a
  stream or iterator it returned. The attribution `auditAttribution` returns
  is a snapshot: passing one made during the call to a later write records
  that write as part of the approved call, so call `auditAttribution` at write
  time for work that is not.
  `recordServicePrincipalDenial` records only the source its caller knows,
  outside the running frame, unless the caller passes the refused call's run
  context as `ownInvocation`. Only `defineAction`'s own grant check does: its
  row keeps that call's client, network and run ids and its frame's approval,
  while a refused child or agent run borrows none of the enclosing call's. A
  dispatcher that pauses another call records that row inside
  `runOutsideActionInvocation`, and `recordInvalidActionCall` records a call
  refused for invalid arguments there too. A dispatcher vouches for the call
  it runs with `vouchedOutcome(outcome, evidence)`, and the frame that call
  opens holds it. The frame and its evidence live in `action-frame.ts`, and
  `runActionInvocation` in `action-invocation.ts`, both outside the package
  exports: the action entry exposes no frame-evidence helpers, and request
  input or `ActionRunContext` fields never become evidence. Trusted server
  dispatcher APIs (`executeAgentToolCall`, `runAgentLoop`) can still supply
  approval and attribution.
  `ctx.approvedToolCallKey` stays on the context only for approval gates. Two
  limits: a raw entry called straight from an action's body shares that
  frame, so define it with `defineAction` (a framework dispatcher runs it
  through `runActionInvocation`); and a wrapper around `run`
  must spread the entry to keep `ACTION_EXECUTION_KEY`, or the action runs as
  the wrapper's child and records no approval. Without async-local storage no
  approval or override is recorded. Never add a context field that changes
  what a row records.
- **Source is verified, not claimed** — on an action route, a request that
  authenticated with an MCP OAuth or connect token records as `mcp` with that
  token's `oauthClientId`, whatever headers it sends. `getMcpOAuthBearerSession`
  marks the event after verifying the token, and the route reads that mark; a
  self-reported value (the `x-agent-native-frontend` header, `clientInfo`) never
  sets `caller`, `actorKind` or the principal.
- **A row is never silently lost** — the recorder replaces control characters
  in the self-reported labels, and the store replaces NUL in every text value,
  because PostgreSQL rejects NUL and the insert would drop the row. A write
  that still fails is logged and sent to `captureError`; it never fails the
  action. Don't wrap `recordActionAudit` in a `catch` that discards the error.
- **App** — every event records the app that wrote it (`app.id`, else
  `app.name`, the same key usage uses).

## Who reads an event

`visibility` decides who reads an event besides its owner (`ownerEmail`, which
defaults to the actor):

| Visibility | Readers | Recorded for |
|---|---|---|
| `private` (default) | The owner only, admins included | Personal content and personal connections |
| `org` | Every member of `orgId` | Changes to resources shared with the org; integration-triggered runs |
| `admins` | Owners and admins of `orgId` | Organization settings and admin actions |

The `admins` events today: default model (`agent-default-model`), app member
roles, app permission roles, workspace app access, org member role changes
(`org-member-role`), sent invitations (`org-invitation`), file storage (`file-storage`), and org-scoped Builder.io
connect and disconnect (`builder-connection`). A member's personal Builder.io
connection is `private`.

## Record an organization settings or admin change

Use the helpers in `@agent-native/core/audit` instead of hand-setting
`visibility`, so every org setting lands in the organization trail the same way:

```ts
import {
  orgAdminAudit,
  recordOrgAdminAuditEvent,
  routeAuditAttribution,
} from "@agent-native/core/audit";

defineAction({
  // ...
  audit: orgAdminAudit({
    targetType: "org-thing",
    targetId: (args) => args.id,
    summary: (args) => `Set the thing to ${args.value}`,
  }),
});

// From a Nitro route (OAuth callback, upload) that is not an action:
await recordOrgAdminAuditEvent({
  action: "builder-connect",
  targetType: "builder-connection",
  summary: "Connected Builder.io for the organization",
  userEmail,
  orgId,
  attribution: routeAuditAttribution(event),
});
```

Pass `personal: true` to `recordOrgAdminAuditEvent` when the change affects
only the actor. An action that records by hand instead of through
`orgAdminAudit` passes `attribution: auditAttribution(ctx)`.

## Reading the log

These actions are available to the agent and the frontend in every app, scoped
in SQL to the caller — they never leak another tenant's rows:

- `list-audit-events` — filter by `targetType`/`targetId`, `actorKind`
  (`agent` | `human` | `system`), `status`, `threadId`/`turnId`, `action`,
  `app`, `sinceMs` (inclusive), `beforeMs` (exclusive), with `limit` and
  `offset` paging; returns `hasMore` and `nextOffset`. `includeApps: true`
  also returns `apps`, the app ids with events in the scope, for an app
  filter. `scope: "organization"` reads only the org's shared trail (`org` and
  `admins` events) and is refused with a 403 for anyone but owners and admins.
  This is the Settings audit log.
- `get-audit-event` — one event by id, with its redacted input payload. Owners
  and admins can open `admins` events.
- `export-audit-events` — bulk CSV/NDJSON export (same filters minus `limit`
  and `offset`, plus `format` and `maxRows`) for offline/compliance pulls;
  itself audited via `onRead`.
  CSV output prefixes formula-like values in every column with an apostrophe
  before escaping.

- `export-audit-ocsf` — the org trail as OCSF 1.9.0 API Activity events (class
  6003) for a SIEM. Owners and admins only, through
  `resolveAuditReadScope(ctx, "organization")`, so it never reads past
  `list-audit-events`. Oldest first; pass the previous `nextCursor` as `cursor`
  and store every returned `nextCursor`, including on empty pages (they advance
  the ready watermark). `since`/`until` take ISO or epoch ms.
  The mapper is `auditEventToOcsf` in `audit/ocsf.ts`; framework ids (run, task,
  thread, turn, app) go under `unmapped`, never an invented OCSF field, and
  `input` is never exported.

Call them from the UI with `useActionQuery` to build an activity feed or a
"who changed this" line — never hand-write a fetch to the audit table.

Settings › Organization › Audit log (`/settings/audit`, owners and admins) is
that trail's page, in
`packages/toolkit/src/app/settings/shell/pages/audit.tsx`. Its range and app
filters are `sinceMs` and `app`; "Show N more" is the next `offset` page; a
row opens `get-audit-event`. When a user asks what changed in the org, call
`list-audit-events` with `scope: "organization"` instead of reading the page.

## Never

- Don't write a parallel "history" table for a resource — declare an `audit.target`
  and read it back instead.
- Don't put secrets in `summary` or rely on inputs being safe — redaction covers
  credential-shaped values, but keep summaries free of sensitive data.
- Don't expose an update/delete path for audit rows. The log is append-only; the
  only deletion is the retention purge (`AGENT_NATIVE_AUDIT_RETENTION_DAYS`,
  default 365 days; `0` = keep forever). Global kill switch:
  `AGENT_NATIVE_AUDIT_ENABLED=false`.
