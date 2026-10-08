# Dispatch — Agent Guide

Dispatch is the control plane for workspace resources, shared integrations,
vault secrets, messaging routes, MCP/app setup, and agent operations.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/automations/SKILL.md` — for schedule, webhook, or event rules.
- `.agents/skills/recurring-jobs/SKILL.md` — for background jobs and scheduler behavior.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/adding-workspace-apps/SKILL.md`, `.agents/skills/a2a-protocol/SKILL.md`, `.agents/skills/composable-mini-apps/SKILL.md`,
`.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/turn-into-app/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`, `.agents/skills/build-an-app/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Store large payloads in configured file/blob storage; persist ids/URLs, not file bodies. Never expose or copy secret values or customer/private data.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Dispatch owns identity, readiness, metadata, and grants; domain apps own provider-specific reading/interpretation.
- Prefer actions over raw SQL for vault, integrations, grants, messaging, routing, and approvals. Never widen access silently. For provider capability, use `provider-api-catalog` / `provider-api-docs`, then `provider-api-request` with the shared `connectionId` or OAuth `accountId`; never request raw keys.
- `/agents` imports/creates reusable profiles and starts per-agent chat; `/admin/agents` manages MCP/A2A connections. Import with `import-agent` / `import-agent-pack`, inspect with `list-agent-pack`, and connect public A2A metadata with `connect-external-agent`.
- Dispatch is workspace infrastructure. Factory shares Dispatch's agent and mounted-app registry; do not create a second registry or wrapper app.
- Curated workspace templates are private sources: inspect with `list-curated-workspace-templates`, create an independent app with `remix-workspace-template`, and use only empty/synthetic data. Never copy source records, secrets, credentials, or private config.
- `/admin/operations` is the operator console. Use `navigate --view operations|monitoring|observability|database`; Monitoring and Database reuse framework surfaces. Thread Debug, Audit, and Destinations cover run evidence, change history, and delivery.
- Thread Debug accepts the exact request/run id or chat thread id. Hosted sources appear only with `<APP>_DATABASE_URL` or equivalent configuration. For reliability triage, call `list-agent-run-failures` then `get-agent-thread-debug` with the same source id; preserve per-source health and never infer failures from text search.
- For Slack-linked issues, read `read-slack-thread-context` with the exact permalink and preserve pagination/readability. For usage, use the smallest useful `list-dispatch-usage-metrics` scope/lookback; treat `not-captured` / `unavailable` as gaps, not zero. App adoption uses `scope=app` + `appId`; results are aggregate-only and active means a tracked action.
- Keep approval, routing, and access behavior explicit.

## Application State

- `navigation` exposes the current view and selected integration/resource, approval, route, settings panel, or automation.
- Thread Debug filters include `threadDebugMode`, `sourceId`, `inspectSourceId`, `ownerEmail`, `failureStatus`, `range`, `query`, `runId`, and `threadId`.
- Metrics selection uses `usageScope`, `usageUserEmail`, and `usageAppId`.
- `navigate` moves among setup, vault, integrations, resources, routing, approvals, and operator surfaces.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
