# CRM — Agent Guide

CRM is a typed, bitemporal system whose grid is the product: Native SQL or a scoped HubSpot/Salesforce lens, with shared UI and agent actions.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. App: `.agents/skills/crm/SKILL.md` (providers, credentials, lists, enrichment, signals, dashboards, Clips evidence). Shared: `.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`.

## Core model

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Call `list-crm-attributes` before writing: there are 17 typed attributes, including system-only interaction and personal-name types. Never guess a slug/type. Select/status values must be existing managed options; unknown options return 422.
- Values are bitemporal: a changed value closes the current row and opens another; equal writes store nothing. `historyTracked=false` means in-place updates, not no history.
- Lists overlay one object type and are locally authoritative on every backend, including HubSpot and Salesforce. Saved views store filters, sort, columns, audience, and table/board mode; `"@currentUser"` resolves to the caller.
- Enrichment is two-phase: free `verify`, then paid `spend` built only from approved record ids.

## Hard boundaries

- Workspace Connections own provider credentials. Never request, store, log, or return provider tokens. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Keep the provider mirror thin: unknown fields stay remote-only, sensitive values are redacted, and only allowlisted fields are mirrored. No raw payloads, transcripts, media, or base64 in SQL; evidence is a URL/id plus a bounded quote.
- A provider-owned edit is a handoff: `apply-crm-proposals` records a proposal and returns the exact diff/deep link. CRM never completes or reports an upstream write as applied.
- Ownership, amount, stage, deletion, bulk scope, and external side effects need exact preview and approval. Never merge identities from email/domain alone; treat them as duplicate signals requiring review.
- Use actions and preserve access checks. Use `view-screen` when the visible record, selection, or view matters; `navigate` to a view. Never turn an unreadable owner, slot, or scope into an empty value. Read writes back before reporting success and recover from recoverable errors.

## Key actions

Use `tool-search` for the full action surface.

| Action | Purpose |
| --- | --- |
| `get-crm-workspace` / `get-crm-overview` | Start with identity, records, tasks, proposals, signals, and health |
| `list-crm-attributes` / `create-crm-attribute` / `update-crm-attribute` / `manage-crm-attribute-option` | Read or author typed schema/options |
| `list-crm-records` / `list-crm-record-values` / `get-crm-record` / `create-crm-record` / `update-crm-record` | Read and mutate records |
| `list-crm-lists` / `create-crm-list` / `list-crm-list-entries` / `add-crm-record-to-list` / `update-crm-list-entry` | Manage workflow lists; stage moves update entries |
| `list-crm-proposals` / `apply-crm-proposals` | Review provider changes and hand them off |
| `estimate-crm-enrichment` / `run-crm-enrichment` | Estimate, verify, then run the gated paid job |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Exact provider reads not expressed by an action |

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
