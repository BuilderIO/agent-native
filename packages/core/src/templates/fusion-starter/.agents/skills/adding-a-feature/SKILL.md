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

Scope check first: this is the checklist for a feature that adds app data or a new capability. A restyle, a copy change, or a screen with no new data model and no new agent-visible operation only needs the areas it actually touches — do not manufacture actions, state keys, or a skill for it.

## Why

Agent-Native apps are defined by parity: everything the UI can do, the agent can do, and vice versa. A feature that only has UI is invisible to the agent. A feature that only has scripts is invisible to the user. A feature without app-state sync means the agent is blind to what the user is doing.

## The Checklist

When you add a new feature, work through these four areas in order:

### 1. UI Component

Build the user-facing interface — a page, component, dialog, or route. Use `useActionQuery` and `useActionMutation` from `@agent-native/core/client/hooks` to call actions for data fetching and mutations. Do not create a custom REST endpoint just so React can call action-backed data; the action endpoint already exists.

**Agent edits must refresh the UI without a background poll.** Local chat-run
tool completions invalidate action queries and source counters after each
side-effecting tool and again at run end. There are two query paths:

- **`useActionQuery` / `useActionMutation`** — local action mutations invalidate `['action']` observers, and chat-run tool completions invalidate them for agent writes. No background sync opt-in is needed for the current user's agent run. **Prefer this path.**
- **Raw `useQuery` with custom keys** — fold `useChangeVersions([<source>, "action"])` from `@agent-native/core/client/hooks` into the `queryKey` and set `placeholderData: (prev) => prev`. Local chat-run side effects bump those counters too. Remote changes require the page's explicit `useDbSync({ realtime: { reason } })` opt-in only when data changes without the current user acting and must appear before refresh.

Never opt in public, anonymous, marketing, docs, or SSR routes, settings,
forms, or read-mostly lists. Refetch those on focus or navigation. Shared Slides
editing and the Mail inbox are the current first-party examples that need
remote updates. Each opted-in open tab adds a shared background transport and
one poll per idle interval; hidden tabs pause, and idle polling backs off to 1,
2, then 5 minutes. See `real-time-sync` for the decision rule and examples.

  ```tsx
  import { useChangeVersions } from "@agent-native/core/client/hooks";
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
Never hardcode credentials or include personal or customer data in source,
fixtures, docs, prompts, or generated app content. Register required secrets,
use OAuth helpers, or read scoped values from the credential store.

Before writing custom setup or credential UI, perform the shared-primitive
preflight from `agent-native-toolkit`: inspect the workspace/provider connection
catalog first, then settings, secrets/vault, OAuth, onboarding, and provider API
support. Reuse an existing connection's app grant and scoped credential
resolver; only use app-local vault or OAuth primitives when no reusable
connection exists. Keep any wizard thin and provider-specific - it may explain
prerequisites, ordering, or readiness, but must not become a second vault or
custom credential transport. Do not mark each field `required` by reflex;
model onboarding around the logical connection outcome.

If the feature involves attachments, images, recordings, screenshots, exports,
or other file-like payloads, design the upload path in the same change:
provider upload first, then URL/id/blob handle in SQL. Do not add base64/binary
columns or stuff files into `application_state`.

If the feature adds a heavy server-side dependency, read the startup guidance in
`performance` before adding it. Keep expensive setup and processing out of
request-startup paths; use a background job when the work does not need to block
the current request.

**If the action produces or lists a navigable resource**, add a `link` builder that returns `{ url: buildDeepLink({ app, view, params }), label }`. MCP hosts can surface a deep link that returns the user to the running app at that record. If a compatible host should render an inline review or edit surface, also add `mcpApp` with `embedApp()` so the action embeds the real app route. Keep `link` and `mcpApp` metadata pure and synchronous. Use the external-agent documentation when exposing actions to other agent hosts.

Scaffolding a new app of a known type (slides, design, content, forms)? Start from that template's `AGENTS.md` and `.agents/skills/`, not a blank app.

### 3. Skills / Instructions

Update `AGENTS.md` and/or create a skill in `.agents/skills/` if the feature introduces patterns the agent needs to know. At minimum, add the new actions to the action table in the template's `AGENTS.md`.

Before completing this area, identify the feature's primary actions:

- Document primary workflows in the `AGENTS.md` action table.
- If the app configures `initialToolNames` (`INITIAL_TOOL_NAMES` in some
  templates), add the primary actions there. If it uses per-action loading,
  mark the complete starter set `deferLoading: false`; once one action opts in,
  unmarked actions are deferred. The remaining actions stay discoverable through
  `tool-search`.
- If `mcp.keyToolNames` is configured, align it with primary actions actually
  served on MCP/WebMCP. It controls the external key-tools list and does not
  change the in-app agent's first-turn list.

Reusable actions are part of the app contract, not just implementation detail. When an action is useful outside one screen, update agent instructions in the same change so app agents know when to call it, which arguments matter, and what output to preserve. If the capability is workflow-heavy, cross-app, provider-backed, or has a non-obvious sequence of actions, add or update a skill instead of burying the behavior in one long `AGENTS.md` paragraph.

Instruction examples may name secret keys like `SLACK_WEBHOOK`, but must use
placeholders such as `${keys.SLACK_WEBHOOK}` or `<SLACK_WEBHOOK>`. Do not paste
real keys, internal data, or customer data into instructions as examples.

If the feature adds or changes visible UI copy, prompts, toasts, labels, empty
states, or formatting, edit the English strings inline in components. Do **not**
add i18n catalogs unless the user explicitly asks for localization; only then
read the `internationalization` skill.

For app-backed skills, declare skill visibility in the app-skill manifest:

- `internal` — only the app's own agents should use it.
- `exported` — marketplace installs receive it, but the app does not need it loaded internally.
- `both` — shared between the app's internal agents and exported marketplace bundles.

### 4. Application State Sync

Expose navigation and selection state so the agent knows what the user is looking at. Write to the `navigation` app-state key on route changes. Update the `view-screen` action to fetch relevant data for the new feature. Add a `navigate` command if the agent needs to open the new view. Text resources participate in `export-resource-pack`; binaries and secrets do not.

## Examples

### Adding "compose email" to a mail app

| Area | What to build |
| --- | --- |
| UI | Compose panel with tabs, to/cc/bcc fields, body editor. Use `useActionQuery`/`useActionMutation` for data. |
| Action | `manage-draft` action (create/update/delete drafts), `send-email` action |
| Skills/AGENTS | Document compose state shape, draft lifecycle, action args in AGENTS.md |
| App-state sync | `compose-{id}` keys for each draft tab, `navigation` includes compose state |

### Adding "create form" to a forms app

| Area | What to build |
| --- | --- |
| UI | Form builder page with drag-and-drop fields, preview, settings. Use `useActionQuery` for lists. |
| Action | `create-form` action, `update-form` action, `list-forms` action (GET) |
| Skills/AGENTS | Document form schema shape, field types, validation rules in AGENTS.md |
| App-state sync | `navigation` includes `{ view: "form-builder", formId: "..." }`, `view-screen` fetches form data |

### Adding "chart type" to an analytics app

| Area | What to build |
| --- | --- |
| UI | New chart component, chart type selector in dashboard |
| Action | `create-chart` or `update-dashboard` action that sets chart type and config |
| Skills/AGENTS | Document supported chart types, config options, data requirements |
| App-state sync | `navigation` includes selected chart/dashboard, `view-screen` returns chart config |

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
6. Are credentials supplied through approved runtime channels, with no
   hardcoded keys, tokens, or user data?

## One more area — sharing

If the feature stores **user-authored resources** (documents, dashboards, forms, decks, etc.), make them ownable so they get private-by-default semantics and a share dialog for free. See the `sharing` skill.

TL;DR: spread `ownableColumns()` into the resource table, pair it with `createSharesTable(...)`, call `registerShareableResource(...)`, wrap list/read queries with `accessFilter`, guard writes with `assertAccess`, and drop `<ShareButton>` in the resource header. The `share-resource`, `unshare-resource`, `list-resource-shares`, and `set-resource-visibility` actions are auto-mounted framework-wide.

## One more area — who inside the app may do it

If only some teammates may perform a feature (such as an admin-only import), use a per-app role rather than creating an organization or using a share grant. Use `agent-native-docs` to find the current role guide if needed.

TL;DR: declare the vocabulary once with `defineAppRoles({ appId, roles, defaultRole })`, guard the action with `authorize: appAccess.requireAny("...")`, and render the picker with `<TeamPage appRoles={descriptor} />`. `defaultRole` is display only — it never satisfies a guard — and `authorize` gates the operation while `accessFilter` / `assertAccess` still scope the rows.

## Related Skills

- **sharing** — How to make a new resource ownable (private by default, share with users/orgs/public)
- **context-awareness** — How to expose UI state to the agent (area 4 in detail)
- **actions** — How to create actions with `defineAction` and the `http` option (area 2 in detail)
- **build-an-app** — Start a complete app from a vague domain prompt
- **storing-data** — Where to store the feature's data
- **real-time-sync** — How the UI stays in sync when the agent writes data
- **performance** — Query/load cost and expensive startup work
- **agent-native-docs** — Find current docs for roles, external agents, or localization
