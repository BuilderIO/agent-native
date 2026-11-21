// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentKitActionWidget } from "../../chat/agentkit-chat/action-widget.js";
import { ToolCallDisplay } from "../../chat/chat/tool-call-display.js";
import { registerActionChatRenderer } from "../../chat/chat/tool-render-registry.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

const threadId = "thread-tool-chain";
const runId = "run-tool-chain";
const verdict = "Compatible with the formulation";
const payload = { verdict };
const toolId = "compatibility-call";
const renderer = "test.compatibility";
const toolName = "check-ingredient-compatibility";

function startTool(tool: string, id: string) {
  return { type: "tool_start", tool, id, input: {} };
}

function calls(tool: string, count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const id = `${tool}-${offset + index}`;
    return [startTool(tool, id), { type: "tool_done", tool, id, result: "{}" }];
  }).flat();
}

function metaCalls() {
  return [
    "tool-search",
    "db-schema",
    "docs-search",
    "framework-search",
    "resources",
  ].flatMap((tool) => calls(tool, 1));
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: AgentKitClient | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await client?.dispose();
  client = undefined;
  vi.useRealTimers();
  container.remove();
  vi.unstubAllGlobals();
});

async function openChat({ withToolSlot = false } = {}) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const transport = createAgentNativeAgentKitTransport({
    apiUrl: "/_agent-native/agent-chat",
    persistThreadSnapshots: false,
    fetch: async (input, init) => {
      const url = String(input);
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        return new Response(readable, {
          headers: { "content-type": "text/event-stream", "x-run-id": runId },
        });
      }
      if (url.endsWith("/agent-engine/status")) {
        return Response.json({ engine: "builder", chatEligible: true });
      }
      if (url.endsWith("/capabilities") || url.endsWith("/runs/active")) {
        return Response.json({ active: false, status: "idle" });
      }
      throw new Error(
        `Unexpected chat request ${init?.method ?? "GET"} ${url}`,
      );
    },
  });
  const controller = (client = new AgentKitClient({ transport }));
  await act(async () => {
    await controller.sendMessage({ threadId, text: "Check compatibility." });
    root.render(
      <AgentKitProvider
        controller={controller}
        threadId={threadId}
        slots={{
          widget: (props) => (
            <div data-widget-slot={props.value.id}>
              <AgentKitActionWidget {...props} />
            </div>
          ),
          ...(withToolSlot
            ? {
                tool: ({ value }) => (
                  <div data-tool-slot={value.id}>
                    <ToolCallDisplay
                      toolName={value.name}
                      toolCallId={value.id}
                      args={{}}
                      argsText="{}"
                      result={
                        typeof value.output === "string"
                          ? value.output
                          : JSON.stringify(value.output)
                      }
                      status={value.status}
                      isRunning={value.status === "running"}
                      chatUI={value.metadata?.chatUI as never}
                    />
                  </div>
                ),
              }
            : {}),
        }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
  });
  let seq = 0;
  return {
    controller,
    async send(...events: Record<string, unknown>[]) {
      await act(async () => {
        await writer.write(
          encoder.encode(
            events
              .map(
                (event) =>
                  `data: ${JSON.stringify({ ...event, seq: ++seq })}\n\n`,
              )
              .join(""),
          ),
        );
        const last = events[events.length - 1];
        const expected =
          last.type === "tool_start"
            ? "running"
            : last.type === "tool_done"
              ? "completed"
              : undefined;
        if (!expected) return;
        const id = String(last.id);
        await vi.waitFor(() => {
          const { tools } = controller.getThread(threadId);
          if (!(id in tools) || tools[id].status !== expected) {
            throw new Error(`Tool ${id} is not ${expected} yet`);
          }
        });
      });
    },
    async stop() {
      await act(async () => writer.close());
    },
  };
}

function summary() {
  return Array.from(
    container.querySelectorAll(".agentkit-activities-summary"),
  ).at(-1);
}

function count() {
  return summary()?.querySelector('[title="Tool calls"]')?.lastChild
    ?.textContent;
}

it("advances the visible tool count while consecutive calls have the same label", async () => {
  const { controller, send } = await openChat();
  await send(...calls("get-audit-event", 40));
  expect(summary()?.textContent).toContain("Get audit event");
  await send(...metaCalls());
  expect(summary()?.textContent).toContain("Resources");
  await send(startTool("db-query", "query-first"));
  expect(summary()?.textContent).toContain("Db query");

  expect.soft(count()).toBe("46");
  await send(
    { type: "tool_done", tool: "db-query", id: "query-first", result: "{}" },
    ...calls("db-query", 12),
    startTool("db-query", "query-next"),
  );
  expect(controller.getThread(threadId).tools["query-next"]).toMatchObject({
    status: "running",
  });
  expect(summary()?.textContent).toContain("Db query");
  expect(count()).toBe("59");
});

it("counts only the calls since the user's message reached the run", async () => {
  const { send } = await openChat();
  await send(...calls("db-query", 3));
  await send({
    type: "user_message",
    message: {
      id: "steer-1",
      text: "Check the archive too.",
      createdAt: "2026-11-21T00:00:00.000Z",
    },
    continuationMessageId: `${runId}:after:steer-1`,
  });
  await send(startTool("db-query", "query-after-steer"));
  expect(summary()?.textContent).toContain("Db query");
  expect(count()).toBe("1");
});

it.each([
  {
    card: "an unregistered card",
    metadata: { chatUI: { renderer: "test.unregistered" } },
  },
  {
    card: "a card with an MCP app",
    metadata: {
      chatUI: { renderer },
      mcpApp: {
        serverId: "lab",
        toolName,
        originalToolName: "check_ingredient_compatibility",
        resourceUri: "ui://lab/compatibility",
        toolInput: {},
        toolResult: payload,
      },
    },
  },
])("leaves $card to the host's tool slot", async ({ metadata }) => {
  const unregister = registerActionChatRenderer({
    id: renderer,
    renderer,
    Component: () => <p data-verdict-card>{verdict}</p>,
  });
  try {
    const { controller, send } = await openChat({ withToolSlot: true });
    await send(startTool(toolName, toolId), {
      type: "tool_done",
      id: toolId,
      tool: toolName,
      result: JSON.stringify(payload),
      chatUIResult: payload,
      ...metadata,
    });
    await act(async () => {
      await vi.waitFor(() => {
        if (!(`${toolId}:chat-ui` in controller.getThread(threadId).widgets)) {
          throw new Error("The card's widget has not arrived yet");
        }
      });
    });
    expect(
      container.querySelector(`[data-tool-slot="${toolId}"]`)?.textContent,
    ).toMatch(/\S/);
    expect(container.querySelector("[data-widget-slot]")).toBeNull();
  } finally {
    unregister();
  }
});

it.each([
  { projection: undefined, withToolSlot: true },
  { projection: payload, withToolSlot: true },
  { projection: payload, withToolSlot: false },
  { projection: verdict, withToolSlot: true },
])(
  "preserves a completed verdict during later calls (projection=$projection, tool slot=$withToolSlot)",
  async ({ projection, withToolSlot }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const showCard = projection !== undefined;
    const unregister = registerActionChatRenderer({
      id: renderer,
      renderer,
      Component: ({ context }) => (
        <p data-verdict-card>
          {typeof context.resultJson === "string"
            ? context.resultJson
            : (context.resultJson as typeof payload | null)?.verdict}
        </p>
      ),
    });
    try {
      const { controller, send, stop } = await openChat({ withToolSlot });
      await send(
        ...calls("get-audit-event", 40),
        ...metaCalls(),
        ...calls("db-query", 20),
      );
      await send(startTool(toolName, toolId), {
        type: "tool_done",
        id: toolId,
        tool: toolName,
        result: JSON.stringify(payload),
        ...(showCard ? { chatUI: { renderer }, chatUIResult: projection } : {}),
      });
      expect(controller.getThread(threadId).tools[toolId]).toMatchObject({
        status: "completed",
        output: projection ?? JSON.stringify(payload),
      });
      await act(async () => {
        await vi.waitFor(() => {
          const { widgets, widgetMessageIds } = controller.getThread(threadId);
          const widgetId = `${toolId}:chat-ui`;
          expect(widgetId in widgets ? widgets[widgetId].kind : null).toBe(
            showCard ? renderer : null,
          );
          expect(widgetId in widgetMessageIds).toBe(false);
        });
      });
      expect(
        container.querySelector("[data-verdict-card]")?.textContent ?? null,
      ).toBe(showCard ? verdict : null);

      vi.setSystemTime(Date.now() + 120_000);
      await send(
        ...calls("db-query", 34, 20),
        startTool("db-query", "query-last"),
      );
      expect(controller.getThread(threadId).runs[runId]).toMatchObject({
        status: "running",
      });
      expect(summary()?.textContent).toContain("Db query");
      expect(
        container.querySelector("[data-verdict-card]")?.textContent ?? null,
      ).toBe(showCard ? verdict : null);

      await send({ type: "done", reason: "user" });
      await stop();
      expect(controller.getThread(threadId).runs[runId]).toMatchObject({
        status: "cancelled",
      });
      expect(container.querySelectorAll("[data-verdict-card]")).toHaveLength(
        showCard ? 1 : 0,
      );
    } finally {
      unregister();
    }
  },
);
