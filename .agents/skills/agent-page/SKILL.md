---
name: agent-page
description: >-
  The agent's configuration surfaces: Settings › Agent pages (Instructions,
  Memory, Skills, Files, Sub-agents) and the full-page `AgentTabsPage`
  (resources, Snapshots, Agent integrations, Automations, MCP). Use when adding
  an agent resource group, surfacing context transparency, MCP servers, A2A
  agents, recurring jobs, or external-client connect flows in the UI.
scope: dev
metadata:
  internal: true
---

# Agent Page

`AgentTabsPage` (from `@agent-native/core/client`, source
`packages/core/src/client/agent-page/`) is the canonical full-page surface for
everything that can influence the agent. Design principles:

- The page answers "what can influence this agent, and why" — it is not a
  generic admin console.
- Capability and access stay separate: **Connections** is what this agent can
  reach; **Access** is who can reach this agent.
- It is a thin shell that re-hosts existing components (ResourcesPanel, MCP
  hooks, AgentsSection, context X-Ray, jobs actions) — do not re-implement
  those surfaces inside it.
- Context must be inspectable, attributable, and governable — provenance and
  governance tiers, not just a token meter.

## Tabs

`defaultTab` is `files`. Resource tabs re-host `ResourcesPanel` views; the rest
re-host existing components.

| Tab | Contents |
| --- | --- |
| `files`, `instructions`, `agents`, `memory`, `skills`, `learnings`, `remote-agents` | `ResourcesPanel` views (group "resources"). |
| `snapshots` | Scope preview, token budget, provenance-grouped system sections (governance tiers), and the latest live-thread snapshot. Backed by `context-preview-get` / `context-manifest-get` (see `context-xray`). Old `#context` links land here. |
| `connections` | "Agent integrations": MCP server management (both scopes, admin-gated org writes). |
| `jobs` | **Automations**: personal and organization Scheduled/Event tasks with pause/resume/delete. The `jobs` hash is stable for compatibility (see `automations` and `recurring-jobs`). |
| `settings` | The agent settings panel (model, keys, limits, voice). |
| `access` | "MCP": copyable MCP URL and A2A agent-card URL, per-client connect steps from `packages/core/src/shared/mcp-connect-content.ts` (shared with `/mcp/connect`; edit the shared module, never fork copy), static-token fallback link. |

## Settings Resource Pages

With the `settings-redesign` flag on, Settings › Agent › Instructions, Memory,
Skills, and Files (`packages/core/src/client/settings/shell/pages/`) render the
same `ResourcesPanel` with `settingsGroups`: Personal, {Org name}, and From
Dispatch groups (Memory swaps From Dispatch for Learnings). Add a group or an
add action there, not a second panel. Row read-only state comes from the scope:
organization rows for members and Dispatch rows for everyone; the server still
enforces it. Resource trees refetch on `action` change events, which is how an
agent's `save-memory` or `resources` write appears without a reload.

Settings › Agent › Sub-agents (`pages/sub-agents.tsx`) is the one place that
lists every agent the main agent can hand work to, each once:

- **{Org} apps**: first-party apps, from their seeded `remote-agents/<id>.json`
  manifests plus workspace apps only discovery knows, each "Reachable · {URL}"
  from the batched `/_agent-native/agents/probe`.
- **External agents**: every other `remote-agents/` manifest. The header's
  **Connect agent** (owners and admins) opens the directory dialog: Foundry,
  Gemini Enterprise, Anthropic Managed Agents, and any A2A agent by URL.
- **Custom agents**: `agents/*.md` profiles through `ResourcesPanel`
  `settingsGroups`. Anyone can add a personal one.

Build on `useRemoteAgents()` and the `AgentAddForm` / `AgentEditForm` exports
of `AgentsSection.tsx`, not a second fetch. `?connect=<a2a|anthropic-managed-agents|manual>`
and the peer register-back `f_agent*` params still open the connect form, and
legacy ids (`agent:agents`, `agent:directory`, `agent:resources:agents`,
`agent:resources:remote-agents`, section `a2a`) redirect to this page. Hidden
and removed first-party ids (`shared/first-party-agents.ts`) stay unlisted, the
same rule discovery applies.

## Mounting In A Template

First-party templates don't mount `AgentTabsPage`. Their `/agent` route
redirects into Settings with `buildLegacyAgentSettingsRoute(hash, search)`, so
`/agent#files`, `#jobs`, `#connections`, and `#access` land on the matching
Settings page, and they pass `agentPageHref="/settings/agent"` to
`AgentSidebar` (Settings › Agent › Model with the `settings-redesign` flag on).
New agent-configuration UI belongs on a Settings page, not a new tab here.

For an app that wants the whole surface on one page:

1. Mount `AgentTabsPage` from `@agent-native/core/client/agent-chat` on its
   own route. CSR is fine; keep the app shell in `root.tsx` so navigation
   does not remount it (`client-side-routing` skill).
2. Pass that route as `agentPageHref` to `AgentSidebar`.
3. App-specific additions go in `extraTabs` (same `SettingsTabItem` shape as
   the settings page) or `extraTabFactories`; hide built-ins only with
   `hiddenTabs` when the app genuinely lacks the underlying capability.

## Scope

The page currently passes personal `scope` (and `canManageOrg`) to tabs via
`AgentPageTabProps`; it does not expose a page-level Personal/Organization
toggle. A tab may render its own scoped sections where the underlying actions
support them. The Automations tab shows personal and organization sections for
both Scheduled and Event triggers. Organization event automations remain
creator-run: administrators can manage them, but cannot retarget the creator's
identity.
