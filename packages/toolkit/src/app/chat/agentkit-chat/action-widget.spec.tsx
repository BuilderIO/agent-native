// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit";
import type {
  AgentToolCall,
  AgentTransport,
  AgentWidget,
} from "@agent-native/agentkit/protocol";
import {
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
} from "@agent-native/core/action-ui";
import {
  AgentNativeI18nProvider as CoreAgentNativeI18nProvider,
  type AgentNativeI18nProviderProps,
} from "@agent-native/core/client/i18n";
import {
  createDataInsightsWidgetResult,
  createDataTableWidgetResult,
} from "@agent-native/core/data-widgets";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentKitProvider } from "../../agentkit/react/context.js";
import { createToolkitI18nCatalog } from "../../i18n.js";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "../chat/tool-render-registry.js";
import { AgentKitActionWidget } from "./action-widget.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

function AgentNativeI18nProvider(props: AgentNativeI18nProviderProps) {
  return (
    <CoreAgentNativeI18nProvider
      {...props}
      catalog={props.catalog ?? toolkitI18nCatalog}
    />
  );
}

describe("AgentKitActionWidget", () => {
  it("resolves the renderer with stored action args and structured result", async () => {
    const toolCall: AgentToolCall = {
      id: "tool-1",
      name: "preview-inbox",
      input: { query: "priority inbox" },
      output: { count: 3, status: "ready" },
      status: "completed",
    };
    const widget: AgentWidget = {
      id: "tool-1:chat-ui",
      kind: "mail.inbox-preview",
      title: "Inbox preview",
      data: { toolCallId: toolCall.id, toolName: toolCall.name },
    };
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [],
          toolCalls: [toolCall],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");
    const unregister = registerActionChatRenderer({
      id: "test.agentkit-action-widget",
      renderer: widget.kind,
      Component: ({ context }: ToolRendererProps) => (
        <output>
          {String(context.args.query)}:
          {String((context.resultJson as { count: number }).count)}
        </output>
      ),
    });

    try {
      const html = renderToStaticMarkup(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitActionWidget value={widget} threadId="thread-1" />
        </AgentKitProvider>,
      );

      expect(html).toContain("priority inbox:3");
      expect(html).toContain("data-agent-native-custom-ui");
    } finally {
      unregister();
    }
  });

  it("preserves string results that contain JSON", async () => {
    const toolCall: AgentToolCall = {
      id: "tool-1",
      name: "preview-inbox",
      input: {},
      output: '{"status":"ok"}',
      status: "completed",
    };
    const widget: AgentWidget = {
      id: "tool-1:chat-ui",
      kind: "mail.inbox-preview",
      data: { toolCallId: toolCall.id, toolName: toolCall.name },
    };
    const client = new AgentKitClient({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        async getThreadSnapshot() {
          return {
            id: "thread-1",
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:00:00.000Z",
            messages: [],
            toolCalls: [toolCall],
          };
        },
      },
    });
    await client.loadThread("thread-1");
    const unregister = registerActionChatRenderer({
      id: "test.agentkit-action-widget-string-result",
      renderer: widget.kind,
      Component: ({ context }: ToolRendererProps) => (
        <output>
          {typeof context.resultJson}:{String(context.resultJson)}
        </output>
      ),
    });

    try {
      const html = renderToStaticMarkup(
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitActionWidget value={widget} threadId="thread-1" />
        </AgentKitProvider>,
      );

      expect(html).toContain("string:{&quot;status&quot;:&quot;ok&quot;}");
    } finally {
      unregister();
    }
  });

  it("renders persisted Forms and Analytics data widgets with their core UI", async () => {
    await Promise.all([
      import("../chat/widgets/DataInsightsWidget.js"),
      import("../chat/widgets/DataTableWidget.js"),
    ]);
    const formsTool: AgentToolCall = {
      id: "forms-response-insights",
      name: "response-insights",
      input: { displayMode: "insights" },
      output: createDataInsightsWidgetResult({
        widgetId: "forms.responseInsights.v1",
        title: "Form responses",
        summary: { responses: 3 },
        table: {
          title: "Responses by source",
          columns: [{ key: "source", label: "Source" }],
          rows: [{ source: "Webinar" }],
        },
      }),
      status: "completed",
    };
    const analyticsTool: AgentToolCall = {
      id: "analytics-query",
      name: "query-agent-native-analytics",
      input: { sql: "SELECT event_name FROM analytics_event_daily_rollups" },
      output: createDataTableWidgetResult({
        widgetId: "analytics.query.v1",
        title: "Analytics query result",
        table: {
          title: "Analytics query result",
          columns: [{ key: "event_name", label: "event_name" }],
          rows: [{ event_name: "checkout_completed" }],
        },
      }),
      status: "completed",
    };
    const formsWidget: AgentWidget = {
      id: `${formsTool.id}:chat-ui`,
      kind: ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
      title: "Form responses",
      data: { toolCallId: formsTool.id, toolName: formsTool.name },
    };
    const analyticsWidget: AgentWidget = {
      id: `${analyticsTool.id}:chat-ui`,
      kind: ACTION_CHAT_UI_DATA_TABLE_RENDERER,
      title: "Analytics query result",
      data: { toolCallId: analyticsTool.id, toolName: analyticsTool.name },
    };
    const client = new AgentKitClient({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        async getThreadSnapshot() {
          return {
            id: "thread-1",
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:00:00.000Z",
            messages: [],
            toolCalls: [formsTool, analyticsTool],
          };
        },
      } satisfies AgentTransport,
    });
    await client.loadThread("thread-1");

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider persistPreference={false}>
            <AgentKitProvider controller={client} threadId="thread-1">
              <>
                <AgentKitActionWidget value={formsWidget} threadId="thread-1" />
                <AgentKitActionWidget
                  value={analyticsWidget}
                  threadId="thread-1"
                />
              </>
            </AgentKitProvider>
          </AgentNativeI18nProvider>,
        );
      });

      expect(container.textContent).toContain("Responses by source");
      expect(container.textContent).toContain("Webinar");
      expect(container.textContent).toContain("checkout_completed");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("groups persisted change cards attached to the same assistant message", async () => {
    await import("../chat/widgets/RecordChangeWidget.js");
    const messageId = "assistant-message-1";
    const toolCalls: AgentToolCall[] = [
      {
        id: "draft-create",
        name: "manage-draft",
        input: { action: "create" },
        output: {
          change: {
            verb: "created",
            kind: "email-draft",
            title: "Launch notes",
            detail: "ana@example.test",
            url: "/_agent-native/open?composeDraftId=draft-1",
          },
        },
        status: "completed",
      },
      {
        id: "filter-create",
        name: "manage-gmail-filters",
        input: { action: "create" },
        output: {
          change: {
            verb: "created",
            kind: "gmail-filter",
            title: "from:agentkit-test@example.invalid",
            detail: "Skip inbox",
          },
        },
        status: "completed",
      },
    ];
    const widgets: AgentWidget[] = toolCalls.map((tool) => ({
      id: `${tool.id}:chat-ui`,
      kind: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
      data: { toolCallId: tool.id, toolName: tool.name },
    }));
    const client = new AgentKitClient({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        async getThreadSnapshot() {
          return {
            id: "thread-1",
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:00:00.000Z",
            messages: [],
            toolCalls,
            widgets: widgets.map((widget) => ({ messageId, widget })),
          };
        },
      } satisfies AgentTransport,
    });
    await client.loadThread("thread-1");

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider persistPreference={false}>
            <AgentKitProvider controller={client} threadId="thread-1">
              <>
                {widgets.map((widget) => (
                  <AgentKitActionWidget
                    key={widget.id}
                    value={widget}
                    threadId="thread-1"
                  />
                ))}
              </>
            </AgentKitProvider>
          </AgentNativeI18nProvider>,
        );
      });

      expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
      expect(container.textContent).toContain("2 changes");
      expect(container.textContent).toContain("Launch notes");
      expect(container.textContent).toContain(
        "from:agentkit-test@example.invalid",
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("shows a completed change when an earlier change is still running", async () => {
    await import("../chat/widgets/RecordChangeWidget.js");
    const messageId = "assistant-message-1";
    const toolCalls: AgentToolCall[] = [
      {
        id: "draft-create-running",
        name: "manage-draft",
        input: { action: "create" },
        status: "running",
      },
      {
        id: "filter-create-complete",
        name: "manage-gmail-filters",
        input: { action: "create" },
        output: {
          change: {
            verb: "created",
            kind: "gmail-filter",
            title: "from:agentkit-test@example.invalid",
            detail: "Skip inbox",
          },
        },
        status: "completed",
      },
    ];
    const widgets: AgentWidget[] = toolCalls.map((tool) => ({
      id: `${tool.id}:chat-ui`,
      kind: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
      data: { toolCallId: tool.id, toolName: tool.name },
    }));
    const client = new AgentKitClient({
      transport: {
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        async getThreadSnapshot() {
          return {
            id: "thread-1",
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:00:00.000Z",
            messages: [],
            toolCalls,
            widgets: widgets.map((widget) => ({ messageId, widget })),
          };
        },
      } satisfies AgentTransport,
    });
    await client.loadThread("thread-1");

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider persistPreference={false}>
            <AgentKitProvider controller={client} threadId="thread-1">
              {widgets.map((widget) => (
                <AgentKitActionWidget
                  key={widget.id}
                  value={widget}
                  threadId="thread-1"
                />
              ))}
            </AgentKitProvider>
          </AgentNativeI18nProvider>,
        );
      });

      expect(container.textContent).toContain(
        "from:agentkit-test@example.invalid",
      );
      expect(container.textContent).toContain("Skip inbox");
      expect(container.querySelector("[data-action-card]")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
