---
title: "Client"
description: "React hooks and utilities for agent-native apps: sendToAgentChat, useDbSync, useAgentChatGenerating, and cn."
---

# Client

`@agent-native/core` provides React hooks and utilities for the browser-side of agent-native apps.

## File-Based Routing {#file-based-routing}

Agent-native apps use **React Router v7** with file-based routing. Every file in `app/routes/` becomes a URL.

### File → URL mapping

| File                             | URL                                   |
| -------------------------------- | ------------------------------------- |
| `app/routes/_index.tsx`          | `/`                                   |
| `app/routes/settings.tsx`        | `/settings`                           |
| `app/routes/inbox/index.tsx`     | `/inbox`                              |
| `app/routes/inbox/$threadId.tsx` | `/inbox/:threadId`                    |
| `app/routes/inbox.$threadId.tsx` | `/inbox/:threadId` (flat alternative) |

Prefix a segment with `$` for dynamic params. Prefix with `_` to make it a pathless layout route (doesn't add a URL segment). `_index.tsx` is the index route for its folder.

### Adding a new page

Create the file and export a default component:

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

That's it — React Router picks it up automatically, no registration needed.

### Dynamic params

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

### Navigation

Use `<Link>` for client-side navigation and `useNavigate()` for programmatic navigation:

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

---

## sendToAgentChat(opts) {#sendtoagentchat}

Send a message to the agent chat via postMessage. Used to delegate AI tasks from UI interactions.

When the app route is running inside an MCP App embed created with `embedApp()`,
auto-submitted messages (`submit` omitted or `true`) are forwarded to the MCP
App wrapper, which asks the containing host to add hidden context and send the
visible user turn. `context` is sent as model context before the visible
message, so it stays model-visible without being posted as user-facing chat.
`submit: false` keeps the local prefill/review behavior because MCP Apps do not
define a standard draft-prefill API.

```ts
import { sendToAgentChat } from "@agent-native/core";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});
```

### AgentChatMessage {#agentchatmessage}

| Option                | Type        | Description                                    |
| --------------------- | ----------- | ---------------------------------------------- |
| `message`             | `string`    | The visible prompt sent to the chat            |
| `context`             | `string?`   | Hidden context appended (not shown in chat UI) |
| `submit`              | `boolean?`  | true = auto-submit, false = prefill only       |
| `projectSlug`         | `string?`   | Optional project slug for structured context   |
| `preset`              | `string?`   | Optional preset name for downstream consumers  |
| `referenceImagePaths` | `string[]?` | Optional reference image paths                 |

## MCP App Host Bridge {#mcp-app-host-bridge}

Routes embedded by `embedApp()` should be URL-first: load the current artifact
from path/query params, render the real React route or a focused shared
component, and use host bridge messages only for host-owned behavior.

The wire contract is:

| Direction       | Message type                             | Purpose                                           |
| --------------- | ---------------------------------------- | ------------------------------------------------- |
| wrapper → route | `agentNative.mcpHostContext`             | Push host context such as theme/display mode      |
| route → wrapper | `agentNative.mcpHost.updateModelContext` | Add hidden model context                          |
| route → wrapper | `agentNative.mcpHost.openLink`           | Ask the host to open a URL                        |
| route → wrapper | `agentNative.mcpHost.requestDisplayMode` | Ask for `inline`, `fullscreen`, or `pip`          |
| wrapper → route | `agentNative.mcpHost.response`           | Resolve or reject a request by matching requestId |

Use the exported helpers from `@agent-native/core/client` inside embedded
routes:

```ts
import {
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "@agent-native/core/client";
```

`getMcpAppHostContext()` reads the latest pushed host context snapshot;
`useMcpAppHostContext()` subscribes React components to changes. The request
helpers return `false` outside an embedded MCP App frame, or
`Promise<boolean>` inside a frame. `sendToAgentChat()` uses the same bridge for
auto-submitted prompts from embedded routes.

## Dynamic Suggestions {#dynamic-suggestions}

`<AgentSidebar>`, `<AgentPanel>`, and `<AssistantChat>` merge static `suggestions` with context-aware suggestions by default. The framework reads `navigation`, `selection`, `pending-selection-context`, and the current URL from application state while an empty chat is visible, then offers prompt chips that match the current screen.

```tsx
<AgentSidebar
  suggestions={["Summarize my inbox"]}
  dynamicSuggestions={{ max: 4 }}
>
  <App />
</AgentSidebar>
```

Set `dynamicSuggestions={false}` to keep only static chips. Pass `getSuggestions` when an app wants deterministic domain-specific chips from the same application-state context.

## useAgentChatGenerating() {#useagentchatgenerating}

React hook that wraps sendToAgentChat with loading state tracking:

```ts
import { useAgentChatGenerating } from "@agent-native/core";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

`isGenerating` turns true when you call `send()` and automatically resets to false when the agent finishes generating.

## useDbSync(options?) {#usedbsync}

React hook (formerly `useFileWatcher`) that listens for database changes over SSE, falls back to polling, and invalidates the framework query caches that keep the UI aligned with agent writes:

```ts
import { useDbSync } from "@agent-native/core";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### Options {#usedbsync-options}

| Option         | Type               | Description                                                                            |
| -------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `queryClient`  | `QueryClient?`     | React-query client for cache invalidation                                              |
| `queryKeys`    | `string[]?`        | Deprecated and ignored; kept for old call sites                                        |
| `pollUrl`      | `string?`          | Poll endpoint URL. Default: `"/_agent-native/poll"`                                    |
| `sseUrl`       | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only |
| `ignoreSource` | `string?`          | Per-tab request source to ignore so a tab does not refetch from its own writes         |
| `onEvent`      | `(data) => void`   | Optional callback when SSE/polling receives a change event                             |

For normal CRUD, prefer `useActionQuery` and `useActionMutation`; mutating actions emit `source: "action"` and those hooks refetch automatically.

## useChangeVersion / useChangeVersions {#use-change-version}

The framework uses change versions to sync React Query caches with changes made by background agents, cron jobs, or other users.

When any server-side database mutation occurs, the server records a change event with a specific `source` key. The client's `useDbSync` listener receives these events and bumps the local change version counter for that source. By folding the version counter into your React Query keys, queries automatically refetch whenever the backend notifies the client of new activity.

- **`useChangeVersion(source: string): number`** — returns a counter that increments whenever the specified `source` is mutated.
- **`useChangeVersions(sources: readonly string[]): number`** — returns the sum of version counters for multiple sources.

### Example: Syncing a raw query with the database

```tsx
import { useQuery } from "@tanstack/react-query";
import { useChangeVersion } from "@agent-native/core/client";

function DashboardView({ id }) {
  // Get version for dashboards domain source
  const v = useChangeVersion("dashboards");

  const { data } = useQuery({
    queryKey: ["dashboard", id, v], // Invalidate automatically when version bumps
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // Prevent layout flicker during refetch
  });

  return <div>{data?.title}</div>;
}
```

### Latency Models & Invalidation Behavior

- **UI-Initiated mutations:** When you execute an action from the UI using `useActionMutation`, the mutation immediately fires a local event with `source: "action"` on success. This triggers an **instant, optimistic refetch** of all query keys depending on that action, avoiding visual delay.
- **Background or Agent Mutations:** When the AI agent, a webhook, or a background worker mutates data, the update is broadcast to the client. The client's `useDbSync` captures this either instantly over SSE (Server-Sent Events) or falls back to the **2-second polling tick**. The query key version then bumps, triggering a background refetch.

## cn(...inputs) {#cn}

Utility for merging class names (clsx + tailwind-merge):

```ts
import { cn } from "@agent-native/core";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
