---
title: "Client"
description: "React hooks and utilities for agent-native apps: sendToAgentChat, useDbSync, useAgentChatGenerating, and cn."
---

# Client

`@agent-native/core` provides React hooks and utilities for the browser-side of agent-native apps.

## sendToAgentChat(opts) {#sendtoagentchat}

Send a message to the agent chat via postMessage. Used to delegate AI tasks from UI interactions.

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

React hook (formerly `useFileWatcher`) that polls for database changes and invalidates react-query caches:

```ts
import { useDbSync } from "@agent-native/core";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    queryKeys: ["files", "projects", "versionHistory"],
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### Options {#usedbsync-options}

| Option        | Type             | Description                                                       |
| ------------- | ---------------- | ----------------------------------------------------------------- |
| `queryClient` | `QueryClient?`   | React-query client for cache invalidation                         |
| `queryKeys`   | `string[]?`      | Query key prefixes to invalidate. Default: `["file", "fileTree"]` |
| `pollUrl`     | `string?`        | Poll endpoint URL. Default: `"/_agent-native/poll"`               |
| `onEvent`     | `(data) => void` | Optional callback for each SSE event                              |

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
