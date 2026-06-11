---
title: "Drop-in Agent"
description: "Mount the agent chat + workspace into any React app with <AgentPanel>, <AgentSidebar>, and sendToAgentChat()."
---

# Drop-in Agent

> **Developer page.** This page is for developers embedding the agent into a React app. For the end-user experience of working with the agent, see [Using Your Agent](/docs/using-your-agent).

You don't need to build agent-native from scratch. The agent chat, workspace tab, CLI terminal, voice input, and all the related infrastructure ship as a handful of React components you drop into any app.

> **Prerequisite:** the server has to be running the `agent-chat-plugin` (it auto-mounts in every template). If you're starting from scratch, see [Server](/docs/server).
>
> Need the public API map instead of a tutorial? See [Component API](/docs/components).

## The components at a glance {#components}

| Component             | What it is                                                                            | Use it when                                                     |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `<AgentSidebar>`      | Wraps your root app layout and adds a toggleable side panel containing the full agent | You want the agent available alongside your app on every screen |
| `<AgentToggleButton>` | Opens/closes `<AgentSidebar>` (put it in your header)                                 | Pair with `<AgentSidebar>`                                      |
| `<AgentPanel>`        | The raw panel itself — chat + CLI + workspace tabs                                    | You want full control over layout, or a dedicated agent page    |
| `<AgentChatSurface>`  | A pre-wired panel/page chat surface                                                   | You want chat without the sidebar wrapper                       |
| `<AssistantChat>`     | Lower-level chat renderer with composer/history hooks                                 | You need custom chrome around the standard conversation UI      |
| `sendToAgentChat()`   | Programmatically send a message to the chat                                           | A button that hands work to the agent instead of running inline |
| `useActionMutation()` | Typesafe frontend wrapper around an action                                            | The UI needs to run the same operation an agent tool would run  |

All of these are exported from `@agent-native/core/client`.

## The 80% case: `<AgentSidebar>` {#sidebar}

The most common setup is a sidebar that opens from the right on any screen.
Wrap your existing root layout with `<AgentSidebar>`; whatever you pass as
children stays in the main app area. The agent chat is the side panel.

```tsx
// app/root.tsx
import { Outlet } from "react-router";
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
      dynamicSuggestions
      defaultSidebarWidth={420}
      position="right"
    >
      <header>
        <AgentToggleButton />
      </header>

      <main>
        <Outlet />
      </main>
    </AgentSidebar>
  );
}
```

That's it. The user now has a toggleable agent on every page — with chat history, workspace tab, CLI terminal, voice input, and a fullscreen mode. State persists across reloads via `localStorage`.

### Props

- **`children`** — your app's normal layout and routes. Rendered in the main area; the agent panel mounts beside it on desktop and over it on mobile/fullscreen.
- **`emptyStateText`** — greeting shown when the chat has no messages. Default: `"How can I help you?"`.
- **`suggestions`** — starter prompts rendered as clickable chips when empty.
- **`dynamicSuggestions`** — context-aware prompt chips merged with `suggestions`. Enabled by default; pass `false` to show only static suggestions, or `{ max, includeStatic, getSuggestions }` to customize.
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
- **`newTab`** — create a separate chat thread for this prompt.
- **`background`** — with `newTab`, run without focusing the new thread. The hidden run is tracked in `RunsTray`.
- **`openSidebar`** — set to `false` for background/silent sends. Default opens the sidebar so the user sees the response.
- **`type`** — `"content"` (default) keeps the work in the embedded app agent. `"code"` routes to the code-editing frame (for agent-written code changes, see [Frames](/docs/frames)).

`sendToAgentChat` returns a stable `tabId` you can use to track the chat run.

For silent work, pair `newTab`, `background`, and `openSidebar: false`:

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

This is still a full agent run with tools, actions, thread state, and run
tracking. It simply does not steal focus from the user's current sidebar state.

When the same route is embedded as an MCP App, submitted
`sendToAgentChat()` calls are forwarded to the host chat where supported; see
[Client](/docs/client#sendtoagentchat) for the MCP App bridge behavior.

If you want a loading state, use the `useSendToAgentChat()` hook — it returns both `send` and `isGenerating`:

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## Custom chat UI layers {#custom-chat-ui}

If you do not want `<AgentSidebar>`, choose the lowest layer that still lets the
framework own the agent runtime:

- **`<AgentChatSurface>`** — use this for a dedicated chat route or embedded
  panel. It keeps the standard chat/runtime wiring without the sidebar wrapper.
- **`<AssistantChat>`** — use this when you want to own surrounding chrome,
  tabs, headers, empty states, or composer slots while keeping the standard
  conversation renderer and adapter.
- **`@agent-native/core/client/chat`** — use this focused subpath when building
  a custom surface from pieces: `AssistantChat`, `MultiTabAssistantChat`,
  `useChatThreads`, `AgentConversation`, composer exports, and the standard
  chat adapters.
- **`@agent-native/core/client/composer`** — use this for the chat field itself:
  `PromptComposer` for the complete field, or `TiptapComposer` only when you
  are already wiring assistant-ui primitives yourself.
- **`@agent-native/core/client/conversation`** — use this for transcript
  rendering without the full chat runtime.
- **`createAgentChatAdapter()`** — use this only when building a custom
  assistant-ui runtime. It connects to the same `/_agent-native/agent-chat`
  stream and preserves run-manager recovery, attachments, model selection, and
  thread metadata.

Avoid posting directly to `/_agent-native/agent-chat` from product UI. If a
lower-level helper is missing for a real custom surface, add that named helper
first so client code does not learn a second, ad hoc transport.

### Build your own sidebar from pieces {#build-your-own-sidebar}

The stock sidebar is optional. This example builds the agent-side UI itself.
Render it inside your own shell, drawer, split pane, or route when you want to
own the layout around the agent runtime:

```tsx
import { AssistantChat, useChatThreads } from "@agent-native/core/client/chat";

function MyAgentSidebar({ projectSlug }: { projectSlug: string }) {
  const threads = useChatThreads(undefined, projectSlug);
  const threadId = threads.activeThreadId ?? undefined;

  return (
    <aside className="grid h-full grid-cols-[220px_1fr]">
      <ThreadList
        threads={threads.threads}
        activeThreadId={threadId}
        onSelect={threads.switchThread}
      />
      <AssistantChat threadId={threadId} />
    </aside>
  );
}
```

If you only need the field for a custom runtime, use the composer subpath:

```tsx
import { PromptComposer } from "@agent-native/core/client/composer";

<PromptComposer
  placeholder="Ask the agent..."
  onSubmit={async (text, files, references, options) => {
    await sendToYourRuntime({ text, files, references, options });
  }}
/>;
```

`TiptapComposer` is also public, but it is intentionally lower-level: render it
inside an assistant-ui thread/composer context. Most app code should use
`PromptComposer` or `AssistantChat`.

### Raw text completion escape hatch {#raw-text-completion}

For narrow server-side transforms that intentionally do not need tools, chat
history, run state, or user steering, use `completeText()` from
`@agent-native/core/server`. Keep it server-only and wrap user-facing usage in
an action so the UI and agent share the same operation.

```ts
import { defineAction } from "@agent-native/core";
import { completeText } from "@agent-native/core/server";

export default defineAction({
  description: "Classify a message",
  run: async ({ body }: { body: string }) => {
    const result = await completeText({
      systemPrompt: "Return exactly one label.",
      input: body,
      maxOutputTokens: 12,
      temperature: 0,
    });
    return { label: result.text.trim() };
  },
});
```

If the work needs actions, files, database writes, auditability, or multi-step
reasoning, use `sendToAgentChat()` instead, optionally with `background: true`
and `openSidebar: false`.

## Typesafe actions from the UI: `useActionMutation()` {#use-action-mutation}

When the UI needs to run the same operation an agent tool would run — rung 3 of the [ladder](/docs/what-is-agent-native#rung-three) — use `useActionMutation`:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

Type-safe arguments come from the zod schema in your `defineAction()`. See [Actions](/docs/actions) for the full action system.

## Selection + cursor awareness {#selection}

The agent can see what the user has selected — text, cells, slides, contacts — via the `navigation` and `selection` keys in application state. The empty chat also uses those keys to offer dynamic suggestions such as "Summarize this selection" or "Improve this slide" when the current screen makes them relevant. If you'd like Cmd-I (or similar) to send a selected range into the chat as context, see [Context Awareness](/docs/context-awareness).

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
