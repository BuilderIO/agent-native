---
title: "Audit Log"
description: "A durable, append-only record of who changed what app data, when, and whether it was you or the agent — captured automatically at the action seam."
---

# Audit Log

Every agent-native app gets an audit log out of the box: a durable, complete, access-scoped, append-only record of **who mutated what app data, when, from where, and — when it was the agent — in which run.** Capture is automatic at the action seam; you write no code for it.

Because the agent can change data on your behalf, the headline question an audit log answers here isn't just "who edited this record" — it's **"was that me or the agent, and which turn caused it?"** No other system in the framework can answer that.

## Audit vs. observability vs. tracking {#which}

Three systems record "what happened," for three different reasons. Pick by the question you're asking:

| System                                   | The question it answers                                | Fidelity                         | Audience                      |
| ---------------------------------------- | ------------------------------------------------------ | -------------------------------- | ----------------------------- |
| **Audit Log** (this page)                | "Who changed this record, when, and was it the agent?" | **Complete, durable, scoped**    | User, admin, the agent itself |
| **[Observability](/docs/observability)** | "Why did the agent do that, and what did it cost?"     | Sampled span telemetry           | Developer                     |
| **[Tracking](/docs/tracking)**           | "How are people using the product?"                    | Fire-and-forget to external SaaS | PM / growth                   |

An audit log that's sampled or shipped off to an analytics provider is useless — the whole point is that it's complete, local, and queryable. So it's its own subsystem, not a mode of the other two.

## What's captured automatically {#captured}

When any **mutating** action runs (anything that isn't a read-only `GET`), the framework appends one row to `agent_audit_log` with:

- **Action** — the action name (e.g. `delete-recording`).
- **Actor** — `agent`, `human`, or `system`, plus the actor's email — populated **even for agent calls**, so you get "the agent, acting for alice@, …".
- **Run linkage** — the agent `threadId` / `turnId` that triggered the call (a tool call), so a mutation traces back to the exact agent turn.
- **Surface** — `tool` (agent), `frontend`, `http`, `cli`, `mcp`, or `a2a`.
- **Outcome** — `success`, `error` (with an error code), or `denied` (blocked by a human-approval gate).
- **Inputs** — the call arguments, with credential-shaped values [redacted](#privacy).
- **Target & owner** — the resource the action changed, used to [scope reads](#reading).

No wiring needed — the capture hooks into `defineAction` transparently. Read-only actions are skipped, and a few high-frequency framework actions (app-state sync, context-xray, navigation) are skipped by default to avoid flooding the log.

## Declare what an action changed {#target}

By default an event is scoped to the **actor** — you see your own changes and the agent's changes on your behalf. To make a change to a _shared_ resource also appear in the **owner's** trail, and to label events by resource, declare a `target`:

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({
      type: "recording",
      id: args.id,
      // Optional — defaults to the actor. Set when editing someone else's resource.
      ownerEmail: result?.ownerEmail,
      visibility: "org",
    }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

Everything in `audit` is optional. The minimum useful addition is `target: () => ({ type, id })`.

### Tuning capture {#tuning}

| Option               | Effect                                                          |
| -------------------- | --------------------------------------------------------------- |
| `audit.target`       | Label the event with the resource and scope reads to its owner. |
| `audit.summary`      | A short human-readable line for the event.                      |
| `audit.onRead`       | Audit a sensitive **read** (secret access, bulk export).        |
| `audit.enabled`      | `true` forces capture on; `false` opts a noisy mutation out.    |
| `audit.recordInputs` | `false` skips capturing the (already redacted) arguments.       |

## Reading the trail {#reading}

Two read actions are available to the agent **and** the frontend in every app, scoped in SQL to the caller — they never return another tenant's rows:

- **`list-audit-events`** — filter by `targetType` / `targetId`, `actorKind` (`agent` | `human` | `system`), `status`, `threadId` / `turnId`, `action`, `sinceMs`, and `limit`.
- **`get-audit-event`** — one event by id, including its redacted input payload.

Build an activity feed or a "who changed this" line by calling `list-audit-events` from the UI with `useActionQuery` — never hand-write a fetch to the audit table:

```tsx
import { useActionQuery } from "@agent-native/core/client";

const { data } = useActionQuery("list-audit-events", {
  targetType: "recording",
  targetId: recordingId,
});
// data.events → [{ action, actorKind, actorEmail, turnId, status, summary, createdAt }, …]
```

The agent can call the same action — ask it "what did you change on this recording?" and it answers from the trail.

## Privacy & retention {#privacy}

- **Redaction** — before any inputs are stored, credential-shaped keys and values (tokens, secrets, passwords, bearer strings) are stripped and oversized payloads truncated. The audit log never becomes a secondary store of secrets. Keep `summary` text free of sensitive data too.
- **Append-only** — there is no update or delete action for audit rows. The only deletion is the retention purge, which makes the log trustworthy as an audit trail.
- **Tenant isolation** — reads are scoped to the caller's identity and org; with no identity, nothing matches.

Configure via environment:

- `AGENT_NATIVE_AUDIT_RETENTION_DAYS` — how long rows are kept (default `365`; `0` = keep forever).
- `AGENT_NATIVE_AUDIT_ENABLED=false` — global kill switch.

## What's next

- [**Actions**](/docs/actions) — the `defineAction` seam where capture happens
- [**Human-in-the-Loop Approvals**](/docs/human-approval) — gated actions, recorded as `denied`
- [**Security & Data Scoping**](/docs/security) — the ownership model audit reads reuse
- [**Observability**](/docs/observability) — agent-run telemetry (the other "what happened")
