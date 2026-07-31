# Factory

Factory is the product-team domain app for building agent factories from
incoming work to governed delivery. Dispatch owns the shared inbox and
routing; Factory owns queue state, rules, decisions, feedback, agent runs, and
provider-action audit records.

Before building common workspace or agent UI, read `agent-native-toolkit`; use
`customizing-agent-native` for the configure → compose → eject → propose
ladder.

## Core rules

- Keep app state in SQL via Drizzle and scope every read/write by org and
  authenticated member. Use actions as the UI, agent, CLI, MCP, and A2A surface.
- Keep migrations additive and portable. These tables intentionally use explicit
  `ownerEmail`/`orgId` columns for org-visible data, not `ownableColumns()`;
  do not call `accessFilter` on them without adding deliberate visibility data.
- Resolve Slack through `server/connectors/credentials.ts`, passing caller
  identity at the entrypoint. The dependency guard does not inspect nested
  connector code, so a new direct `process.env.SLACK_BOT_TOKEN` read is a bug.
- A missing callback, partial thread, unreadable provider response, or missed
  reconciliation is not success. Preserve typed failure or
  `reconciliation_required` state.
- Hard guards are code, not prompt text: auth, session, identity,
  credentials/vault, migrations, payments, security, and publishable
  `packages/*` changes always require human review.
- All work is deduped by Factory item and rule/run identity. Provider comment IDs
  are not the idempotency boundary.
- Slack interaction uses the generic Agent-Native Slack adapter. Polling is for
  observation; mentions are for explanation, rule tuning, and explicit approval.
- Reuse the existing ai-services GitHub read and Builder execution APIs. Do not
  duplicate GitHub installation/webhook infrastructure in this template.
- Do not add CRUD routes under `server/routes/api/`; actions are the domain
  surface. Provider callbacks are the only exception and must verify signatures.

## Action contract

| Action | Purpose |
| --- | --- |
| `list-triage-items` / `get-triage-item` | Inspect the queue and evidence. |
| `poll-slack-channel` | Observe Slack history; never writes to Slack. |
| `ingest-github-observation` | Store read-only PR evidence. |
| `list-triage-rules` / `save-triage-rule` | Tune prompt rules and guards. |
| `evaluate-triage-item` | Append a structured decision. |
| `record-triage-feedback` | Capture human correction for learning. |
| `approve-factory-item` | Explicitly authorize one bounded run. |
| `suggest-factory-rules` | Mine feedback and fast approvals into proposals. |
| `reconcile-triage-run` | Persist callback/provider reconciliation. |

Rules start in shadow mode. Enabling a rule never bypasses hard guards or
creates an implicit approval. Slack "do it now" and the UI approval control
both call `approve-factory-item`, which records the approver before dispatch.

## Scheduler identity

`WORKSPACE_OWNER_EMAIL` is read only at startup to stamp the deployment-owned
job's `createdBy`; it is never caller identity and must not enter request
authorization or credential resolution.

## Hosting

Production needs `DATABASE_URL`, `WORKSPACE_OWNER_EMAIL`, and
`FACTORY_PUBLIC_URL`. Builder execution additionally needs the service URL and
project ID plus workspace-resolved Builder credentials. Keep rules in shadow
mode and require an explicit approval for every provider run.
