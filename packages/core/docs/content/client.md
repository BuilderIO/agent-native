---
title: "Client"
description: "React hooks and utilities for agent-native apps: sendToAgentChat, optional agent chat context state, useDbSync, useAgentChatGenerating, and cn."
---

# Client

`@agent-native/core` provides React hooks and utilities for the browser-side of agent-native apps.

These client/React APIs are exported from both `@agent-native/core` and `@agent-native/core/client`. Import them from `@agent-native/core/client` (the browser entry) for clarity and correct bundling, since the bare `@agent-native/core` root resolves to the Node build by default.

## File-Based Routing {#file-based-routing}

Agent-native apps use **React Router v7** with file-based routing via `flatRoutes()` from `@react-router/fs-routes`. Every file in `app/routes/` becomes a URL. Templates use the dot-notation convention — dots separate URL segments inside a single filename.

### File → URL mapping

| File                  | URL                | Notes                                  |
| --------------------- | ------------------ | -------------------------------------- |
| `_index.tsx`          | `/`                | Index route                            |
| `settings.tsx`        | `/settings`        | Simple page                            |
| `inbox.$threadId.tsx` | `/inbox/:threadId` | Dot = `/`, `$` = dynamic param         |
| `_app.tsx`            | (no URL segment)   | Pathless layout — prefix with `_`      |
| `inbox/route.tsx`     | `/inbox`           | Folder form — `route.tsx` is the index |

Prefix a segment with `$` for a dynamic param. Prefix with `_` to make it a pathless layout route (no URL segment). Templates use `flatRoutes()` — the dot-notation file above is primary; the nested-folder form `inbox/route.tsx` also works.

## Fetching and Mutating Data {#fetching-mutating}

The primary way to read and write app data from the browser is through the action hooks. Never hand-write `fetch` calls to `/_agent-native/*` routes — use the named helpers instead (see [Actions](/docs/actions)).

```tsx
import {
  useActionQuery,
  useActionMutation,
  callAction,
} from "@agent-native/core/client";

// Read: auto-cached, auto-invalidated on mutations
const { data, isLoading } = useActionQuery("get-lead", { leadId });

// Mutate: emits a change event so query caches refetch
const { mutate, isPending } = useActionMutation("create-lead");
mutate({ name: "Alice", company: "Acme" });

// Imperative: for one-off calls outside a component
await callAction("archive-lead", { leadId });
```

---

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
App host bridge, which asks the containing host to add hidden context and send
the visible user turn. `context` is sent as model context before the visible
message, so it stays model-visible without being posted as user-facing chat or
concatenated into the host's visible prompt.
`submit: false` keeps the local prefill/review behavior because MCP Apps do not
define a standard draft-prefill API.

Internally this is the submitted-chat path sometimes surfaced as
`agentNative.submitChat`; app code should call `sendToAgentChat()` rather than
posting that event directly.

```ts
import { sendToAgentChat } from "@agent-native/core/client";

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

### Silent background sends {#background-send}

Use `background: true` when a UI action should kick off real agent work without
opening or focusing the sidebar. This still creates a normal chat thread/run,
uses the agent's tools/actions/context, and keeps the work observable through
the runs tray; it is not a raw one-shot model call.

```ts
const tabId = sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

`background` is intended to be paired with `newTab` so the hidden work does not
overwrite the user's active conversation. Use the returned `tabId` if the UI
needs to correlate follow-up status or deep-link into the run later.

### AgentChatMessage {#agentchatmessage}

| Option                | Type        | Description                                                                |
| --------------------- | ----------- | -------------------------------------------------------------------------- |
| `message`             | `string`    | The visible prompt sent to the chat                                        |
| `context`             | `string?`   | Hidden context appended (not shown in chat UI)                             |
| `submit`              | `boolean?`  | true = auto-submit, false = prefill only                                   |
| `newTab`              | `boolean?`  | Create a separate chat thread for this prompt                              |
| `background`          | `boolean?`  | With `newTab`, run without focusing the tab and show the run in `RunsTray` |
| `openSidebar`         | `boolean?`  | Set false to submit/prefill without opening the sidebar                    |
| `projectSlug`         | `string?`   | Optional project slug for structured context                               |
| `preset`              | `string?`   | Optional preset name for downstream consumers                              |
| `referenceImagePaths` | `string[]?` | Optional reference image paths                                             |

## Agent Chat Context State (Advanced) {#agent-chat-context-state}

The context-state APIs are optional plumbing for UI that needs two-way sync with
staged context chips: rendering the current staged items outside the composer,
reflecting whether an item is already attached, or providing explicit
remove/clear controls.

Do not reach for these helpers for simple "send this to the agent" or
"prefill this draft for review" flows. Use `sendToAgentChat()` with `context`
and `submit` for those.

| API                               | Use when                                                               |
| --------------------------------- | ---------------------------------------------------------------------- |
| `useAgentChatContext()`           | A React component needs the live staged context list                   |
| `setAgentChatContextItem(item)`   | Imperative code should stage or replace one keyed context item         |
| `listAgentChatContext()`          | Non-React code needs a one-time snapshot of staged context             |
| `removeAgentChatContextItem(key)` | UI should remove one staged context item by its stable `key`           |
| `clearAgentChatContext()`         | UI should clear all staged context, such as after a view or mode reset |
| `refreshAgentChatContext()`       | Imperative code should re-read the latest persisted context snapshot   |

`useAgentChatContext()` returns `{ items, set, remove, clear, refresh }`.

```tsx
import { useAgentChatContext } from "@agent-native/core/client";

function SelectionContextButton({ record }: { record: { id: string } }) {
  const chatContext = useAgentChatContext();
  const contextKey = `selected-record:${record.id}`;
  const isAttached = chatContext.items.some((item) => item.key === contextKey);

  return (
    <button
      type="button"
      onClick={() => {
        if (isAttached) {
          chatContext.remove(contextKey);
          return;
        }

        chatContext.set({
          key: contextKey,
          title: "Selected Record",
          context: JSON.stringify(record, null, 2),
          openSidebar: false,
        });
      }}
    >
      {isAttached ? "Remove from prompt context" : "Add to prompt context"}
    </button>
  );
}
```

`listAgentChatContext()` is for imperative code that only needs to inspect the
current staged items once. `clearAgentChatContext()` is intentionally broad; use
`removeAgentChatContextItem(key)` when only one selection changed.

### AgentChatContextSetOptions {#agentchatcontextsetoptions}

| Option        | Type       | Description                                            |
| ------------- | ---------- | ------------------------------------------------------ |
| `key`         | `string`   | Stable identifier used to replace an existing nugget   |
| `title`       | `string`   | Short label shown in the composer chip                 |
| `context`     | `string`   | Hidden context included with the next submitted prompt |
| `openSidebar` | `boolean?` | Defaults to true; pass false to stage context silently |

## askUserQuestion(opts) {#ask-user-question}

Ask the user a multiple-choice question from app code, render it inline in the
agent panel, and **await their answer**. It's the client-side twin of the
agent's built-in `ask-question` tool: it writes a `GuidedQuestionPayload` to the
`"guided-questions"` application-state key (where the mounted
`GuidedQuestionFlow` renders it) and reveals the agent panel so the question is
visible. Unlike the agent tool — whose answer flows back to the agent —
`askUserQuestion()` **resolves with the answer to the caller**, so the UI can
branch on it.

Use it when the UI needs exactly one small decision (2–4 options) before it
kicks off agent work — instead of building a custom modal. Reach for the
composer for freeform detail, and a form/popover for multi-field input.

```tsx
import { askUserQuestion, sendToAgentChat } from "@agent-native/core/client";

const length = await askUserQuestion({
  question: "How long should this deck be?",
  header: "Deck length", // optional short chip/heading (≈12 chars)
  options: [
    { label: "Short (3–5 slides)", value: "short" },
    { label: "Medium (6–10 slides)", value: "medium", recommended: true },
    { label: "Long (11+ slides)", value: "long" },
  ],
  allowFreeText: false, // omit the "Other" free-text option (default adds it)
  allowMultiple: false, // single-select (default)
});

if (length) {
  sendToAgentChat({ message: `Generate a ${length} deck.`, submit: true });
}
```

Each option is `{ label, value?, description?, preview?, recommended? }`; `value`
defaults to `label`, and `preview` renders a small mockup/code snippet under the
option. The promise resolves with the selected `value` (or `value[]` when
`allowMultiple`), the free-text string when the user picks "Other", or `null`
if they skip — it stays pending until the user answers. Requires the agent panel
to be mounted (it is in every template).

The agent reaches the same UI through its `ask-question` tool: prefer letting the
agent ask when _it_ hits a genuine fork it can't resolve from context; use
`askUserQuestion()` when the _UI_ needs to gate an action on a choice.

## MCP App Host Bridge {#mcp-app-host-bridge}

Routes embedded as MCP Apps should be URL-first: load the current artifact from
path/query params, render the real React route or a focused shared component,
and use the host bridge only for host-owned behavior. `@agent-native/core/client`
exports the helpers embedded routes call:

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
helpers (`openMcpAppHostLink`, `requestMcpAppDisplayMode`,
`updateMcpAppModelContext`) return `false` outside an embedded MCP App frame, or
`Promise<boolean>` inside a frame. `sendToAgentChat()` uses the same bridge for
auto-submitted prompts from embedded routes.

The bridge itself — the `ui/*` JSON-RPC messages, the `agentNative.mcpHost.*`
wrapper relay, transplant vs. controlled-frame rendering, host context, and
display-mode requests — is owned by
[External Agents](/docs/external-agents#mcp-app-bridge).

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
import { useAgentChatGenerating } from "@agent-native/core/client";

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
import { useDbSync } from "@agent-native/core/client";
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

| Option             | Type               | Description                                                                            |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `queryClient`      | `QueryClient?`     | React-query client for cache invalidation                                              |
| `queryKeys`        | `string[]?`        | Deprecated and ignored; kept for old call sites                                        |
| `pollUrl`          | `string?`          | Poll endpoint URL. Default: `"/_agent-native/poll"`                                    |
| `sseUrl`           | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only |
| `interval`         | `number?`          | Polling interval in ms. Default: `2000`                                                |
| `fallbackInterval` | `number?`          | Fallback polling interval when SSE is unavailable. Default: `15000`                    |
| `pauseWhenHidden`  | `boolean?`         | Pause polling when the browser tab is hidden. Default: `true`                          |
| `ignoreSource`     | `string?`          | Per-tab request source to ignore so a tab does not refetch from its own writes         |
| `onEvent`          | `(data) => void`   | Optional callback when SSE/polling receives a change event                             |

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
import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
