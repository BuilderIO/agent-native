---
title: "Embedding SDK"
description: "Embed an Agent-Native sidecar into an existing SaaS app with page context and host commands."
---

# Embedding SDK

The embedding SDK is for the CLAW-style shape: keep your existing SaaS app, add a durable agent sidecar, and let that agent see and operate on the page the user is already using.

Use it when you want an assistant that can:

- Read current page context: route, selected resource, highlighted text, active filters, user/org, and app-specific state.
- Call your backend through normal Agent-Native actions, MCP tools, or integration adapters.
- Ask the host app to navigate, refresh data, remount a view, or open a resource after it changes something.
- Run as an iframe/sidebar now, while leaving room for a pure React wrapper or hosted template later.

## Host App

Render the sidecar with `<AgentNativeFrame />` in your existing React app:

```tsx
import { AgentNativeFrame } from "@agent-native/core/client";

export function AssistantDock({ customer, sessionToken }) {
  return (
    <AgentNativeFrame
      agentUrl="https://agent.example.com/workspaces/acme/sidecar"
      className="h-full w-full"
      auth={() => ({ token: sessionToken })}
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
      commands={{
        navigate: ({ payload }) => router.navigate(payload.path),
        refreshData: ({ payload }) => queryClient.invalidateQueries(payload),
        remountView: () => setAppKey((key) => key + 1),
        openResource: ({ payload }) => openResource(payload),
      }}
    />
  );
}
```

The host bridge only accepts messages from `agentUrl`'s origin by default. Pass `agentOrigin` if the iframe URL is a routed/proxied URL whose trusted origin differs.

## Iframe Side

Inside the Agent-Native sidecar, use the frame helpers to request host context or ask the host to do UI work:

```ts
import {
  announceAgentNativeFrameReady,
  requestAgentNativeHostContext,
  sendAgentNativeHostCommand,
} from "@agent-native/core/client";

announceAgentNativeFrameReady({ hostOrigin: "https://app.example.com" });

const context = await requestAgentNativeHostContext({
  hostOrigin: "https://app.example.com",
});

await sendAgentNativeHostCommand(
  "refreshData",
  { queryKey: ["customer", context.resource?.id] },
  { hostOrigin: "https://app.example.com" },
);
```

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

If no handler is provided, safe defaults dispatch browser events like `agentNative:refresh-data` and `agentNative:remount-view`. For high-blast-radius operations, provide explicit handlers and approval UI in the host app.

## Recommended Product Shape

Start iframe-first. It works for Builder.io, customer SaaS apps, and internal admin tools without coupling release cycles or CSS/runtime assumptions.

The sidecar itself should still be an Agent-Native app/template: actions are the backend API surface, app state is the agent's context memory, and integrations such as Slack or Telegram can route into the same durable chat. The embedding SDK just supplies the missing membrane between that sidecar and the current host page.
