// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_NATIVE_HOST_MESSAGE_TYPES,
  type AgentNativeHostMessageType,
} from "./host-bridge.js";
import {
  AGENT_NATIVE_HOST_TOOL_NAMES,
  createAgentNativeHostTools,
} from "./host-tools.js";

function dispatchFromHost(
  source: Window,
  origin: string,
  data: Record<string, unknown>,
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin,
      source,
    }),
  );
}

function hostWindow(
  respond: (
    message: Record<string, unknown>,
  ) => Record<string, unknown> | undefined,
) {
  const sent: Array<{
    message: Record<string, unknown>;
    targetOrigin: string;
  }> = [];
  const host = {
    postMessage: vi.fn(
      (message: Record<string, unknown>, targetOrigin: string) => {
        sent.push({ message, targetOrigin });
        const response = respond(message);
        if (!response) return;
        setTimeout(() => {
          dispatchFromHost(host as unknown as Window, "https://host.example", {
            requestId: message.requestId,
            ...response,
          });
        }, 0);
      },
    ),
  } as unknown as Window;
  return { host, sent };
}

function responseType(
  type: AgentNativeHostMessageType,
): AgentNativeHostMessageType {
  switch (type) {
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.CONTEXT;
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTIONS;
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT;
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT;
    default:
      throw new Error(`Unexpected request type: ${type}`);
  }
}

describe("createAgentNativeHostTools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns plain tool descriptors with execute functions", () => {
    const tools = createAgentNativeHostTools();

    expect(Object.keys(tools)).toEqual([
      AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen,
      AGENT_NATIVE_HOST_TOOL_NAMES.listHostActions,
      AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction,
      AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand,
    ]);
    expect(tools[AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen]).toMatchObject({
      name: AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen,
      parameters: { type: "object", properties: {} },
    });
    expect(
      tools[AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction].parameters.required,
    ).toEqual(["name"]);
    expect(
      typeof tools[AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand].execute,
    ).toBe("function");
  });

  it("delegates context, action, and command tools to the host bridge", async () => {
    const { host, sent } = hostWindow((message) => {
      const type = message.type as AgentNativeHostMessageType;
      if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT) {
        return {
          type: responseType(type),
          ok: true,
          context: {
            route: { name: "customer-detail" },
            resource: { type: "customer", id: "acme" },
          },
        };
      }
      if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS) {
        return {
          type: responseType(type),
          ok: true,
          actions: [
            {
              name: "select-row",
              description: "Select a visible row",
              schema: {
                type: "object",
                properties: { rowId: { type: "string" } },
              },
            },
          ],
        };
      }
      if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION) {
        return {
          type: responseType(type),
          ok: true,
          result: { selected: (message.args as { rowId?: string }).rowId },
        };
      }
      if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND) {
        return {
          type: responseType(type),
          ok: true,
          result: {
            command: message.command,
            payload: message.payload,
          },
        };
      }
    });

    const tools = createAgentNativeHostTools({
      targetWindow: host,
      targetOrigin: "https://host.example",
      hostOrigin: "https://host.example",
    });

    await expect(
      tools[AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen].execute(),
    ).resolves.toMatchObject({
      route: { name: "customer-detail" },
      resource: { type: "customer", id: "acme" },
    });

    await expect(
      tools[AGENT_NATIVE_HOST_TOOL_NAMES.listHostActions].execute(),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "select-row",
        description: "Select a visible row",
      }),
    ]);

    await expect(
      tools[AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction].execute({
        name: "select-row",
        args: { rowId: "row-1" },
      }),
    ).resolves.toEqual({ selected: "row-1" });

    await expect(
      tools[AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand].execute({
        payload: { queryKey: ["customers"] },
      }),
    ).resolves.toEqual({
      command: "refreshData",
      payload: { queryKey: ["customers"] },
    });

    expect(sent.map(({ message }) => message)).toEqual([
      expect.objectContaining({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT,
      }),
      expect.objectContaining({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS,
      }),
      expect.objectContaining({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION,
        name: "select-row",
        args: { rowId: "row-1" },
      }),
      expect.objectContaining({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND,
        command: "refreshData",
        payload: { queryKey: ["customers"] },
      }),
    ]);
    expect(
      sent.every(({ targetOrigin }) => targetOrigin === "https://host.example"),
    ).toBe(true);
  });

  it("validates required host action input before posting", async () => {
    const { host } = hostWindow(() => undefined);
    const tools = createAgentNativeHostTools({
      targetWindow: host,
      hostOrigin: "https://host.example",
    });

    await expect(
      tools[AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction].execute({ name: "" }),
    ).rejects.toThrow("run-host-action requires a non-empty name");
    expect(host.postMessage).not.toHaveBeenCalled();
  });
});
