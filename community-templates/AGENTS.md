# Community templates

This is a runnable, seeded gallery for small Agent-Native GTM workflows. Each
catalog entry is a thin template surface, not a replacement for the first-party
CRM, Mail, Calendar, Analytics, or Clips apps.

## How to run

```bash
pnpm dev
pnpm build
pnpm typecheck
```

## Template contract

The source of truth is `src/template-data.ts`. Every template declares its
persona, repeatable job, connected systems, primary action, and UI mode. The
gallery renders the same shared queue, evidence, review, and agent-plan
patterns around each domain's seeded data.

The demo uses local fixtures so the workflows are reviewable without provider
credentials. `sendToAgentChat` stages the selected workflow in a host Agent
Sidebar when one is available; the local agent plan remains visible for the
account-free gallery preview.

## Adding a template

Add a data entry and select an existing `mode` before introducing a new view.
Keep provider details in the owning app when a real integration is added. Any
write that can change external data must become an explicit review step.
