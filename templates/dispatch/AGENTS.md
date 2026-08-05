# Dispatch — Agent Guide

Dispatch is the control plane for workspace resources, shared integrations,
vault secrets, messaging routes, MCP/app setup, and agent operations.

Detailed framework rules live in root skills; this file only keeps Dispatch
specific essentials.

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
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
- For integration webhooks, use the queue-and-processor pattern. Do not rely on
  fire-and-forget promises after a serverless response.
- Use `view-screen` when the current integration, resource, approval, route, or
  setup item is unclear.
- Keep approval and routing behavior explicit. Never silently widen access to
  secrets, apps, integrations, or workspace resources.
- Curated workspace templates are private app sources. Use
  `list-curated-workspace-templates` to inspect the reviewed catalog and
  `remix-workspace-template` to create an independent app. A new app may use
  empty or synthetic data only; never copy source-app records, credentials,
  secrets, or private configuration.
- `/operations` is the focused operator console. Its Monitoring tab reuses the
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
  source as zero failures. Read-only Thread Debug operators can inspect
  organization-owned service-principal traces, but not another organization's
  traces or any broader Dispatch mutation surface.
- For a Slack-linked issue, call `read-slack-thread-context` with the exact
  permalink before diagnosing it. It resolves child links to the parent thread,
  preserves attachments and related URLs, and reports whether pagination is
  complete. Never treat an unreadable Slack thread as an empty one.

## Application State

- `navigation` exposes current Dispatch view, selected integration/resource,
  approval, route, or settings panel.
- On Thread Debug, `navigation.threadDebugMode`, `sourceId`,
  `inspectSourceId`, `ownerEmail`, `failureStatus`, `range`, `query`, `runId`,
  and `threadId` expose the visible failure or thread filters and selection.
- `navigate` moves the UI to setup, vault, integrations, resources, routing,
  approval, and operator surfaces.

## Skills

Read the relevant skill before deeper work:

- Root `secrets`, `onboarding`, `integration-webhooks`, `external-agents`,
  `a2a-protocol`, `automations`, and `recurring-jobs` for infrastructure work.
- `actions`, `security`, `sharing`, `frontend-design`, and `shadcn-ui` for
  framework implementation. The `actions` skill includes the shared provider API
  pattern for flexible integrations.
