---
name: context-awareness
description: >-
  How the agent knows what the user is looking at. Use when exposing UI state to
  the agent, implementing view-screen or navigate actions, wiring navigation
  state, or debugging agent context issues.
scope: dev
metadata:
  internal: true
---

# Context Awareness

## Rule

Apps can sync semantic navigation state when the route changes by using the
shared route-state hook. When screen context is available, Core includes a
`<current-screen>` snapshot in each agent turn, so the agent can get basic
route context without first calling another tool. Apps can add concise
visible-record details to that snapshot and expose selection in tab-scoped
state.

## Why

Without context awareness, the agent is blind. It asks "which email?" when the user is staring at one. It cannot act on the current selection, cannot provide relevant suggestions, and cannot modify what the user sees. Context awareness is what makes the agent feel like a collaborator rather than a disconnected chatbot.

## Manifest and live context

Register `app.manifest.ts` through app config. Declare the actual landing
screen, app-relative screen routes and typed params, entity-to-screen mapping,
`viewPolicy`, and only the capabilities the app can execute. Keep its routing
intents and guide consistent with real actions and current screen state.

Use `navigationMode` `open` for an explicit request to show a destination,
`reveal` for a result the chat host may surface without disrupting current
work, and `keep` for background work or a request to stay put. Prefer a
manifest screen ID with validated params. Keep the read-only and write
guards, report whether the command was kept, queued, or confirmed, and
verify the destination with a fresh screen read.

Use `useDbSync({ realtime: { reason } })` when another client or background
actor can update the visible surface and it should refresh immediately. Keep
same-thread action invalidation and preserve the focused editor, dirty draft,
and selection during refresh. Use `defineViewScreen` for the route, view,
title, active filters, selection and visible items, plus `liveDraft` and
`userEditedSince` when available. Expose only bounded, authorized context.
Verify UI-to-chat context after a manual edit and chat-to-UI updates without
reload. Use this live context to ground an `ActionSuggestion` in a declared
capability and the user's current permission before offering it.

## The Core Patterns

### 1. Navigation State (`navigation` key)

Use the shared route-state hook to write a tab-scoped `navigation` key as the
route changes. Include semantic screen state such as the view, open IDs, active
tab, and focused object.

**UI side** — use `useAgentRouteState` in the app's route-state hook. The app
can wrap it in an app-owned `useNavigationState` hook to map route paths to
semantic views and consume the agent's `navigate` command.

```tsx
// app/hooks/use-navigation-state.ts
import { useAgentRouteState } from "@agent-native/core/client/navigation";
import { TAB_ID } from "@/lib/tab-id";

export function useNavigationState() {
  useAgentRouteState({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => ({
      view:
        pathname === "/"
          ? "home"
          : pathname === "/sign-in"
            ? "sign-in"
            : pathname.replace(/^\/+/, ""),
      // Optional semantic alias. Query keys the app declares in
      // `urlQueryKeys` are already in <current-url>; set-search-params edits them.
      label: searchParams.get("label"),
    }),
    getCommandPath: (command: any) =>
      command.path ?? `/${command.view === "home" ? "home" : command.view}`,
  });
}
```

The default scaffold uses `/home` for home and `/sign-in` for authentication;
`/` redirects according to the configured home route. Map navigation to the
app's actual routes and pass an explicit `path` for destinations that do not
follow the `/<view>` convention.

`TAB_ID` comes from the framework's `getBrowserTabId()` (see the scaffolded `app/lib/tab-id.ts`; never redefine it). The server resolves tab-scoped `application_state` writes and page-local WebMCP calls (`X-Agent-Native-Browser-Tab`) against this same id, so a hand-rolled random id silently breaks selection sync for hidden and background tabs.

**Agent side** — read before acting:

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// e.g. { view: "thread", threadId: "abc123", subject: "Re: Q3 Planning" }
```

**What to include in navigation state:**

- `view` — the current page/section (e.g., "inbox", "form-builder", "dashboard")
- Item IDs — the selected/open item (e.g., `threadId`, `formId`, `issueKey`)
- Semantic aliases — label names, active tabs, focused row, or stable filter names the agent should reason about
- Focused object IDs and active tabs that are not already represented by URL state

Keep text-selection ranges and excerpts in the tab-scoped `selection` key, not
in `navigation`.

The framework syncs the URL to `__url__` and shows it to the built-in agent as `<current-url>`, but a query value reaches the agent only when the app declares its key: pass `urlQueryKeys` to `AgentSidebar` (exact names and `prefix*` patterns, for example `["range", "f_*"]`) for every key `view-screen` reads. The agent still sees the name of any other key, with its value redacted. Keep shareable filters in URL state, then use `view-screen` to summarize important query params as `activeFilters` when helpful.

Keep `application_state` values small. Do not store pasted files, base64 images,
recording chunks, screenshots, or other large blobs in navigation or app-state
keys; upload them and store only a URL or storage handle.

### Selection state

For app-owned per-tab selection, suffix the key with `TAB_ID`; `requestSource`
labels the write origin but does not scope the key. Keep the value to stable ids
and a short label or excerpt, never the full document:

```ts
import { writeClientAppState } from "@agent-native/core/client/hooks";
import { TAB_ID } from "@/lib/tab-id";

await writeClientAppState(
  `selection:${TAB_ID}`,
  { kind: "text", id: "artifact-123", text: "short excerpt" },
  { requestSource: TAB_ID },
);
```

A server action can read that tab's value with
`readAppStateForCurrentTab("selection")`. A `view-screen` result may include the
selection and a specific next action when that helps the agent target an edit.

### Picked objects (composer Select)

When the user picks on-screen objects with the composer's Select button, each
one becomes an ordinary agent chat context chip keyed
`agent-select:<kind>:<id>`. Every turn's context then opens with a
`## Selected objects` block listing them. Treat that list as the target set:
apply the request to those objects and leave the rest unchanged unless the
message says otherwise. The tab-scoped `agent-selection` key mirrors the
list as `{ items: [{ kind, id, title }], updatedAt }` for actions that need
it; read it with `readAppStateForCurrentTab(AGENT_SELECTION_STATE_KEY)` (the
constant is in `@agent-native/core/shared`).

**UI side** — offer objects to Select with the toolkit registry; never build a
per-app pick mode or a second selection store:

```tsx
import {
  useAgentSelectable,
  useAgentSelectableSource,
} from "@agent-native/toolkit/app/agent-select";

// One object per component: returns whether it is picked.
const picked = useAgentSelectable({
  kind: "panel",
  id: panel.id,
  title: panel.title,
  getContext: () => `Panel id: ${panel.id}`,
  getElement: () => cardRef.current,
});

// Dynamic content (slide nodes, design layers): resolve the element under
// the pointer, including inside same-origin iframes.
useAgentSelectableSource((target) => resolveObject(target));
```

The Select button appears in the composer only while something is registered.
`selectAgentSelectable(target, { exclusive: true })` stages an object from a
plain click outside pick mode. A pick is released when its object unregisters
and does not remount, so leaving a screen or deleting an object needs no
cleanup. Give a source-resolved object a `parent` and a `getElement` that
finds its node again by a stable id: it is released with its parent, or when
the parent is on screen and the node is gone. Keep
`getContext` to ids, a short label, and the action to use; mark chrome pick
mode must skip with `data-agent-select-ignore`.

### 2. Current URL (`__url__` key)

`AgentPanel` automatically writes `__url__` with `{ pathname, search, hash, searchParams }`. The built-in agent sees it as a `<current-url>` block in every turn. Query values are redacted unless the app declares their keys with `urlQueryKeys`, and the hash is scrubbed.

Use this for URL-reachable filters and search state. The agent can update it with the built-in `set-search-params` and `set-url-path` tools; do not duplicate the whole query string into `navigation`.

### Settings page (`settings-view` key)

The redesigned Settings shell writes tab-scoped `settings-view` = `{ page, sub, label }` (for example `{ page: "integrations", sub: "builder", label: "Connections › Integrations › Builder.io" }`) and deletes it when Settings closes. `<current-url>` shows it as a `settingsPage:` line, because a legacy or mounted pathname doesn't name the page the shell resolved. To send the user to a page, call the built-in `open-settings-page` tool with a page id (plus `sub` or `anchor`); it resolves old tab and section ids through the same redirect table as links. A template's own `navigate` action only needs a Settings branch for its app areas (`/settings/app/<area>`), built with `buildSettingsRoute`.

### 3. The `view-screen` Action

Use a `view-screen` action for a concise snapshot of visible record data the
agent needs in addition to basic navigation. Read navigation and selection
state, then query the relevant summaries through existing data helpers or
Drizzle. Do not add REST wrappers just so `view-screen` can read app data.

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Return a concise snapshot of the current screen.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");
    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const selection = await readAppStateForCurrentTab("selection");
    if (selection) screen.selection = selection;

    // Add concise visible-record summaries using the app's existing data helpers.
    return screen;
  },
});
```

Core builds the `<current-screen>` block for each agent turn by running the
surfaced `view-screen` action. If no such action is available, it falls back to
the current tab's `navigation` state. The scaffold action returns navigation;
extend it with concise, relevant visible-record details when the app has them.
The agent can use the injected snapshot directly and call `view-screen` again
when it needs a fresh read after context has changed.

### 4. The `navigate` Action

Use `createNavigateAction` to validate and queue one app-local command. The UI
consumes the command, applies navigation, and deletes the entry.

**Agent side:**

```ts
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";

// Navigate the user to a specific thread
await writeAppStateForCurrentTab("navigate", {
  view: "inbox",
  path: "/inbox/abc123",
  threadId: "abc123",
});
```

**Agents keep the user's view.** Every agent caller counts — built-in chat,
MCP, WebMCP, A2A (`isAgentCaller(ctx)`), not just `caller === "tool"`:

- Reads never navigate: any read-only action writing `navigate` during an agent
  call is refused at the app-state store.
- Writes stay put by default: an agent write that tries to write `navigate`
  without `intent: "open"` is refused. Use
  `navigateAfterWrite(navigation, { ctx, intent })` when a write should open
  its result for a person while skipping the move for an agent unless
  `intent: "open"` is set (or set `allowsAgentNavigation: true` on an action
  whose job is opening a UI).
- Opening one item needs `intent: "open"`, set only when the user asked to see
  it. `createNavigateAction()`, `defineAction()`, and the app-state store
  enforce this by default for item ID fields (`id`, `*Id`) and detail paths
  without per-app code; pass `isDetailView` to `createNavigateAction()` only
  when an app needs custom matching. When a dispatched `navigate` action
  (`actionName: "navigate"`) or `createNavigateAction()` is called by an agent
  without `intent: "open"` and would move the user's view (for a detail item or
  during/after agent writes), it keeps the current view and returns a
  successful typed result (`{ kept: true, navigated: false, reason, currentView, message }`)
  instead of throwing an error.

**UI side** — use `useAgentRouteState`, shown above. It polls command keys,
dedupes `_writeId`, deletes consumed commands, and applies app-local routing.

When a destination has a real URL, let the `navigate` command carry that local
`path` (plus semantic fields when useful) and have the UI prefer `path` before
falling back to semantic routing. Keep app navigation single-channel: do not
also write `__set_url__` for the same navigation. `__set_url__` belongs to the
framework URL tools (`set-url-path`, `set-search-params`) and URL-only filter
changes. If a command can arrive while a chat stream is rendering, prefer
`navigate(path, { replace: true, flushSync: true })` over a view-transition
wrapper so the URL and visible route commit together.

Keep `path` router-local. A segment matching the app mount prefix remains part
of the local route unless a matching `view` route or explicit `publicPath`
identifies the mounted URL. Carry the mounted form separately in `publicPath`;
never infer that `path` is mounted from its prefix alone.

**Calls from no tab.** An MCP tool call by a signed-in user carries no tab ID,
so the tab-scoped helpers (`readAppState("navigation")`,
`readAppStateForCurrentTab`, `writeAppStateForCurrentTab`) act on the tab of
this app the user used last within 12 hours. `useAgentRouteState` records a
tab's use when it gains focus or changes route; an app with its own navigation
sync calls `useBrowserTabUse(route)` from
`@agent-native/core/client/navigation`. The call doesn't become that tab:
`getCurrentRequestBrowserTabId()` stays null, and checks that must come from
the open editor keep requiring it. When no tab was used recently, `navigation`
reads return null rather than the account-wide row, writes keep going to the
account-wide row, and the MCP result says no tab was found. To pick a tab the
same way in your own code, use `resolveCurrentRequestStateTab()`.

## Jitter Prevention

Agent-side application-state writes are tagged with
`requestSource: "agent"`. The UI uses `useDbSync({ ignoreSource: TAB_ID })` so
it ignores its own writes while still picking up changes from agents, other
tabs, and scripts.

Import `useAgentRouteState` and `useSemanticNavigationState` from
`@agent-native/core/client/navigation`. Import
`setClientAppState`, `writeClientAppState`, `readClientAppState`, and
`deleteClientAppState` from `@agent-native/core/client/hooks`; avoid the
deprecated `@agent-native/core/client` barrel. Pass `{ requestSource: TAB_ID }`
on UI writes when pairing with `useDbSync({ ignoreSource: TAB_ID })`; pass
`{ keepalive: true }` for short-lived writes such as selection cleanup during
unload.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID,  // ignore events from this tab's own writes
});
```

The UI sends its browser tab ID in `X-Agent-Native-Browser-Tab`; when a write
has a `requestSource`, the client sends it in `X-Request-Source` and the server
records it as the event origin. `useDbSync` ignores events whose origin matches
`ignoreSource`, preventing a tab from refetching after its own state writes.

## Gold-Standard Example: Mail Template

The mail template demonstrates these patterns working together:

**Navigation state shape:**
```json
{ "view": "inbox", "threadId": "thread-123", "focusedEmailId": "msg-456", "label": "important" }
```

**view-screen output:**
- Reads navigation state
- Reads `__url__` if URL query filters matter
- Fetches email list matching current view/filter state
- Fetches thread messages if a thread is open
- Returns everything as a single JSON snapshot

**navigate command:**
- `{ "view": "starred" }` — switch to starred view
- `{ "view": "inbox", "threadId": "thread-123" }` — open a specific thread
- For pure query-filter changes, use `set-search-params`

## Do

- Use the auto-injected `<current-screen>` block for basic context — call `view-screen` only when you need richer data
- Include semantic route state in the `navigation` key (view, item IDs, active tab, focused row)
- Keep shareable filters in URL query params so `<current-url>` and `set-search-params` work
- Add concise visible-record details to `view-screen` for views where the agent needs them beyond the injected navigation context
- Use `useAgentRouteState` or `useSemanticNavigationState` for UI-side navigation sync and command consumption
- Use the one-shot `navigate` command pattern for app navigation; include a same-origin `path` when the target URL is known
- Tag agent writes with `requestSource: "agent"` (the script helpers do this automatically)

## Don't

- Don't assume the user is on a specific page — use `<current-screen>` or read
  navigation state when context is missing or stale
- Don't hardcode navigation paths in scripts — read the current state and branch
- Don't write to the `navigation` key from the agent — it belongs to the UI. Use `navigate` instead.
- Don't move the user's view from a read or a write; open an item only when the user asked to see it.
- Don't write both `navigate` and `__set_url__` for one app navigation; competing consumers can make the browser URL change before React Router commits the page.
- Don't ignore the `<current-screen>` block — it tells you where the user is
- Don't duplicate whole URL query strings into `navigation` when `<current-url>` already exposes them
- Don't store fetched data in navigation state — it holds IDs and semantic UI state only. The `view-screen` script fetches the actual data.

## Related Skills

- **adding-a-feature** — Context awareness is area 4 of the four-area checklist
- **real-time-sync** — How `useDbSync` delivers app-state changes to the UI
- **actions** — How to create the `view-screen` and `navigate` actions
- **storing-data** — Application-state is one of the core SQL stores
