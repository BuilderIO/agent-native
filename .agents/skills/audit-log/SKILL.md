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
(`org-member-role`), file storage (`file-storage`), and org-scoped Builder.io
connect and disconnect (`builder-connection`). A member's personal Builder.io
connection is `private`.

## Record an organization settings or admin change

Use the helpers in `@agent-native/core/audit` instead of hand-setting
`visibility`, so every org setting lands in the organization trail the same way:

```ts
import { orgAdminAudit, recordOrgAdminAuditEvent } from "@agent-native/core/audit";

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
});
```

Pass `personal: true` to `recordOrgAdminAuditEvent` when the change affects
only the actor. New settings actions (restrict personal keys, service
providers) use `orgAdminAudit`.

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

Call them from the UI with `useActionQuery` to build an activity feed or a
"who changed this" line — never hand-write a fetch to the audit table.

Settings › Organization › Audit log (`/settings/audit`, owners and admins, with
the `settings-redesign` flag on) is that trail's page, in
`packages/core/src/client/settings/shell/pages/audit.tsx`. Its range and app
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
