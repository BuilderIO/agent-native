---
title: "Embedding SDK"
description: "Embed an Agent-Native sidecar into an existing SaaS app with page context and host commands."
---

# Embedding SDK

The embedding SDK is for the CLAW-style shape: keep your existing SaaS app, add a durable agent sidecar, and let that agent see and operate on the page the user is already using.

Use it when you want an assistant that can:

- Read current page context: route, selected resource, highlighted text, active filters, user/org, and app-specific state.
- Call durable backend actions, MCP tools, or integration-backed tools from the sidecar app.
- Ask the host app to navigate, refresh data, remount a view, or open a resource after durable work completes.
- Run as an iframe/sidebar now, while leaving room for a no-iframe package or hosted template later.

## Host App

For React apps, use `<AgentNative />`. It renders the iframe sidecar and wires page context, live client actions, and host refresh/navigation commands in one place:

```tsx
import { AgentNative, defineClientAction } from "@agent-native/core/client";

export function AssistantDock({ customer, sessionToken }) {
  return (
    <AgentNative
      agentUrl="https://agent.example.com/workspaces/acme/sidecar"
      className="h-full w-full"
      session={{ id: browserTabId(), label: "Customer detail" }}
      auth={() => ({ token: sessionToken })}
      screen={{ includeVisibleText: true }}
      getContext={() => ({
        route: {
          name: "customer-detail",
          pathname: window.location.pathname,
          params: { customerId: customer.id },
        },
        resource: {
          type: "customer",
          id: customer.id,
          name: customer.name,
        },
        selection: {
          ids: getSelectedRowIds(),
          text: window.getSelection()?.toString() || undefined,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction<{ contentId: string }, { published: true }>({
          name: "publish-content",
          description: "Publish a Builder content entry",
          schema: {
            type: "object",
            properties: { contentId: { type: "string" } },
            required: ["contentId"],
          },
          destructive: true,
          approval: { title: "Publish this entry?", risk: "medium" },
          run: async ({ contentId }, { refresh }) => {
            await builderApi.publish(contentId);
            await refresh({ queryKey: ["content", contentId] });
            return { published: true };
          },
        }),
        defineClientAction<{ elementId: string }, void>({
          name: "select-element",
          description: "Select an element in the live visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onNavigate={(payload) => {
        const { path } = payload as { path: string };
        router.navigate(path);
      }}
      onRefresh={(payload) => {
        const { queryKey } = payload as { queryKey?: readonly unknown[] };
        queryClient.invalidateQueries({ queryKey });
      }}
      onRemount={() => setAppKey((key) => key + 1)}
      onOpenResource={(payload) => openResource(payload)}
      onRequestApproval={(payload) => approvalDialog.confirm(payload)}
    />
  );
}
```

Use `screen={false}` if you only want explicit semantic context. Use `screen={{ includeDomHtml: true }}` as a fallback for apps that have not yet mapped their UI into semantic IDs and selection state. The host bridge only accepts messages from `agentUrl`'s origin by default. Pass `agentOrigin` if the iframe URL is a routed/proxied URL whose trusted origin differs.

For non-React hosts, call `createAgentNativeHostBridge()` directly and pass the same `getContext`, `actions`, and `commands` options.

## Iframe Side

Inside the Agent-Native sidecar, use the frame helpers to request host context, discover live browser-session actions, run them, or ask the host to do UI work. Always pass the expected `hostOrigin` in production:

```ts
import {
  announceAgentNativeFrameReady,
  createAgentNativeHostTools,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
} from "@agent-native/core/client";

announceAgentNativeFrameReady({ hostOrigin: "https://app.example.com" });

const context = await requestAgentNativeHostContext({
  hostOrigin: "https://app.example.com",
});

const liveActions = await requestAgentNativeHostActions({
  hostOrigin: "https://app.example.com",
});

await runAgentNativeHostAction(
  "select-element",
  { elementId: context.selection?.ids?.[0] },
  { hostOrigin: "https://app.example.com" },
);

await sendAgentNativeHostCommand(
  "refreshData",
  { queryKey: ["customer", context.resource?.id] },
  { hostOrigin: "https://app.example.com" },
);

const hostTools = createAgentNativeHostTools({
  hostOrigin: "https://app.example.com",
});
```

## Actions

There are two action classes:

| Action kind    | Where it runs                                               | Works when browser is closed? | Best for                                                                                                 |
| -------------- | ----------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Backend action | Sidecar app, backend API, MCP, or integration adapter       | Yes                           | Durable work like create, update, publish, sync, send, import.                                           |
| Client action  | Current browser tab through `<AgentNative actions={...} />` | No                            | Ephemeral UI work like select an element, read editor state, scroll to a row, copy current canvas state. |

Backend actions should be the default for anything that must survive refreshes, closed browsers, retries, or integration-triggered runs. They belong in the sidecar app's normal Agent-Native action/tool layer, where the agent can call them from chat, automations, Slack/Telegram/email integrations, and background jobs.

Client actions are a live bridge to one browser tab. The host advertises them with `source: "client"` and `availability: "browser-session"`, and the sidecar should treat that manifest as temporary. Re-list actions when route or selection changes, and fall back to backend actions when the tab disappears.

## Sessions And Tabs

The host bridge is scoped to one iframe/host-window pair. If the same user opens multiple tabs, each tab has its own `session`, context, selection, client actions, and pending command responses. Do not assume a client action discovered in one tab can run in another tab, or that it will still exist after navigation.

For multi-tab products, keep durable state in SQL/backend actions and use client actions only for the tab-local parts: focusing a row, copying visible editor state, selecting a canvas element, or refreshing the current React Query cache. Include enough `route`, `resource`, and `selection` context for the sidecar to decide whether the current tab is the right place to run a browser-session action.

## Command Model

Built-in command names are deliberately app-shaped, not database-shaped:

| Command                                | Purpose                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `navigate`                             | Move the host UI to a path/view/resource.                              |
| `refreshData` / `refresh-data`         | Ask the host to invalidate client-side data.                           |
| `remountView` / `remount-view`         | Ask the host to remount a subtree, e.g. `<App key={key} />`.           |
| `hardReload` / `hard-reload`           | Full browser reload.                                                   |
| `openResource` / `open-resource`       | Open a specific domain object in the host UI.                          |
| `requestApproval` / `request-approval` | Ask the host to show a confirmation flow. Register a handler for this. |

If no handler is provided, safe defaults dispatch browser events like `agentNative:refresh-data` and `agentNative:remount-view`. `requestApproval` has no default handler; register one before relying on it.

## Approval Guidance

Mark risky client actions with `destructive: true` in their manifest and require host approval before running operations that delete, publish, send, charge, invite, share, or otherwise affect users outside the current view. Backend actions should enforce their own authorization and approval checks too; host approval is useful UX, not the security boundary.

Prefer this shape:

- Durable mutation runs in a backend action with validation, auth, audit logging, and retries.
- Host command opens an approval UI or focuses the affected resource.
- Client action handles only the live UI step that cannot happen on the backend.

## Runtime Integration

Use `createAgentNativeHostTools()` inside the sidecar iframe when your agent runtime accepts plain tool descriptors. It returns four framework-agnostic tools:

| Tool                | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `view-host-screen`  | Read semantic host context and screen snapshot.                     |
| `list-host-actions` | List live browser-session actions exposed by the current tab.       |
| `run-host-action`   | Run one live client action by name.                                 |
| `send-host-command` | Send host commands such as refresh, navigate, remount, or approval. |

The helper intentionally returns plain `{ name, description, parameters, execute }` objects so sidecars can adapt them to the AI SDK, Anthropic, OpenAI function calling, or Agent-Native `ActionEntry` shape without coupling this SDK to one runtime.

## Recommended Product Shape

Start iframe-first. It works for Builder.io, customer SaaS apps, and internal admin tools without coupling release cycles or CSS/runtime assumptions.

The sidecar itself should still be an Agent-Native app/template: actions are the backend API surface, SQL-backed app state is the agent's memory, and integrations such as Slack or Telegram can route into the same durable chat. The embedding SDK supplies the live membrane between that sidecar and the current host page.
