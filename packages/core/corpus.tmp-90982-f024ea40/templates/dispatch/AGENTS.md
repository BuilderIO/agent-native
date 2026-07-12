# Dispatch — Agent Guide

Dispatch is the control plane for workspace resources, shared integrations,
vault secrets, messaging routes, MCP/app setup, and agent operations.

Detailed framework rules live in root skills; this file only keeps Dispatch
specific essentials.

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
- `/operations` is the focused operator console. Its Monitoring tab reuses the
  shared observability dashboard for traces, conversations, evaluations,
  experiments, and feedback; its Database tab reuses the Code-mode database
  admin. Use `navigate --view operations|monitoring|observability|database` and
  `view-screen` to align with the active tab. Use Thread Debug, Audit, and
  Destinations for concrete thread, change-history, and delivery investigations;
  Dispatch does not invent a separate issue tracker when those framework
  surfaces contain the operational evidence.

## Application State

- `navigation` exposes current Dispatch view, selected integration/resource,
  approval, route, or settings panel.
- `navigate` moves the UI to setup, vault, integrations, resources, routing,
  approval, and operator surfaces.

## Skills

Read the relevant skill before deeper work:

- Root `secrets`, `onboarding`, `integration-webhooks`, `external-agents`,
  `a2a-protocol`, `automations`, and `recurring-jobs` for infrastructure work.
- `actions`, `security`, `sharing`, `frontend-design`, and `shadcn-ui` for
  framework implementation. The `actions` skill includes the shared provider API
  pattern for flexible integrations.
