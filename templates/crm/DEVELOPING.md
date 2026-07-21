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

Use workspace Connections for credentials. Never add HubSpot tokens to source,
fixtures, docs, logs, or `.env.example`. Provider API actions are the escape
hatch for legitimate unmodeled HubSpot requests; stage large results and reduce
them via data programs instead of loading an unbounded payload into chat.
