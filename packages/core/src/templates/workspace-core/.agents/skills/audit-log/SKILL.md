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

## Reading the log

Two actions are available to the agent and the frontend in every app, scoped in
SQL to the caller — they never leak another tenant's rows:

- `list-audit-events` — filter by `targetType`/`targetId`, `actorKind`
  (`agent` | `human` | `system`), `status`, `threadId`/`turnId`, `action`,
  `sinceMs`, `limit`.
- `get-audit-event` — one event by id, with its redacted input payload.

Call them from the UI with `useActionQuery` to build an activity feed or a
"who changed this" line — never hand-write a fetch to the audit table.

## Never

- Don't write a parallel "history" table for a resource — declare an `audit.target`
  and read it back instead.
- Don't put secrets in `summary` or rely on inputs being safe — redaction covers
  credential-shaped values, but keep summaries free of sensitive data.
- Don't expose an update/delete path for audit rows. The log is append-only; the
  only deletion is the retention purge (`AGENT_NATIVE_AUDIT_RETENTION_DAYS`,
  default 365 days; `0` = keep forever). Global kill switch:
  `AGENT_NATIVE_AUDIT_ENABLED=false`.
