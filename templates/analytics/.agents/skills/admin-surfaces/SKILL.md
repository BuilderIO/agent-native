---
name: admin-surfaces
description: >-
  The /agents admin home for Analytics: fleet feature-flag control plane,
  dashboard usage audit, and connected-app database admin. Use when an admin
  asks about feature flags/rollouts, dashboard usage stats, or connecting
  another agent-native app's database.
---

# Admin Surfaces (`/agents`)

`/agents` is the Analytics home for admin surfaces. The default Monitoring
view embeds the shared observability dashboard for traces, conversations,
evals, agent experiments, and feedback.

## Feature Flags (`?view=flags`)

`/agents?view=flags` is the sole admin-only fleet feature-flag control plane.

- Call `list-workspace-feature-flags` before changing a flag.
- Preserve each app's explicit state: `unsupported`, `unreachable`,
  `forbidden`, and `unknown-legacy` are unknown states, **never** synonyms for
  off. Do not collapse them to a disabled toggle.
- Use `set-workspace-feature-flag` for app-qualified changes; target apps
  remain the source of truth and are resolved only through the trusted
  organization directory.
- Treat only a versioned mutation response whose key, org scope, and
  requested rules match as success. Report a failed target mutation instead
  of claiming the rollout changed.
- Flags are source-declared booleans; do not create variants, metrics,
  exposure tracking, or per-app management panels.

## Dashboard Usage (`?view=dashboards`)

`/agents?view=dashboards` shows the admin-only dashboard usage audit. Call
`list-dashboard-usage-stats` when admins ask about dashboard created/modified
dates, owners, last tracked modifier, views, edits, engagements, saved views,
or cleanup candidates. The dashboard overflow menu shows created/updated
timestamps and their tracked actors for both SQL and Explorer dashboards.

## Connected Database Admin (`?view=database`)

The Advanced menu opens `/agents?view=database`, where organization
owners/admins can connect other agent-native app databases and use the
shared database admin tool for table browsing, row editing, and SQL
inspection. This surface is for connected target app databases, not broad
access to all Analytics data.

Keep future admin additions inside this route instead of adding many
top-level sidebar tabs.

## Related Skills

- Root **feature-flags** (dev-scope) — how to declare and register a flag in
  app code; this skill covers only the Analytics fleet control-plane UI/actions.
