---
title: "Drop-in Agent"
description: "Mount the agent chat + workspace into any React app with <AgentPanel>, <AgentSidebar>, and sendToAgentChat()."
---

# Drop-in Agent

You don't need to build agent-native from scratch. The agent chat, workspace tab, CLI terminal, voice input, and all the related infrastructure ship as a handful of React components you drop into any app.

> **Prerequisite:** the server has to be running the `agent-chat-plugin` (it auto-mounts in every template). If you're starting from scratch, see [Server](/docs/server).

## The components at a glance {#components}

| Component             | What it is                                                             | Use it when                                                     |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `<AgentSidebar>`      | Wraps your app, adds a toggleable side panel containing the full agent | You want the agent available alongside your app on every screen |
| `<AgentToggleButton>` | Opens/closes `<AgentSidebar>` (put it in your header)                  | Pair with `<AgentSidebar>`                                      |
| `<AgentPanel>`        | The raw panel itself — chat + CLI + workspace tabs                     | You want full control over layout, or a dedicated agent page    |
| `sendToAgentChat()`   | Programmatically send a message to the chat                            | A button that hands work to the agent instead of running inline |
| `useActionMutation()` | Typesafe frontend wrapper around an action                             | The UI needs to run the same operation an agent tool would run  |

All of these are exported from `@agent-native/core/client`.

## The 80% case: `<AgentSidebar>` {#sidebar}

The most common setup is a sidebar that slides in from the right on any screen. Two pieces — the wrapper and a header button:

```tsx
// app/root.tsx
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar
      emptyStateText="How can I help?"
      suggestions={[
        "Summarize my inbox",
        "Draft a reply to the latest email",
        "Show me yesterday's signup numbers",
      ]}
      defaultSidebarWidth={420}
      position="right"
    >
      <YourApp />
    </AgentSidebar>
  );
}

// somewhere in your header / navbar
<AgentToggleButton />;
```

That's it. The user now has a toggleable agent on every page — with chat history, workspace tab, CLI terminal, voice input, and a fullscreen mode. State persists across reloads via `localStorage`.

### Props

- **`children`** — your app. Rendered in the main area; the sidebar overlays from the chosen side.
- **`emptyStateText`** — greeting shown when the chat has no messages. Default: `"How can I help you?"`.
- **`suggestions`** — starter prompts rendered as clickable chips when empty.
- **`defaultSidebarWidth`** — initial pixel width (mount-only; user resize and saved value override). Default: `380`.
- **`position`** — `"left"` or `"right"`. Default: `"right"`.
- **`defaultOpen`** — whether the sidebar starts open (desktop only). Default: `false`.

## The other 20%: `<AgentPanel>` {#panel}

When you need full control over layout — a dedicated `/chat` route, an embedded panel in a side column you manage, or a popup — render `<AgentPanel>` directly:

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>` gives you the raw tabs (Chat / CLI / Workspace) without the sidebar wrapper, the collapse button, or any state persistence. Put it wherever you want; you handle the layout.

### Selected props

- **`defaultMode`** — `"chat"` or `"cli"`. Default: `"chat"`.
- **`className`** — CSS class for the outer container.
- **`onCollapse`** — if provided, a collapse button appears in the header.
- **`isFullscreen`** / **`onToggleFullscreen`** — wire up external fullscreen state if you want a Claude-style centered column.
- **`storageKey`** — namespace for `localStorage` keys. Useful when you render multiple panels (different app instances or workspaces) in the same page.

Full props: `AgentPanelProps` in `@agent-native/core/client`.

## Programmatic messages: `sendToAgentChat()` {#send}

A button that hands work off to the agent (instead of running an inline `llm()` call — the anti-pattern from the [ladder](/docs/what-is-agent-native#the-ladder)):

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### Options

- **`message`** — the visible prompt shown in chat.
- **`context`** — hidden context appended to the prompt (selected text, cursor position, current entity id — anything the agent should know but the user shouldn't see twice).
- **`submit`** — `true` to auto-run, `false` to prefill but wait. Omit to use the project default.
- **`openSidebar`** — set to `false` for background/silent sends. Default opens the sidebar so the user sees the response.
- **`type`** — `"content"` (default) keeps the work in the embedded app agent. `"code"` routes to the code-editing frame (for agent-written code changes, see [Frames](/docs/frames)).

`sendToAgentChat` returns a stable `tabId` you can use to track the chat run.

If you want a loading state, use the `useSendToAgentChat()` hook — it returns both `send` and `isGenerating`:

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## Typesafe actions from the UI: `useActionMutation()` {#use-action-mutation}

When the UI needs to run the same operation an agent tool would run — the fourth rung of the [ladder](/docs/what-is-agent-native#rung-three) — use `useActionMutation`:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("replyToEmail");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

Type-safe arguments come from the zod schema in your `defineAction()`. See [Actions](/docs/actions) for the full action system.

## Selection + cursor awareness {#selection}

The agent can see what the user has selected — text, cells, slides, contacts — via the `navigation` and `selection` keys in application state. If you'd like Cmd-I (or similar) to send a selected range into the chat as context, see [Context Awareness](/docs/context-awareness).

## Putting it all together {#putting-it-together}

A typical drop-in setup:

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

The user sees a chat button in the header, can open it, and can talk to the agent. Your buttons hand work to that same agent instead of running one-shot LLM calls.

## What's next

- [**Actions**](/docs/actions) — `defineAction()` and `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) — selection, navigation, view-screen
- [**Workspace**](/docs/workspace) — what the Workspace tab contains (skills, memory, MCP servers, scheduled jobs)
- [**Voice Input**](/docs/voice-input) — the microphone in the chat composer
