---
name: context-awareness
description: >-
  How the agent knows what the user is looking at. Use when exposing UI state to
  the agent, implementing view-screen or navigate scripts, wiring navigation
  state, or debugging agent context issues.
---

# Context Awareness

## Rule

The agent must always know what the user is currently viewing. The UI writes navigation state on every route change. The agent reads it before acting.

## Why

Without context awareness, the agent is blind. It asks "which email?" when the user is staring at one. It cannot act on the current selection, cannot provide relevant suggestions, and cannot modify what the user sees. Context awareness is what makes the agent feel like a collaborator rather than a disconnected chatbot.

## The Three Patterns

### 1. Navigation State (`navigation` key)

The UI writes a `navigation` key to application-state on every route change. This tells the agent what view the user is on and what item is selected.

**UI side** — the `use-navigation-state.ts` hook:

```ts
// app/hooks/use-navigation-state.ts
import { useEffect, useCallback } from "react";
import { useLocation } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useNavigationState() {
  const location = useLocation();

  // Sync route to app-state on every navigation
  useEffect(() => {
    const state = deriveNavigationState(location.pathname);
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // ... also listen for navigate commands (pattern 3)
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
- Filter state — active search, label, or category filters
- Any selection — focused item, selected text range, active tab

### 2. The `view-screen` Script

Every template should have a `view-screen` script. It reads navigation state, fetches the relevant data from the API, and returns a snapshot of what the user sees. This is the agent's eyes.

```ts
// scripts/view-screen.ts
import { readAppState } from "@agent-native/core/application-state";

export default async function main() {
  const navigation = await readAppState("navigation");
  const screen: Record<string, unknown> = { navigation };

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

**The agent should always call `view-screen` before acting.** This is a hard convention across all templates.

### 3. The `navigate` Script

The agent writes a one-shot `navigate` command to application-state. The UI reads it, performs the navigation, and deletes the entry.

**Agent side:**

```ts
import { writeAppState } from "@agent-native/core/application-state";

// Navigate the user to a specific thread
await writeAppState("navigate", { view: "inbox", threadId: "abc123" });
```

**UI side** — the hook polls for the command:

```ts
const { data: navCommand } = useQuery({
  queryKey: ["navigate-command"],
  queryFn: async () => {
    const res = await fetch("/_agent-native/application-state/navigate");
    if (!res.ok) return null;
    const data = await res.json();
    if (data) {
      // Delete the one-shot command after reading
      fetch("/_agent-native/application-state/navigate", { method: "DELETE" });
      return data;
    }
    return null;
  },
  staleTime: 2_000,
});

useEffect(() => {
  if (navCommand) {
    router.navigate(buildPath(navCommand));
  }
}, [navCommand]);
```

## Jitter Prevention

When the agent writes to application-state via script helpers (`writeAppState`), the write is tagged with `requestSource: "agent"`. The UI uses the `ignoreSource` option on `useFileWatcher()` with a per-tab ID so it ignores its own writes while still picking up changes from agents, other tabs, and scripts.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useFileWatcher({
  queryClient,
  queryKeys: ["app-state", "settings"],
  ignoreSource: TAB_ID,  // ignore events from this tab's own writes
});
```

The UI sends its tab ID via `X-Request-Source` header on PUT/DELETE requests. The server stores this as the event's `requestSource`. When polling, the UI filters out events matching its own `ignoreSource` value. This prevents the UI from refetching data it just wrote.

## Gold-Standard Example: Mail Template

The mail template demonstrates all three patterns working together:

**Navigation state shape:**
```json
{ "view": "inbox", "threadId": "thread-123", "focusedEmailId": "msg-456", "search": "budget", "label": "important" }
```

**view-screen output:**
- Reads navigation state
- Fetches email list matching current view/search/label filters
- Fetches thread messages if a thread is open
- Returns everything as a single JSON snapshot

**navigate command:**
- `{ "view": "starred" }` — switch to starred view
- `{ "view": "inbox", "threadId": "thread-123" }` — open a specific thread

## Do

- Always read `view-screen` before acting — even if you think you know what's on screen
- Include all relevant selection state in the `navigation` key (view, item IDs, filters)
- Update `view-screen` when adding new features — it should return data for every view
- Use the one-shot `navigate` command pattern for agent-initiated navigation
- Tag agent writes with `requestSource: "agent"` (the script helpers do this automatically)

## Don't

- Don't assume the user is on a specific page — always check navigation state
- Don't hardcode navigation paths in scripts — read the current state and branch
- Don't write to the `navigation` key from the agent — it belongs to the UI. Use `navigate` instead.
- Don't skip `view-screen` to save time — context errors cost more than the read
- Don't store fetched data in navigation state — it holds IDs and filters only. The `view-screen` script fetches the actual data.

## Related Skills

- **adding-a-feature** — Context awareness is area 4 of the four-area checklist
- **real-time-sync** — How polling and `useFileWatcher` deliver app-state changes to the UI
- **scripts** — How to create the `view-screen` and `navigate` scripts
- **storing-data** — Application-state is one of the core SQL stores
