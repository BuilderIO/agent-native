# Agent-Native Toolkit

Use this skill when deciding whether app chrome, settings, collaboration,
sharing, navigation, organization, setup, history, comments, or agent UX should
be built app-locally or moved into reusable framework/toolkit pieces.

## Core Rule

Apps own domain models, domain actions, and product-specific workflows. The
framework and `@agent-native/toolkit` own repeated workspace behavior users
expect to work the same everywhere.

Move behavior into shared toolkit primitives when it is:

- workspace-wide, such as settings, nav, search, org membership, or setup
- agent-visible, such as context, actions, run progress, or proof-of-done
- governed, such as secrets, permissions, sharing, audit, or billing
- repeated by two or more apps
- not tied to one domain model

Keep behavior app-local when the abstraction would hide important domain
language or make a simple app-specific workflow harder to understand.

## Settings Direction

Durable settings belong in the Settings app or a registered settings route. The
agent sidebar should not become a second settings app. It can show contextual
quick controls and deep links such as:

- `/settings/ai`
- `/settings/connections`
- `/settings/secrets`
- `/settings/usage`
- `/settings/apps/:appId`

When adding a new API key, OAuth grant, provider connection, model selector, app
preference, notification preference, or usage/billing surface, register it as a
settings tab or app settings panel first. Only add sidebar UI when it is needed
in the moment of agent use.

## Integration Setup Preflight

Before building any setup, settings, credential, OAuth, or connection surface,
search the framework and toolkit for an existing primitive and classify each
provider value by its lifecycle and scope:

| Need | Default primitive |
| --- | --- |
| Deploy- or app-level configuration | Runtime configuration or deployment env vars |
| User-, workspace-, or org-scoped API/service key | `registerRequiredSecret({ kind: "api-key" })` and the vault |
| Authorization-code or refresh-token flow | `kind: "oauth"` with `@agent-native/core/oauth-tokens` |
| Account, customer, or other non-secret identifiers | Scoped connection metadata or app data |
| Provider-specific prerequisites, sequencing, or health | A thin app-local guide over the shared primitives |

Do not register every provider field as a generic secret, mark every field as
required, or create a second credential-management surface. One logical
connection should normally produce one onboarding outcome. A custom setup page
is appropriate only when it adds domain-specific guidance or readiness checks;
it should link to or call the shared settings, OAuth, and action surfaces rather
than duplicating their storage or transport.

## Reusable Kits

- **Settings kit**: a searchable settings page with account, workspace, AI
  models, LLM keys, connections, secrets, usage, notifications, changelog, and
  app-specific panels. Search is on by default; register a `SettingsSearchEntry`
  per control so users find settings by name across tabs.
- **Collaboration kit**: Yjs docs, presence, agent presence, live cursors,
  remote selections, recent edit highlights, real-time sync indicators, and
  undo/redo grouping.
- **Sharing kit**: private/workspace/org/public-link access, invites, roles,
  expirations, agent-readable links, and resource registration.
- **Navigation and command kit**: app shell, side nav, breadcrumbs, app switcher,
  command palette entries, recent resources, pinned resources, and global search.
- **Organization kit**: folders, tags, favorites, archive, trash, ownership,
  membership, and common resource metadata.
- **Setup and connections kit**: declarative setup requirements, model readiness,
  missing-secret states, OAuth grants, and provider connection health.
- **Agent UX kit**: sidebar, composer, staged context, mentions, voice, human
  approval, generative UI, progress, and screen-state exposure.
- **History and recovery kit**: audit log, activity feed, version history,
  checkpoints, undo, redo, restore, and proof-of-done.
- **Comments and review kit**: anchored comments, pins, mentions, review
  requests, resolved threads, agent follow-up tasks, and notifications.
- **Workflow and observability kit**: notifications, approvals, scheduled work,
  background runs, recurring jobs, traces, evals, feedback, and run timelines.

## Implementation Checklist

When adding or refactoring one of these areas:

1. Search existing framework and template code for duplicated UI or actions.
2. Decide the shared contract: data shape, action API, React component/hook, and
   app adapter points.
3. Keep shared data provider-agnostic and scoped by auth/sharing rules.
4. Expose the same capability to the UI and agent through actions or documented
   client helpers.
5. Register app-specific labels, routes, resource adapters, and settings panels
   instead of hardcoding app names in core UI.
6. Update docs and relevant skills so future apps discover the shared path.

## Related Skills

Read these alongside this skill when the work touches the specific area:

- `sharing`
- `real-time-collab`
- `real-time-sync`
- `client-side-routing`
- `context-awareness`
- `onboarding`
- `secrets`
- `audit-log`
- `observability`
- `frontend-design`
