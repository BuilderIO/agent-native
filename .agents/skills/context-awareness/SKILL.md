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

The agent must always know what the user is currently viewing. The UI writes navigation state on every route change. The agent reads it before acting.

## Why

Without context awareness, the agent is blind. It asks "which email?" when the user is staring at one. It cannot act on the current selection, cannot provide relevant suggestions, and cannot modify what the user sees. Context awareness is what makes the agent feel like a collaborator rather than a disconnected chatbot.

## The Core Patterns

### 1. Navigation State (`navigation` key)

The UI writes a `navigation` key to application-state on every route change. This tells the agent the semantic screen state: view, open IDs, active tab, and focused object.

**UI side** — `useNavigationState`, an app-owned hook (not a framework import) that every template ships at `app/hooks/use-navigation-state.ts`. It is a thin wrapper around the framework primitive `useAgentRouteState`, handling both directions: writing `navigation` on route change and consuming the agent's `navigate` command.

```tsx
// app/hooks/use-navigation-state.ts
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export function useNavigationState() {
  useAgentRouteState({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => ({
      view: pathname === "/" ? "home" : pathname.slice(1),
      // Optional semantic alias. Raw query params are already exposed in
      // <current-url> and controllable with set-search-params.
      label: searchParams.get("label"),
    }),
    getCommandPath: (command: any) => command.path ?? "/",
  });
}
```

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
- Any durable selection — focused item, selected text range, active tab

Raw URL query params are already synced by the framework to `__url__` and shown to the built-in agent as `<current-url>`. Keep shareable filters in URL state, then use `view-screen` to summarize important query params as `activeFilters` when helpful.

### 2. Current URL (`__url__` key)

`AgentPanel` automatically writes `__url__` with `{ pathname, search, hash, searchParams }`. The built-in agent sees it as a `<current-url>` block in every turn.

Use this for URL-reachable filters and search state. The agent can update it with the built-in `set-search-params` and `set-url-path` tools; do not duplicate the whole query string into `navigation`.

### 3. The `view-screen` Script

Every template should have a `view-screen` script. It reads navigation state,
the current URL if filters matter, and selection state. It fetches the relevant
data from existing domain actions, shared data helpers, or Drizzle queries, and
returns a snapshot of what the user sees. Do not add REST wrappers just so
`view-screen` can read app data. This is the agent's eyes.

```ts
// actions/view-screen.ts
import { readAppState } from "@agent-native/core/application-state";

export default async function main() {
  const navigation = await readAppState("navigation");
  const url = (await readAppState("__url__")) as {
    searchParams?: Record<string, string>;
  } | null;
  const screen: Record<string, unknown> = { navigation };

  if (url?.searchParams) {
    screen.activeFilters = url.searchParams;
  }

  // Fetch data based on what the user is viewing
  if (navigation?.view === "inbox") {
    const emails = await fetchEmailList(navigation.label);
    screen.emailList = emails;
  }
  if (navigation?.threadId) {
    const thread = await fetchThread(navigation.threadId);
    screen.thread = thread;
  }

  console.log(JSON.stringify(screen, null, 2));
}
```

**Navigation state is auto-injected into every user message as a `<current-screen>` block**, so the agent always has basic context without calling any tool. The `view-screen` action is still useful when you need a richer snapshot (e.g., fetching the full email thread or form data for the current view).

### 4. The `navigate` Script

The agent writes a one-shot `navigate` command to application-state. The UI reads it, performs the navigation, and deletes the entry.

**Agent side:**

```ts
import { writeAppState } from "@agent-native/core/application-state";

// Navigate the user to a specific thread
await writeAppState("navigate", { view: "inbox", threadId: "abc123" });
```

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

## Jitter Prevention

When the agent writes to application-state via script helpers (`writeAppState`), the write is tagged with `requestSource: "agent"`. The UI uses the `ignoreSource` option on `useDbSync()` with a per-tab ID so it ignores its own writes while still picking up changes from agents, other tabs, and scripts.

Client code can use `useAgentRouteState`, `useSemanticNavigationState`, `setClientAppState`, `writeClientAppState`, `readClientAppState`, and `deleteClientAppState` from `@agent-native/core/client` instead of hand-written `fetch` calls. Pass `{ requestSource: TAB_ID }` on UI writes when pairing with `useDbSync({ ignoreSource: TAB_ID })`; pass `{ keepalive: true }` for short-lived writes such as selection cleanup during unload.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID,  // ignore events from this tab's own writes
});
```

The UI sends its tab ID via `X-Request-Source` header on PUT/DELETE requests. The server stores this as the event's `requestSource`. When processing sync events, the UI filters out events matching its own `ignoreSource` value. This prevents the UI from refetching data it just wrote.

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
- Update `view-screen` when adding new features — it should return data for every view
- Use `useAgentRouteState` or `useSemanticNavigationState` for UI-side navigation sync and command consumption
- Use the one-shot `navigate` command pattern for app navigation; include a same-origin `path` when the target URL is known
- Tag agent writes with `requestSource: "agent"` (the script helpers do this automatically)

## Don't

- Don't assume the user is on a specific page — always check navigation state
- Don't hardcode navigation paths in scripts — read the current state and branch
- Don't write to the `navigation` key from the agent — it belongs to the UI. Use `navigate` instead.
- Don't write both `navigate` and `__set_url__` for one app navigation; competing consumers can make the browser URL change before React Router commits the page.
- Don't ignore the `<current-screen>` block — it tells you where the user is
- Don't duplicate whole URL query strings into `navigation` when `<current-url>` already exposes them
- Don't store fetched data in navigation state — it holds IDs and semantic UI state only. The `view-screen` script fetches the actual data.

## Related Skills

- **adding-a-feature** — Context awareness is area 4 of the four-area checklist
- **real-time-sync** — How `useDbSync` delivers app-state changes to the UI
- **actions** — How to create the `view-screen` and `navigate` actions
- **storing-data** — Application-state is one of the core SQL stores
