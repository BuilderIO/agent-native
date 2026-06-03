---
title: "Context Awareness"
description: "How the agent knows what the user is looking at: navigation state, selection context, view-screen, sendToAgentChat handoffs, navigate commands, and jitter prevention."
---

# Context Awareness

How the agent knows what the user is looking at -- and how the agent can control what the user sees.

## Overview {#overview}

Without context awareness, the agent is blind. It asks "which email?" when the user is staring at one. It cannot act on the current selection, cannot provide relevant suggestions, and cannot modify what the user sees. With context awareness, the user can click a row, highlight a paragraph, select a slide element, or press Cmd+I, then say "summarize this" and the agent already knows what "this" means.

Five patterns solve this:

1. **Navigation state** -- the UI writes a `navigation` key to application-state on every route change
2. **Selection state** -- the UI writes a `selection` key when the user focuses, selects, or multi-selects something meaningful
3. **`view-screen`** -- an action that reads application state, fetches contextual data, and returns a snapshot of what the user sees
4. **Prompt handoff** -- UI controls call `sendToAgentChat()` when a click should become an agent turn
5. **`navigate`** -- a one-shot command from the agent that tells the UI where to go

## Context layers {#context-layers}

Use different context channels for different jobs:

| Layer                                     | Owner             | Use it for                                                                 |
| ----------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `navigation` app-state key                | UI                | Current route, view, open record, filters, active tab                      |
| `selection` app-state key                 | UI                | Durable semantic selection: rows, blocks, shapes, assets, messages         |
| `pending-selection-context` app-state key | UI / `AgentPanel` | One-shot selected text attached to the next chat turn, usually from Cmd+I  |
| `view-screen` action                      | Agent             | Hydrating the app-state keys into real records and screen summaries        |
| `sendToAgentChat()`                       | UI                | Turning a click, command, comment pin, or selected item into a chat prompt |
| `navigate` app-state key                  | Agent             | Asking the UI to move to another route or focus another object             |

The short version: app state tells the agent what the user is looking at, `view-screen` turns that state into useful data, and `sendToAgentChat()` turns UI intent into a chat message when the user clicks a command.

## Navigation state {#navigation-state}

The UI writes a `navigation` key to application-state on every route change. This tells the agent what view the user is on, what item is open, and which filters shape the visible list.

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

- `view` -- the current page/section, such as "inbox", "form-builder", or "dashboard"
- Item IDs -- the selected/open item, such as `threadId` or `formId`
- Filter state -- active search, label, or category filters
- Light focus state -- focused row, active tab, current panel

Keep `navigation` small and URL-like. It should identify the current screen, not duplicate whole records. Fetch records in `view-screen` so the agent always gets fresh data.

The agent reads this before acting:

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## Selection state {#selection-state}

Selection is semantic UI state. It is how "the chart I clicked", "these three rows", "this slide title", or "the current email draft range" becomes model-visible context.

Use the `selection` app-state key for durable selection that should survive a moment of navigation, empty-chat suggestions, or a later `view-screen` call:

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "Q3 launch plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

Write it from the UI when the user selects, focuses, or multi-selects meaningful objects:

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

Good selection state includes:

- Stable IDs the agent can use in actions, such as `threadId`, `slideId`, or `assetId`
- A short human label so prompts and suggestions are readable
- Enough text or metadata to disambiguate the object
- Optional UI locators such as selectors or coordinates when the agent needs to refer back to a visual element
- `capturedAt` when stale selection would be harmful

Avoid storing secrets, full documents, large binary payloads, or whole API responses in `selection`. Store IDs plus short excerpts, then let `view-screen` fetch the current source of truth.

### One-shot selected text {#pending-selection-context}

`AgentPanel` already handles the common text-selection flow. When the user presses Cmd+I (or Ctrl+I) with text selected on the page, it:

1. Reads `window.getSelection()`
2. Writes `{ text, capturedAt }` to `pending-selection-context`
3. Focuses the agent chat

The production agent injects that key into the next turn as immediate selection context and ignores it once it is stale. This is the path that makes "select text, press Cmd+I, ask 'make this punchier'" work without the user copying the selection into the prompt.

Custom editors can write the same key when their selection is not represented by native browser selection:

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

Use `pending-selection-context` for one-shot "act on this exact highlighted text" flows. Use `selection` for durable object selection that `view-screen` and dynamic suggestions should keep seeing.

## The view-screen action {#view-screen-action}

Every template should have a `view-screen` action. It reads navigation and selection state, fetches the relevant data, and returns a snapshot of what the user sees. This is the agent's eyes.

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Reads navigation and selection state and fetches matching data.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState("navigation")) as any;
    const selection = (await readAppState("selection")) as any;
    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (selection) screen.selection = selection;

    const db = getDb();

    // Fetch data based on what the user is viewing
    if (navigation?.view === "inbox") {
      screen.emailList = await db
        .select()
        .from(schema.emails)
        .where(eq(schema.emails.label, navigation.label));
    }
    if (navigation?.threadId) {
      screen.thread = await db
        .select()
        .from(schema.threads)
        .where(eq(schema.threads.id, navigation.threadId));
    }
    if (selection?.kind === "email.messages") {
      screen.selectedMessages = await db
        .select()
        .from(schema.emails)
        .where(inArray(schema.emails.id, selection.messageIds));
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
```

The agent should call `pnpm action view-screen` before acting on the current UI. This is a hard convention across all templates. When adding new features, update `view-screen` to return data for the new view and any new selection shape.

## Prompt handoff with `sendToAgentChat()` {#send-to-agent-chat}

Sometimes context should not just sit in app state. A user clicks a button, drops a comment pin, selects an item and chooses "Ask agent", or presses an AI command in a toolbar. That click is an instruction. In browser UI, hand it to the agent with `sendToAgentChat()`.

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

Use the fields deliberately:

| Field               | Meaning                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `message`           | Visible prompt text shown in chat                                                |
| `context`           | Hidden model-visible context, not shown as user-facing chat text                 |
| `submit: true`      | Send immediately; good for explicit command buttons such as "Fix layout"         |
| `submit: false`     | Prefill for user review; good for "Ask agent about this" or ambiguous selections |
| `openSidebar: true` | Make the agent response visible even if the panel was collapsed                  |
| `newTab: true`      | Start a separate chat thread for a larger creation task                          |
| `type: "code"`      | Route to the code-editing frame when the request is about changing app source    |

`sendToAgentChat()` is the supported browser wrapper for the submitted-chat path sometimes seen internally as `agentNative.submitChat`. App UI should call the wrapper instead of posting `agentNative.submitChat` directly because the wrapper handles local sidebars, Builder/Frame routing, MCP App host routing, tab IDs, and code-request routing.

Use `agentChat.submit()` or `agentChat.prefill()` for Node/script contexts where there is no browser sidebar. Server actions generally should not call browser-only `sendToAgentChat()`; if an action needs the open UI to ask the agent something, write a small request into `application_state` and let a UI bridge send it from the browser.

### Clicked items in the prompt {#clicked-items-in-prompt}

For the "click items in the UI and they become part of the prompt" experience, combine selection state with prompt handoff:

1. On click or multi-select, write semantic `selection` state so `view-screen`, dynamic suggestions, and future turns can see it.
2. If the click is also a command, call `sendToAgentChat()` with a concise visible `message` and richer hidden `context`.
3. In `view-screen`, hydrate the selected IDs into current records so the agent can verify the object before mutating it.
4. Clear `selection` when the object is no longer selected, deleted, or no longer relevant.

That gives the user the magic "this is what I meant" behavior without stuffing every prompt with bulky visible context.

## The navigate action {#navigate-action}

The agent writes a one-shot `navigate` command to application-state. The UI reads it, performs the navigation, and deletes the entry.

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

The UI polls for this command and navigates when it appears:

```ts
// UI side -- poll for navigate commands
import {
  deleteClientAppState,
  readClientAppState,
} from "@agent-native/core/client";

const { data: navCommand } = useQuery({
  queryKey: ["navigate-command"],
  queryFn: async () => {
    const data = await readClientAppState<NavigateCommand>("navigate");
    if (data) {
      await deleteClientAppState("navigate");
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

The `navigation` key belongs to the UI -- the agent should never write to it directly. Instead, the agent writes to `navigate`, and the UI performs the actual navigation, which then updates `navigation`.

## useNavigationState hook {#use-navigation-state}

The `use-navigation-state.ts` hook syncs routes to application-state on every navigation:

```ts
// app/hooks/use-navigation-state.ts
import { useEffect } from "react";
import { useLocation } from "react-router";
import { setClientAppState } from "@agent-native/core/client";

export function useNavigationState() {
  const location = useLocation();

  useEffect(() => {
    const state = deriveNavigationState(location.pathname);
    setClientAppState("navigation", state).catch(() => {});
  }, [location.pathname]);
}
```

The `deriveNavigationState()` function is template-specific -- it parses the URL path and extracts the view, item IDs, and filters relevant to your app.

## Jitter prevention {#jitter-prevention}

When the agent writes to application-state, the sync system might cause the UI to refetch data it just wrote. This creates jitter. The solution is source tagging:

Use `setClientAppState`, `writeClientAppState`, `readClientAppState`, and `deleteClientAppState` from `@agent-native/core/client` for browser-side application-state access. Pass `{ requestSource: TAB_ID }` on UI writes when pairing with `useDbSync({ ignoreSource: TAB_ID })`; pass `{ keepalive: true }` for short-lived writes such as selection cleanup during unload.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

How it works:

- Agent writes are tagged with `requestSource: "agent"` (the action helpers do this automatically)
- UI writes include the tab's unique ID via `X-Request-Source` header
- The server stores the source on each event
- When processing sync events, the UI filters out events matching its own `ignoreSource` value -- so it doesn't refetch data it just wrote
- Events from agents, other tabs, and actions still come through normally
