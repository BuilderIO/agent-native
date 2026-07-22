# CRM — Development Guide

CRM is a React Router + Nitro Agent Native template. The UI and agent share the
same `actions/` contract; normal client reads and writes use action hooks, not
custom CRUD routes.

## Commands

- `pnpm dev` — run the local app
- `pnpm typecheck` — run the framework typecheck
- `pnpm test` — run unit tests
- `pnpm build` — build the React Router and Nitro app

## Architecture boundaries

- `shared/crm-contract.ts` is the canonical CRM vocabulary and provider-neutral
  contract.
- `actions/` contains UI/agent operations. Read actions are GET; mutations use
  the shared action surface and must preserve access checks and audit behavior.
- `server/` owns provider adapters, scoped mirror lifecycle, and startup
  plugins. Use a route only for protocols actions cannot model.
- `app/` owns the persistent workspace shell and domain views. Keep normal
  data fetching client-side through `useActionQuery` and `useActionMutation`.

## Data and provider rules

CRM SQL is a thin projection, not a raw HubSpot backup. Only allow-listed
fields are mirrored; remote-only values are fetched ephemerally and redacted
values are never fetched or exposed. Store evidence as bounded references and
quotes only. Raw provider responses, transcripts, media, screenshots, and file
bodies belong in their source system or approved blob storage, never SQL.

Use workspace Connections for credentials. Never add provider tokens to source,
fixtures, docs, logs, or `.env.example`. Provider API actions are the escape
hatch for legitimate unmodeled HubSpot or Salesforce requests; stage large
results and reduce them via data programs instead of loading an unbounded
payload into chat.

## Dashboards

CRM owns its dashboard schema, revision history, access policy, data programs,
and panel resolvers. It composes `@agent-native/toolkit/dashboard` for cards,
tables, layout, and chart rendering only; never add fetching, provider tokens,
or direct SQL access to Toolkit components. The Pipeline dashboard is installed
idempotently through `install-crm-pipeline-dashboard` and reads its bounded
opportunity data through `get-crm-pipeline-data`.

`@agent-native/core/dashboard-storage` is instantiated per app. Keep CRM's
dashboard rows and revisions scoped through its store, and use the `program`
panel source for CRM-owned data programs. Add a provider panel source only when
the CRM adapter can enforce the workspace connection, field policy, and access
scope.

## Signals and provider writes

Call evidence is a Clips-owned artifact reference. CRM may store only bounded
quotes, timestamps, evidence references, confidence, detector/model metadata,
and review state; it must never store a transcript body, media, or provider
payload. Keyword trackers run locally. Smart trackers and call summaries must
delegate to the agent chat, then validate evidence before persisting a signal.

Keep provider mutations proposal-first. `update-crm-record` records a
revision-aware, idempotent proposal for provider-authoritative fields;
`apply-crm-proposals` is the only path that can invoke an adapter after
approval. Delegated policy is narrow, access-scoped, and never bypasses the
field firewall or destructive/bulk gates.
