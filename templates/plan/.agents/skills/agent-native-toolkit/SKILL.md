---
name: agent-native-toolkit
description: >-
  Inventory and ownership rules for shared Agent-Native workspace UI. Use
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

## Agent Surface Contract

The repeated app shell has two distinct navigation surfaces:

- The left rail owns domain destinations and chat history when the app has a
  full-page chat route. Do not label a domain workflow as `Chat` just because
  the app was scaffolded from the chat template.
- Settings is not a rail item. It opens from the account menu (`OrgSwitcher`
  in the sidebar footer) and from ⌘, (Ctrl+, elsewhere), which `AppProviders`
  already binds. Keep the `/settings` route; don't add a Settings entry to
  `items`, `secondaryItems`, or the footer.
- The right `AgentSidebar` owns contextual agent work. Domain buttons that call
  `sendToAgentChat` should open it (`openSidebar: true`) so the user can see,
  steer, and review the agent without losing the page they were using.
- Keep `/` or `/chat/*` as the full-page chat surface when the starter provides
  one. Put domain workflows on named routes and wire the shell's route checks,
  navigation labels, and handoffs to those routes together.
- Use familiar message or neutral action icons for agent affordances. Never use
  sparkle, wand, magic, or robot icons as an AI label; the copy should carry the
  meaning.
- Give the right rail a quiet visual boundary with a subtle surface shift,
  divider, or both. The domain page and AgentSidebar should not collapse into a
  single undifferentiated background.
- Any button labeled as agent work must use `sendToAgentChat` with bounded
  context and `openSidebar: true`; local deterministic analysis should be
  labeled as local, preview, or analyze. For original/generated review, stack
  the source above the result by default and use side-by-side only for short,
  highly scannable content.
- Deterministic implementation does not make an AI-shaped experience
  deterministic. If the user expects research, analysis, generation,
  recommendation, synthesis, visible progress, or steering, route the button
  to the AgentSidebar and let the agent call focused actions. Keep revisions in
  the same thread instead of adding a second freeform prompt box.
- Standalone apps with `AgentSidebar` must resolve one assistant-ui runtime
  context. Match direct assistant-ui pins to the installed core/toolkit peer
  graph, use Vite dedupe/aliases when linked dependencies can split contexts,
  and verify an AI handoff produces no stale-index console error.

Contextual agent UI is not a reason to expose every option at once. Start with
the domain task's primary action, reveal review or configuration only when the
current state needs it, and let the sidebar carry conversational depth.

## Visual Direction And Workspace Variety

Shared workspace behavior should be consistent without forcing every app into
the same visual skin. Keep shell and component tokens semantic, then let each
app declare a named direction in `DESIGN.md` before styling. A new app should
choose its palette family and composition from the product context, compare
nearby apps, and avoid inheriting their accent by default. Use the
`frontend-design` visual-direction reference for mode, palette, type, density,
shape, anti-references, and the `distill` / `typeset` / `colorize` / `layout` /
`polish` / `audit` review vocabulary.

Do not make warm beige plus terracotta the workspace fallback. Preserve a
workspace-level brand when one exists; otherwise keep shared chrome neutral and
allow app-owned accents to distinguish products while retaining accessible
semantic states and the shared AgentSidebar contract.

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

Durable settings belong in Settings. The agent sidebar should not become a
second settings app; it can show contextual quick controls and deep links. The
redesigned Settings (`settings-redesign` flag) has the same groups in every app,
and page ids are stable URL segments (`/settings/<page>/<sub>`):

- Account: `profile`, `preferences`, `security`
- Connections: `integrations` (`integrations/builder`), `api-keys`
- Agent: `model`, `instructions`, `memory`, `skills`, `files`, `sub-agents`
- Organization: `org`, `members`, `usage`, and for owners and admins `auth`,
  `apps`, `infra`, `audit`
- The app's group: `app` (areas at `app/<id>`), `notifications`,
  `automations`, `channels` (`channels/<platform>`), `mcp`, `creative-context`
- Footer: `labs`, `whats-new`

Link with `buildSettingsRoute(page, sub?, { anchor? })`; old tab and section
ids resolve through the redirect table in
`packages/core/src/navigation/settings-redirects.ts`, the only place that maps
them. Account › Profile is the canonical profile surface (`get-user-profile`,
`update-user-profile`); don't build an app-local profile page.

When adding a new API key, OAuth grant, provider connection, model selector, app
preference, notification preference, or usage/billing surface, find the page
that owns that kind of setting first: provider keys go through the one provider
dialog on Model, other keys on API keys, channels on Channels, and app-only
preferences in the app's group. Only add sidebar UI when it is needed in the
moment of agent use.

### The app's group in the redesigned Settings

Behind the `settings-redesign` flag, Settings has a group named after the app.
Core owns its pages: General, Notifications, Automations, Channels, MCP server,
Creative context, plus Labs and What's new in the footer. A template supplies
only its own content, through these `SettingsTabsPage` props:

- `generalGroups`: the app's own `SettingsGroup`s on its General page. Core puts
  Agent › Default model above them (owners and admins change it; the agent
  uses `manage-agent-engine` `set-app-default`) and This browser › Demo mode
  below. Until a template passes it, today's `general` shows there.
- `appAreas`: `[{ id, label, content, visible?, keywords?, searchEntries? }]`,
  tabs on the General page routed `/settings/app/<id>`. Set `visible: false`
  while the lab behind an area is off. A tab with
  `settingsPlacement: "app-area"` in `extraTabs` works the same.
- `notifications` (plus `notificationsSearchEntries`): the Notifications page
  shows only when this is passed.
- `mcpAbout`: the MCP server page's about line, naming what an MCP host can do
  in this app.
- Labs come from `labs`; What's new comes from `whatsNewMarkdown`, or from the
  `ChangelogSettingsCard` passed as `whatsNew`.
- Any other `extraTabs` item becomes its own page in the app's group. To swap a
  core page for a variant, `registerSettingsPages([{ ...corePage, component }])`
  at module scope (Dispatch's Members keeps its app-role column this way). To
  add a group to one channel's page, `registerChannelSettingsExtensions`.

The route needs a `settings.$.tsx` splat next to `settings.tsx`, and the layout
hides its own sidebar and header on Settings routes while the flag is on or
loading (`isSettingsPathname`), because the shell brings its own.

Search entries per area: each `searchEntries` item's `hash` is the row's
`SettingsRow` id, and a hit opens that area's tab and scrolls to the row. With
the flag off, the same props render as today's tabs, so a migrated template
works either way. Link with `buildSettingsRoute("app", "<area>")`, never a
hand-written path.

Gate UI on a lab with `useLab(LAB_DEFINITION)` rather than `useLab(key)`: a
definition reads as its `defaultEnabled` until the server answers, while a bare
key reads as on.

## Integration Setup Preflight

Before building any setup, settings, credential, OAuth, or connection surface,
search the workspace/provider connection catalog first. If the provider already
has a reusable connection, use its catalog, app grant, and scoped credential
resolver rather than registering a parallel secret. Only then classify fields
that still need app-local setup by lifecycle and scope:

| Need | Default primitive |
| --- | --- |
| Deploy- or app-level configuration | Runtime configuration or deployment env vars |
| Existing workspace/provider connection | Workspace-connection catalog/grant plus `resolveWorkspaceConnectionCredential(s)ForApp` |
| App-local API/service key with no reusable connection | `registerRequiredSecret({ kind: "api-key" })` and the vault |
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

- **Settings kit**: one searchable Settings page with Account, Connections,
  Agent, and Organization groups plus a group for the app's own settings. The
  index is built from page declarations; give every row a search entry whose
  anchor is its `SettingsRow` id so users find settings by name.
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
- **Custom block kit**: optional extension creation, viewer chrome, slots, and
  promotion affordances. Apps must opt in; Core keeps the sandbox, SQL storage,
  access checks, and compatibility routes, while Toolkit owns reusable adoption
  UI. Analytics may expose this as one-off **Custom Blocks**; durable behavior
  should be promoted to app code.
- **Chat history kit**: presentational chat lists and recent-chat rails belong
  in Toolkit; Core keeps thread persistence, agent execution, transport, and
  page-to-sidebar handoff. Use Toolkit's `ChatHistoryRail` for the standard
  five-item sidebar preview and a footer row with New chat followed by an
  ellipsis disclosure up to fifteen. Apps inject routing, labels, and domain
  actions.
- **Data grid kit**: provider-agnostic spreadsheet mechanics belong in
  `@agent-native/toolkit/data-grid`. Apps provide rows, typed columns, editor
  slots, selection and width state, persistence callbacks, and product-level
  row/body slots. Keep database models, access checks, grouping, drag/drop,
  and domain actions in the app adapter.
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
