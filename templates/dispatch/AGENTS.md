# Dispatch — Agent Guide

Dispatch is the control plane for workspace resources, shared integrations,
vault secrets, messaging routes, MCP/app setup, and agent operations.

Detailed framework rules live in root skills; this file only keeps Dispatch
specific essentials.

## Core Rules

- Treat Dispatch as workspace infrastructure. Prefer actions over raw SQL for
  vault, integrations, resource grants, messaging, routing, and approvals.
- Do not expose secret values. Vault stores references and encrypted values; apps
  receive grants or credential refs, not copied tokens.
- Workspace integrations own provider identity, readiness, metadata, and grants.
  Domain apps still own provider-specific readers and interpretation.
- For integration webhooks, use the queue-and-processor pattern. Do not rely on
  fire-and-forget promises after a serverless response.
- Use `view-screen` when the current integration, resource, approval, route, or
  setup item is unclear.
- Keep approval and routing behavior explicit. Never silently widen access to
  secrets, apps, integrations, or workspace resources.

## Application State

- `navigation` exposes current Dispatch view, selected integration/resource,
  approval, route, or settings panel.
- `navigate` moves the UI to setup, vault, integrations, resources, routing, and
  approval surfaces.

## Skills

Read the relevant skill before deeper work:

- Root `secrets`, `onboarding`, `integration-webhooks`, `external-agents`,
  `a2a-protocol`, `automations`, and `recurring-jobs` for infrastructure work.
- `actions`, `security`, `sharing`, `frontend-design`, and `shadcn-ui` for
  framework implementation.
