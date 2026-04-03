# Client

`@agent-native/core` provides React hooks and utilities for the browser-side of agent-native apps.

## sendToAgentChat(opts)

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

### AgentChatMessage

| Option                | Type        | Description                                    |
| --------------------- | ----------- | ---------------------------------------------- |
| `message`             | `string`    | The visible prompt sent to the chat            |
| `context`             | `string?`   | Hidden context appended (not shown in chat UI) |
| `submit`              | `boolean?`  | true = auto-submit, false = prefill only       |
| `projectSlug`         | `string?`   | Optional project slug for structured context   |
| `preset`              | `string?`   | Optional preset name for downstream consumers  |
| `referenceImagePaths` | `string[]?` | Optional reference image paths                 |

## useAgentChatGenerating()

React hook that wraps sendToAgentChat with loading state tracking:

```tsx
import { useAgentChatGenerating } from "@agent-native/core";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() =>
        send({
          message: "Generate a summary",
          context: documentContent,
          submit: true,
        })
      }
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

`isGenerating` turns true when you call `send()` and automatically resets to false when the agent finishes generating.

## useFileWatcher(options?)

React hook that connects to the SSE endpoint and invalidates react-query caches on file changes:

```tsx
import { useFileWatcher } from "@agent-native/core";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useFileWatcher({
    queryClient,
    queryKeys: ["files", "projects", "versionHistory"],
    eventsUrl: "/api/events",
    onEvent: (data) => console.log("File changed:", data),
  });

  return <div>...</div>;
}
```

### Options

| Option        | Type             | Description                                                     |
| ------------- | ---------------- | --------------------------------------------------------------- |
| `queryClient` | `QueryClient?`   | React-query client for cache invalidation                       |
| `queryKeys`   | `string[]?`      | Query key prefixes to invalidate. Default: ["file", "fileTree"] |
| `eventsUrl`   | `string?`        | SSE endpoint URL. Default: "/api/events"                        |
| `onEvent`     | `(data) => void` | Optional callback for each SSE event                            |

## ApiKeySettings

Drop-in component for managing API keys and credentials. Shows which keys are configured and lets users enter missing ones. Requires the `envKeys` option on the core routes plugin (see [Server > Core Routes Plugin](/docs/server#core-routes-plugin)).

```tsx
import { ApiKeySettings } from "@agent-native/core/client";

function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <ApiKeySettings />
    </div>
  );
}
```

The component automatically fetches `GET /api/env-status` to show which keys are configured, and saves new values via `POST /api/env-vars` (writes to `.env` and updates `process.env`).

### Props

| Prop           | Type     | Default       | Description               |
| -------------- | -------- | ------------- | ------------------------- |
| `settingsPath` | `string` | `"/settings"` | Path to the settings page |

## useSession()

React hook for accessing the current user's auth session:

```tsx
import { useSession } from "@agent-native/core/client";

function UserMenu() {
  const { session, isLoading } = useSession();

  if (isLoading) return <span>Loading...</span>;
  if (!session) return <a href="/api/auth/login">Login</a>;

  return <span>Logged in as {session.email}</span>;
}
```

Returns `{ session: AuthSession | null, isLoading: boolean }`.

## Core API Routes

The following routes are provided by the core routes plugin and are available in every template. You can call these from client code using `fetch()`:

### GET /api/poll

Returns change events since a given version. Used by `useFileWatcher()` internally.

```ts
const res = await fetch(`/api/poll?since=${lastVersion}`);
const { version, events } = await res.json();
// events: [{ source: "app-state" | "settings" | "resources", type, key }]
```

### GET /api/env-status

Returns the configuration status of all registered env keys. Requires `envKeys` on the plugin.

```ts
const res = await fetch("/api/env-status");
const keys: Array<{
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}> = await res.json();
```

### POST /api/env-vars

Saves environment variables to `.env` and updates `process.env`. Only accepts keys registered in `envKeys`.

```ts
const res = await fetch("/api/env-vars", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    vars: [
      { key: "STRIPE_SECRET_KEY", value: "sk_live_..." },
      { key: "GITHUB_TOKEN", value: "ghp_..." },
    ],
  }),
});
const { saved } = await res.json(); // saved: ["STRIPE_SECRET_KEY", "GITHUB_TOKEN"]
```

### GET /api/ping

Health check endpoint. Returns `{ message: "pong" }` (or custom `PING_MESSAGE` env value).

## cn(...inputs)

Utility for merging class names (clsx + tailwind-merge):

```tsx
import { cn } from "@agent-native/core";

<div
  className={cn(
    "px-4 py-2 rounded",
    isActive && "bg-primary text-primary-foreground",
    className,
  )}
/>;
```
