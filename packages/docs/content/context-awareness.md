---
title: "Context Awareness"
description: "How the agent knows what the user is looking at: navigation state, view-screen, navigate commands, and jitter prevention."
---

# Context Awareness

How the agent knows what the user is looking at — and how the agent can control what the user sees.

## Overview {#overview}

Without context awareness, the agent is blind. It asks "which email?" when the user is staring at one. It cannot act on the current selection, cannot provide relevant suggestions, and cannot modify what the user sees.

Three patterns solve this:

1. **Navigation state** — the UI writes a `navigation` key to application-state on every route change
2. **`view-screen`** — an action that reads navigation state, fetches contextual data, and returns a snapshot of what the user sees
3. **`navigate`** — a one-shot command from the agent that tells the UI where to go

## Navigation state {#navigation-state}

The UI writes a `navigation` key to application-state on every route change. This tells the agent what view the user is on and what item is selected.

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "search": "budget",
  "label": "important"
}
```

What to include in navigation state:

- `view` — the current page/section (e.g., "inbox", "form-builder", "dashboard")
- Item IDs — the selected/open item (e.g., `threadId`, `formId`)
- Filter state — active search, label, or category filters
- Any selection — focused item, selected text range, active tab

The agent reads this before acting:

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## The view-screen action {#view-screen-action}

Every template should have a `view-screen` action. It reads navigation state, fetches the relevant data, and returns a snapshot of what the user sees. This is the agent's eyes.

```ts
// actions/view-screen.ts
import { readAppState } from "@agent-native/core/application-state";

export default async function main() {
  const navigation = await readAppState("navigation");
  const screen: Record<string, unknown> = { navigation };

  // Fetch data based on what the user is viewing
  if (navigation?.view === "inbox") {
    const res = await fetch(
      "http://localhost:3000/api/emails?label=" + navigation.label,
    );
    screen.emailList = await res.json();
  }
  if (navigation?.threadId) {
    const res = await fetch(
      "http://localhost:3000/api/threads/" + navigation.threadId,
    );
    screen.thread = await res.json();
  }

  console.log(JSON.stringify(screen, null, 2));
}
```

The agent should always call `pnpm action view-screen` before acting. This is a hard convention across all templates. When adding new features, update `view-screen` to return data for the new view.

## The navigate action {#navigate-action}

The agent writes a one-shot `navigate` command to application-state. The UI reads it, performs the navigation, and deletes the entry.

```ts
// Agent side — write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

The UI polls for this command and navigates when it appears:

```ts
// UI side — poll for navigate commands
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

The `navigation` key belongs to the UI — the agent should never write to it directly. Instead, the agent writes to `navigate`, and the UI performs the actual navigation (which then updates `navigation`).

## useNavigationState hook {#use-navigation-state}

The `use-navigation-state.ts` hook syncs routes to application-state on every navigation:

```ts
// app/hooks/use-navigation-state.ts
import { useEffect } from "react";
import { useLocation } from "react-router";

export function useNavigationState() {
  const location = useLocation();

  useEffect(() => {
    const state = deriveNavigationState(location.pathname);
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);
}
```

The `deriveNavigationState()` function is template-specific — it parses the URL path and extracts the view, item IDs, and filters relevant to your app.

## Jitter prevention {#jitter-prevention}

When the agent writes to application-state, the polling system might cause the UI to refetch data it just wrote. This creates jitter. The solution is source tagging:

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  queryKeys: ["app-state", "settings"],
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

How it works:

- Agent writes are tagged with `requestSource: "agent"` (the action helpers do this automatically)
- UI writes include the tab's unique ID via `X-Request-Source` header
- The server stores the source on each event
- When polling, the UI filters out events matching its own `ignoreSource` value — so it doesn't refetch data it just wrote
- Events from agents, other tabs, and actions still come through normally
