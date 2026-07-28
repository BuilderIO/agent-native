---
name: agent-native-toolkit
description: >-
  Inventory and ownership rules for shared Agent Native workspace UI. Use
  before building app chrome, settings, navigation, sharing, collaboration,
  setup, history, comments, chat rails, agent UX, or repeated workspace behavior.
scope: dev
metadata:
  internal: true
---

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

## Discover Before Building

Before creating an app-local version of repeated workspace or agent UI:

1. Check the reusable kits below and the installed package documentation.
2. Search installed public components and source with `docs-search` and
   `source-search`.
3. Run `agent-native eject --list` to see the version-matched units published
   by the packages installed in this app.
4. Read `customizing-agent-native` and configure, compose, or eject the
   smallest unit instead of recreating shared behavior from memory.

Use public package exports at runtime. Published source and ejection manifests
are discovery and ownership-transfer mechanisms, not private runtime APIs.

## Design-System Boundary

Every app keeps an explicit design-system seam in `app/design-system.ts` using
`defineDesignSystem` from `@agent-native/toolkit/design-system`, and supplies it
to `ToolkitProvider`. The semantic contract contains:

- nine leaf components: `ActionButton`, `IconButton`, `TextField`, `TextArea`,
  `Spinner`, `Skeleton`, `Status`, `Surface`, and `Avatar`
- eight behavior components: `Tooltip`, `Menu`, `Popover`, `Dialog`, `Picker`,
  `Checkbox`, `Switch`, and `Tabs`

These are semantic contracts, not styling contracts. An adapter may use
Tailwind/shadcn, MUI-style theme providers, React Aria, CSS modules, CSS-in-JS,
or another React design system. Do not assume CVA, utility classes, or even a
`className`; behavior adapters may supply their overlay and focus
implementation wholesale while honoring portal, focus-restoration, keyboard,
dismissal, ARIA, and z-index interoperability.

Pages, routes, and domain components import ordinary controls through the app's
local adapter layer, usually `@/components/ui/*`. They must not import
`@agent-native/toolkit/ui/*` directly. Toolkit feature exports are still the
right home for shared workspace behavior; their presentation flows through the
registered semantic components, feature controller, and product-level slots.

Customer adapter packages are normal npm packages imported explicitly by the
app. Never auto-detect them or load React components from JSON. Run the adapter
against `@agent-native/toolkit/conformance` in customer CI before adopting it.

## Settings Direction

Durable settings belong in the Settings app or a registered settings route. The
agent sidebar should not become a second settings app. It can show contextual
quick controls and deep links such as:

- `/settings/ai`
- `/settings/connections`
- `/settings/secrets`
- `/settings/usage`
- `/settings/apps/:appId`

The shared Account section is the canonical profile surface at
`/settings#account`. It owns the editable display name and existing avatar
control through the authenticated `get-user-profile` and `update-user-profile`
actions. Shared workspace chrome such as `OrgSwitcher` should link to this
surface rather than creating an app-local profile page.

When adding a new API key, OAuth grant, provider connection, model selector, app
preference, notification preference, or usage/billing surface, register it as a
settings tab or app settings panel first. Only add sidebar UI when it is needed
in the moment of agent use.

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
- **Chat history kit**: presentational chat lists and recent-chat rails belong
  in Toolkit; Core keeps thread persistence, agent execution, transport, and
  page-to-sidebar handoff. Use Toolkit's `ChatHistoryRail` for the standard
  five-item sidebar preview and a footer row with New chat followed by an
  ellipsis disclosure up to fifteen. Apps inject routing, labels, and domain
  actions.
- **Agent page kit**: the full-page `/agent` surface (`AgentTabsPage` from
  `@agent-native/core/client`) with Context, Files, Connections, Jobs, and
  Access tabs plus a Personal/Organization scope toggle. The canonical home
  for context transparency, MCP servers, A2A remote agents, recurring
  jobs/automations, and external-client connect flows. See the `agent-page`
  skill.
- **History and recovery kit**: audit log, activity feed, version history,
  checkpoints, undo, redo, restore, and proof-of-done.
- **Comments and review kit**: anchored comments, pins, mentions, review
  requests, resolved threads, agent follow-up tasks, and notifications.
- **Workflow and observability kit**: notifications, approvals, scheduled work,
  background runs, recurring jobs, traces, evals, feedback, and run timelines.

## Implementation Checklist

When adding or refactoring one of these areas:

1. Search existing framework and template code for duplicated UI or actions.
2. Decide the shared contract: data shape, action API, feature-level headless
   controller, default view, semantic components, and product-level render
   slots.
3. Keep shared data provider-agnostic and scoped by auth/sharing rules.
4. Expose the same capability to the UI and agent through actions or documented
   client helpers.
5. Register app-specific labels, routes, resource adapters, and settings panels
   instead of hardcoding app names in core UI.
6. Update docs and relevant skills so future apps discover the shared path.
7. Keep the component easy to adopt piecemeal: expose props/slots first and
   ship readable source plus a complete ejection unit so apps can take ownership
   of the smallest feature when needed. See `customizing-agent-native` for the
   configure → compose → eject → propose seam ladder.
8. Keep one controller as the source of truth for the default and custom render
   paths. A custom design must not fork actions, analytics, async state, or
   accessibility behavior.
9. Verify the default adapter and at least one non-Tailwind adapter with the
   conformance kit, including focus and portal stacking across mixed overlay
   implementations.

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
