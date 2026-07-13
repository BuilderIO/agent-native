---
name: agent-page
description: >-
  The full-page Agent surface (/agent) with Context, Files, Connections, Jobs,
  and Access tabs. Use when mounting the Agent page in a template, adding an
  app-specific tab, surfacing context transparency, MCP servers, A2A agents,
  recurring jobs, or external-client connect flows in the UI.
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

| Tab | Contents |
| --- | --- |
| `context` | System-vs-conversation split meter, provenance-grouped system sections (governance tiers: required/inherited/user), live-thread manifest. Backed by `context-preview-get` / `context-manifest-get` (see `context-xray` skill). |
| `files` | ResourcesPanel (skills, instructions, memory, uploads) with the virtual `mcp-servers/` folder hidden (`showMcpServers={false}`). |
| `connections` | MCP server management (both scopes, admin-gated org writes) plus A2A remote agents this app can call. |
| `jobs` | Recurring jobs (personal + org) and automations (personal) with pause/resume/delete (see `recurring-jobs` skill). |
| `access` | Copyable MCP URL and A2A agent-card URL, per-client connect steps (Claude, ChatGPT, Cursor, Claude Code, Codex, Other) from `packages/core/src/shared/mcp-connect-content.ts` (shared with the `/mcp/connect` route — edit the shared module, never fork copy), static-token fallback link. Grants/scopes/revocation UI is future work. |

## Mounting In A Template

1. Add an `/agent` route following the template's settings-route pattern
   (`app/routes/agent.tsx` or `_app.agent.tsx`), mounting `AgentTabsPage`.
   CSR is fine; keep the app shell in `root.tsx` so navigation does not
   remount it (`client-side-routing` skill).
2. Add an "Agent" item to primary navigation and the command palette,
   mirroring the Settings entries. Link-first (`native-navigation` skill).
3. Pass `agentPageHref="/agent"` to `AgentSidebar` so the sidebar workspace
   and settings modes link out to the full page.
4. Hash deep-links work out of the box: `/agent#context`, `/agent#files`,
   `/agent#connections`, `/agent#jobs`, `/agent#access`.
5. App-specific additions go in `extraTabs` (same `SettingsTabItem` shape as
   the settings page); hide built-ins only with `hiddenTabs` when a template
   genuinely lacks the underlying capability.

## Scope

The page-level Personal/Organization toggle passes `scope` (and
`canManageOrg`) to every tab via `AgentPageTabProps`. Hide nothing silently:
if a capability is personal-only today (e.g. automations), the org view says
so honestly instead of faking an org variant.
