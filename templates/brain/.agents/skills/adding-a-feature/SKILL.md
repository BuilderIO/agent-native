---
name: adding-a-feature
description: >-
  The four-area checklist every new feature must complete. Use when adding any
  feature, integration, or capability to ensure the agent and UI stay in parity.
scope: dev
metadata:
  internal: true
---

# Adding a Feature — The Four-Area Checklist

## Rule

Every new feature MUST update all four areas. Skipping any one breaks the agent-native contract — the agent and UI must always be equal partners.

## Why

Agent-native apps are defined by parity: everything the UI can do, the agent can do, and vice versa. A feature that only has UI is invisible to the agent. A feature that only has scripts is invisible to the user. A feature without app-state sync means the agent is blind to what the user is doing.

## The Checklist

When you add a new feature, work through these four areas in order:

### 1. UI Component

Build the user-facing interface — a page, component, dialog, or route. Use `useActionQuery` and `useActionMutation` from `@agent-native/core/client` to call actions for data fetching and mutations. Do not create a custom REST endpoint just so React can call action-backed data; the action endpoint already exists.

**Auto-refresh on agent writes is non-negotiable** — when the agent mutates data, the UI must reflect the change without a manual refresh. There are two paths, and you must pick the right one:

- **`useActionQuery` / `useActionMutation`** — covered automatically. The framework's `useDbSync` invalidates `["action"]` on every change event, so every `useActionQuery` hook refetches on agent activity. No extra wiring required. **Prefer this path.**
- **Raw `useQuery` with custom keys** — needs explicit wiring. Fold `useChangeVersions([<source>, "action"])` from `@agent-native/core/client` into the `queryKey` and set `placeholderData: (prev) => prev`. The `action` source is the reliable signal (the agent runner emits it after every successful tool call); the resource-specific source (`"dashboards"`, `"analyses"`, `"settings"`, etc.) is bonus when emitted. Without this wiring, agent writes will be invisible until manual refresh — that breaks the framework's #1 promise.

  ```tsx
  import { useChangeVersions } from "@agent-native/core/client";
  import { useQuery } from "@tanstack/react-query";

  const v = useChangeVersions(["dashboards", "action"]);
  useQuery({
    queryKey: ["dashboard", id, v],
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // no flicker on refetch
  });
  ```

  See the `real-time-sync` skill for the full pattern and source catalog.

### 2. Action

Create an action in `actions/` using `defineAction`. This serves double duty: the agent calls it as a tool, and the UI calls it through `useActionQuery` / `useActionMutation` while the framework owns the HTTP transport. Set `http: { method: "GET" }` for read actions, leave default for writes, or set `http: false` for agent-only actions like `navigate` and `view-screen`.

Before adding a new route or endpoint, inspect the existing actions. Reuse an
action if it already covers the business operation, extend it if the shared
contract is incomplete, or create a new `defineAction` if the agent and UI both
need the capability. Do not add pass-through `/api/*` routes that re-export
actions. If client code needs a new framework/app route, expose a named helper
or hook first and use that helper from components and docs.

For provider-backed analysis/query/reporting integrations, do not turn every
provider endpoint or filter into a rigid action. Prefer the shared
`provider-api-catalog` / `provider-api-docs` / `provider-api-request` pattern
from `@agent-native/core/provider-api`, then add narrow convenience actions only
for workflows that truly deserve a first-class shortcut. Treat this as a
capability requirement, not a nice-to-have: convenience actions must not become
the ceiling of what the agent can ask the provider to do. Pair broad provider
access with staging or sandboxed code execution when responses may be too large
for chat context. If provider credentials live on resource/share rows, add the
scoped resolver first so broad access preserves the same ownership boundary as
the app UI.

If the feature needs credentials, design the credential path in the same change.
Never hardcode API keys, tokens, webhook URLs, signing secrets, private
Builder/internal data, or customer data in the action, UI, seed data, fixtures,
docs, prompts, or generated extension/app content. Register required secrets,
use OAuth helpers, or read scoped values from the vault/credential store.

If the feature involves attachments, images, recordings, screenshots, exports,
or other file-like payloads, design the upload path in the same change:
provider upload first, then URL/id/blob handle in SQL. Do not add base64/binary
columns or stuff files into `application_state`.

**If the action produces or lists a navigable resource**, add a `link` builder that returns `{ url: buildDeepLink({ app, view, params }), label }`. External coding agents and MCP hosts (Claude / ChatGPT / Claude Code / Cowork / Codex, over MCP/A2A) then surface an "Open in … →" deep link that drops the user back into the running UI focused on the record — for free. If a compatible MCP host should render an inline review/edit surface, also add `mcpApp` with `embedApp()` so the action embeds the real React app route instead of a one-off HTML UI. The `link` builder and `mcpApp` metadata must be pure and synchronous (no I/O). Any external-agent read/ingest action must be `http: { method: "GET" }` + `readOnly: true` + `publicAgent: { expose: true, readOnly: true, requiresAuth: true }`. See the `external-agents` skill.

### 3. Skills / Instructions

Update `AGENTS.md` and/or create a skill in `.agents/skills/` if the feature introduces patterns the agent needs to know. At minimum, add the new actions to the action table in the template's `AGENTS.md`.

Reusable actions are part of the app contract, not just implementation detail. When an action is useful outside one screen, update agent instructions in the same change so app agents know when to call it, which arguments matter, and what output to preserve. If the capability is workflow-heavy, cross-app, provider-backed, or has a non-obvious sequence of actions, add or update a skill instead of burying the behavior in one long `AGENTS.md` paragraph.

Instruction examples may name secret keys like `SLACK_WEBHOOK`, but must use
placeholders such as `${keys.SLACK_WEBHOOK}` or `<SLACK_WEBHOOK>`. Do not paste
real keys, internal data, or customer data into instructions as examples.

If the feature adds or changes visible UI copy, prompts, toasts, labels, empty
states, or formatting, read `internationalization` and update the app's i18n
catalogs in the same change.

For app-backed skills, declare skill visibility in the app-skill manifest:

- `internal` — only the app's own agents should use it.
- `exported` — marketplace installs receive it, but the app does not need it loaded internally.
- `both` — shared between the app's internal agents and exported marketplace bundles.

### 4. Application State Sync

Expose navigation and selection state so the agent knows what the user is looking at. Write to the `navigation` app-state key on route changes. Update the `view-screen` action to fetch relevant data for the new feature. Add a `navigate` command if the agent needs to open the new view.

## Examples

### Adding "compose email" to a mail app

| Area            | What to build                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| UI              | Compose panel with tabs, to/cc/bcc fields, body editor. Use `useActionQuery`/`useActionMutation` for data. |
| Action          | `manage-draft` action (create/update/delete drafts), `send-email` action                 |
| Skills/AGENTS   | Document compose state shape, draft lifecycle, action args in AGENTS.md                  |
| App-state sync  | `compose-{id}` keys for each draft tab, `navigation` includes compose state              |

### Adding "create form" to a forms app

| Area            | What to build                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| UI              | Form builder page with drag-and-drop fields, preview, settings. Use `useActionQuery` for lists. |
| Action          | `create-form` action, `update-form` action, `list-forms` action (GET)                    |
| Skills/AGENTS   | Document form schema shape, field types, validation rules in AGENTS.md                   |
| App-state sync  | `navigation` includes `{ view: "form-builder", formId: "..." }`, `view-screen` fetches form data |

### Adding "chart type" to an analytics app

| Area            | What to build                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| UI              | New chart component, chart type selector in dashboard                                    |
| Action          | `create-chart` or `update-dashboard` action that sets chart type and config              |
| Skills/AGENTS   | Document supported chart types, config options, data requirements                        |
| App-state sync  | `navigation` includes selected chart/dashboard, `view-screen` returns chart config       |

## Adding a new route

Templates are single-page apps with client-side routing. The app shell (AgentSidebar + top-level nav) MUST persist across navigation — it is mounted once, either in `root.tsx` around `<Outlet />` or via a pathless `_app.tsx` layout route that all authed routes nest under.

**Never wrap each new route in its own `<AppLayout>` / `<Layout>`.** That causes React to unmount the entire app shell on every navigation, reloading the agent sidebar and destroying in-progress work.

- If the template has `<AppLayout>` in `root.tsx` — just render page content in your new route file, nothing else.
- If the template has `app/routes/_app.tsx` (pathless layout) — name your new route `_app.<segment>.tsx` to inherit the shell, or bare `<segment>.tsx` for public routes that should NOT have the shell.
- If a page needs per-route data (e.g. highlighting the active item in the sidebar), read it in the layout from `useParams()` / `useLocation()`. Don't pass it as a prop through every route file.

See the "Client-Side Routing" section in the root `CLAUDE.md` for full details.

## Anti-Patterns

- **Per-route `<AppLayout>` wrappers** — Every route file wraps its content in `<AppLayout>` or `<Layout>`. React sees a different component at the outlet on each nav and unmounts the whole shell, causing the agent sidebar to reload on every click. Mount the shell once above `<Outlet />` (root.tsx or `_app.tsx` pathless layout).
- **UI without actions** — The user can create forms but the agent cannot. The agent says "I don't have access to that" when it should be able to do it.
- **Actions without AGENTS.md** — The actions exist but the agent doesn't know about them because they're not documented. The agent reinvents solutions instead of using the actions.
- **Duplicate API routes** — Creating `/api/` routes for operations that actions already handle, including pass-through routes that just call or repackage an action. Use `useActionQuery`/`useActionMutation` instead.
- **Raw client route calls** — Teaching or adding `fetch("/_agent-native/...")`,
  `fetch(agentNativePath(...))`, or template `/api/*` calls in components for
  normal app work. Add a named client helper/hook and call that instead.
- **Features without app-state** — The agent cannot see that the user is looking at a specific form, email, or chart. It asks "which one?" instead of acting on the current selection.
- **Actions without UI** — The agent can do something the user cannot. This is less common but still breaks parity.

## Verification

After completing all four areas, verify:

1. Can the user perform the operation from the UI?
2. Can the agent perform the same operation via actions?
3. Does `pnpm action view-screen` show the relevant state when the user is using the feature?
4. Can the agent navigate to the feature view via the `navigate` action?
5. Is the feature documented in AGENTS.md with action names and args?
6. Are credentials and sensitive data supplied only through approved runtime
   channels, with no hardcoded real keys, tokens, webhook URLs, Builder/internal
   data, or customer data?

## One more area — sharing

If the feature stores **user-authored resources** (documents, dashboards, forms, decks, etc.), make them ownable so they get private-by-default semantics and a share dialog for free. See the `sharing` skill.

TL;DR: spread `ownableColumns()` into the resource table, pair it with `createSharesTable(...)`, call `registerShareableResource(...)`, wrap list/read queries with `accessFilter`, guard writes with `assertAccess`, and drop `<ShareButton>` in the resource header. The `share-resource`, `unshare-resource`, `list-resource-shares`, and `set-resource-visibility` actions are auto-mounted framework-wide.

## Related Skills

- **sharing** — How to make a new resource ownable (private by default, share with users/orgs/public)
- **context-awareness** — How to expose UI state to the agent (area 4 in detail)
- **actions** — How to create actions with `defineAction` and the `http` option (area 2 in detail)
- **external-agents** — Add a `link` builder so external agents (MCP/A2A) get an "Open in … →" deep link
- **create-skill** — How to create skills for new patterns (area 3 in detail)
- **storing-data** — Where to store the feature's data
- **real-time-sync** — How the UI stays in sync when the agent writes data
- **internationalization** — How to update localized UI copy and catalogs
