// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit";
import type {
  AgentToolCall,
  AgentTransport,
  AgentWidget,
} from "@agent-native/agentkit/protocol";
import { AgentKitProvider } from "@agent-native/agentkit/react/context";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
} from "../../action-ui.js";
import {
  createDataInsightsWidgetResult,
  createDataTableWidgetResult,
} from "../../data-widgets/index.js";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "../chat/tool-render-registry.js";
import { AgentNativeI18nProvider } from "../i18n.js";
import { AgentKitActionWidget } from "./action-widget.js";

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
});
