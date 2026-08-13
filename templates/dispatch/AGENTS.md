# Dispatch — Agent Guide

Dispatch is the control plane for workspace resources, shared integrations,
vault secrets, messaging routes, MCP/app setup, and agent operations.

## Skills

Read the relevant skill before deeper work:

- `automations` for event- and schedule-triggered automation rules on
  `/admin/automations`.
- `recurring-jobs` for scheduled/background job behavior and the scheduler.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL:
  persist URLs, ids, or handles instead of base64, media, documents, archives,
  screenshots, thumbnails, or replay chunks.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Treat Dispatch as workspace infrastructure. Prefer actions over raw SQL for
  vault, integrations, resource grants, messaging, routing, and approvals.
- Do not expose secret values. Vault stores references and encrypted values; apps
  receive grants or credential refs, not copied tokens.
- Workspace integrations own provider identity, readiness, metadata, and grants.
  Domain apps still own provider-specific readers and interpretation.
- Integration grants are not provider capability limits. For ad hoc provider
  inspection, querying, reporting, or troubleshooting, call
  `provider-api-catalog` / `provider-api-docs`, then `provider-api-request`
  against the provider's real HTTP API. Use `connectionId` for a specific shared
  grant and `accountId` for a specific OAuth account. Do not expose secret
  values or silently widen app access while doing this.
- Use `view-screen` when the current integration, resource, approval, route, or
  setup item is unclear.
- Use `import-agent` to normalize safe Claude Markdown or JSON into an
  `agents/<slug>.md` profile; it skips credentials, hooks, shell, and local env.
- Use `import-agent-pack` for a Claude Project/Cowork-style folder. It keeps the
  runnable profile at `agents/<slug>.md` and stores text references, context,
  and agent-owned skills below `agents/<slug>/`. Use `list-agent-pack` to
  inspect the files and the shared agent pack UI to edit them.
- Use `connect-external-agent` for public HTTP/A2A metadata; authenticate through
  the normal connection flow.
- Dispatch's primary nav is Overview, Chat, Apps, Agents, and the app rail.
  `/agents` creates/imports reusable profiles, opens per-agent chat, and can
  hand a profile off to app creation; `/admin/agents` manages technical MCP/A2A
  connections; other workspace/operator tools live under `/admin`.
- Agent profiles and agentic apps are also managed from Factory's top-level
  Agents tab. Factory embeds the same agent actions and pack editor and reads
  mounted app metadata through the shared Dispatch database; it does not create
  a second agent registry.
- Keep approval and routing behavior explicit. Never silently widen access to
  secrets, apps, integrations, or workspace resources.
- Curated workspace templates are private app sources. Use
  `list-curated-workspace-templates` to inspect the reviewed catalog and
  `remix-workspace-template` to create an independent app. A new app may use
  empty or synthetic data only; never copy source-app records, credentials,
  secrets, or private configuration.
- `/admin/operations` is the focused operator console. Its Monitoring tab reuses the
  shared observability dashboard for traces, conversations, evaluations,
  experiments, and feedback; its Database tab reuses the Code-mode database
  admin. Use `navigate --view operations|monitoring|observability|database` and
  `view-screen` to align with the active tab. Use Thread Debug, Audit, and
  Destinations for concrete thread, change-history, and delivery investigations;
  Dispatch does not invent a separate issue tracker when those framework
  surfaces contain the operational evidence.
- Thread Debug accepts the copied request/run ID from an Agent Native chat
  response as well as a chat thread ID; use the exact source that owns the run.
  Hosted production sources appear only when Dispatch has their
  <APP>_DATABASE_URL connection variables (or an equivalent
  AGENT_NATIVE_THREAD_DEBUG_DATABASES configuration).
- For reliability triage, call `list-agent-run-failures` first, then inspect a
  returned run with `get-agent-thread-debug` using the same source id. Do not
  infer run failure from thread text search. Cross-app results may be partial;
  preserve the returned per-source health instead of treating an unavailable
  source as zero failures.
- For a Slack-linked issue, call `read-slack-thread-context` with the exact
  permalink before diagnosing it; preserve its pagination and readability
  status instead of treating an unreadable thread as empty.
- For usage investigations, use `list-dispatch-usage-metrics` with the smallest
  useful scope and lookback. Treat `not-captured` and `unavailable` attribution
  as gaps, not zero usage; use `view-screen` on `/admin/metrics` to align with
  the visible scope and selected user.

## Application State

- `navigation` exposes current Dispatch view, selected integration/resource,
  approval, route, or settings panel.
- On Thread Debug, `navigation.threadDebugMode`, `sourceId`,
  `inspectSourceId`, `ownerEmail`, `failureStatus`, `range`, `query`, `runId`,
  and `threadId` expose the visible failure or thread filters and selection.
- On Metrics, `navigation.usageScope` exposes whether the visible usage view is
  personal or workspace-wide, and `navigation.usageUserEmail` exposes the
  selected workspace member filter.
- `navigate` moves the UI to setup, vault, integrations, resources, routing,
  approval, and operator surfaces.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
