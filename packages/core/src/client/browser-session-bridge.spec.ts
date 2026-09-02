// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentNativeBrowserSessionBridge } from "./browser-session-bridge.js";
import {
  AGENT_NATIVE_HOST_MESSAGE_TYPES,
  type AgentNativeHostMessageType,
} from "./host-bridge.js";

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
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_WEBMCP_TOOLS:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.WEBMCP_TOOLS;
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_WEBMCP_TOOL:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.WEBMCP_TOOL_RESULT;
    case AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND:
      return AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT;
    default:
      throw new Error(`Unexpected request type: ${type}`);
  }
}

function hostWindow() {
  const sent: Record<string, unknown>[] = [];
  const host = {
    postMessage: vi.fn(
      (message: Record<string, unknown>, _targetOrigin: string) => {
        sent.push(message);
        const type = message.type as AgentNativeHostMessageType;
        let response: Record<string, unknown> | undefined;
        if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT) {
          response = {
            type: responseType(type),
            ok: true,
            context: {
              url: "https://app.example/customers/acme",
              session: {
                id: "tab-1",
                label: "Customer detail",
                connectedAt: "2026-01-01T00:00:00.000Z",
              },
              route: { name: "customer-detail" },
              resource: { type: "customer", id: "acme" },
            },
          };
        } else if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS) {
          response = {
            type: responseType(type),
            ok: true,
            actions: [
              {
                name: "select-row",
                description: "Select a visible row",
                schema: { type: "object" },
              },
            ],
          };
        } else if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION) {
          response = {
            type: responseType(type),
            ok: true,
            result: { selected: (message.args as { rowId?: string }).rowId },
          };
        } else if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_WEBMCP_TOOLS) {
          response = {
            type: responseType(type),
            ok: true,
            tools: [
              {
                name: "get-order",
                description: "Read an order",
                origin: "https://shop.example",
                inputSchema: { type: "object" },
              },
            ],
          };
        } else if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_WEBMCP_TOOL) {
          response = {
            type: responseType(type),
            ok: true,
            result: { status: "shipped" },
          };
        } else if (type === AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND) {
          response = {
            type: responseType(type),
            ok: true,
            result: { command: message.command, payload: message.payload },
          };
        }
        if (!response) return;
        setTimeout(() => {
          dispatchFromHost(host as unknown as Window, "https://app.example", {
            requestId: message.requestId,
            ...response,
          });
        }, 0);
      },
    ),
  } as unknown as Window;
  return { host, sent };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("createAgentNativeBrowserSessionBridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers host context and actions with the server", async () => {
    const { host } = hostWindow();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/_agent-native/browser-sessions");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        sessionId: "tab-1",
        session: { id: "tab-1", label: "Customer detail" },
        context: {
          route: { name: "customer-detail" },
          resource: { type: "customer", id: "acme" },
        },
        actions: [{ name: "select-row" }],
      });
      return jsonResponse({
        ok: true,
        session: {
          sessionId: "tab-1",
          session: body.session,
          actions: body.actions,
          active: true,
        },
      });
    });

    const bridge = createAgentNativeBrowserSessionBridge({
      targetWindow: host,
      hostOrigin: "https://app.example",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(bridge.refreshRegistration()).resolves.toMatchObject({
      sessionId: "tab-1",
      active: true,
    });
    expect(bridge.sessionId).toBe("tab-1");
  });

  it("claims a server request, executes it in the host, and completes it", async () => {
    const { host } = hostWindow();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/_agent-native/browser-sessions" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({
          ok: true,
          session: {
            sessionId: body.sessionId,
            session: body.session,
            active: true,
            actions: body.actions,
          },
        });
      }
      if (
        url === "/_agent-native/browser-sessions/tab-1/requests/claim" &&
        method === "POST"
      ) {
        return jsonResponse({
          ok: true,
          request: {
            id: "req-1",
            sessionId: "tab-1",
            type: "run-action",
            name: "select-row",
            args: { rowId: "row-1" },
            status: "claimed",
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000,
          },
        });
      }
      if (
        url ===
          "/_agent-native/browser-sessions/tab-1/requests/req-1/complete" &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ ok: true, result: { selected: "row-1" } });
        return jsonResponse({ ok: true, request: { id: "req-1" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });

    const bridge = createAgentNativeBrowserSessionBridge({
      targetWindow: host,
      hostOrigin: "https://app.example",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const claimed = await bridge.claimOnce();
    expect(claimed).toMatchObject({ id: "req-1", name: "select-row" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("registers direct embedded context and actions without postMessage", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/_agent-native/browser-sessions");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        sessionId: "embedded-tab",
        session: { id: "embedded-tab", label: "Embedded app" },
        context: {
          route: { name: "builder-editor" },
          resource: { type: "content", id: "content-1" },
        },
        actions: [
          {
            name: "focus-symbol",
            source: "client",
            availability: "browser-session",
          },
        ],
      });
      return jsonResponse({
        ok: true,
        session: {
          sessionId: "embedded-tab",
          session: body.session,
          actions: body.actions,
          active: true,
        },
      });
    });

    const bridge = createAgentNativeBrowserSessionBridge({
      session: { id: "embedded-tab", label: "Embedded app" },
      getContext: () => ({
        route: { name: "builder-editor" },
        resource: { type: "content", id: "content-1" },
      }),
      actions: [
        {
          name: "focus-symbol",
          description: "Focus a symbol in the editor",
          schema: { type: "object" },
          run: () => ({ focused: true }),
        },
      ],
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(bridge.refreshRegistration()).resolves.toMatchObject({
      sessionId: "embedded-tab",
      active: true,
    });
  });

  it("keeps session registration alive when WebMCP discovery fails", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/_agent-native/browser-sessions");
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty("webmcpTools");
      return jsonResponse({
        ok: true,
        session: {
          sessionId: body.sessionId,
          session: body.session,
          actions: body.actions,
          active: true,
        },
      });
    });
    const webmcp = {
      supported: true,
      listTools: vi.fn(async () => {
        throw new Error("WebMCP temporarily unavailable");
      }),
      executeTool: vi.fn(async () => ""),
      executeListedTool: vi.fn(async () => ""),
    };

    const bridge = createAgentNativeBrowserSessionBridge({
      sessionId: "embedded-tab",
      session: { id: "embedded-tab" },
      getContext: () => ({ route: { name: "builder-editor" } }),
      webmcp,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(bridge.refreshRegistration()).resolves.toMatchObject({
      sessionId: "embedded-tab",
      active: true,
    });
    expect(webmcp.listTools).toHaveBeenCalledOnce();
  });

  it("preserves the last WebMCP manifest during a transient failure", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return jsonResponse({
        ok: true,
        session: {
          sessionId: body.sessionId,
          session: body.session,
          actions: body.actions,
          webmcpTools: body.webmcpTools,
          active: true,
        },
      });
    });
    const webmcp = {
      supported: true,
      listTools: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: "get-order",
            description: "Read an order",
            inputSchema: { type: "object" },
            origin: "https://shop.example",
          },
        ])
        .mockRejectedValueOnce(new Error("WebMCP temporarily unavailable")),
      executeTool: vi.fn(async () => ""),
      executeListedTool: vi.fn(async () => ""),
    };
    const bridge = createAgentNativeBrowserSessionBridge({
      session: { id: "embedded-tab" },
      getContext: () => ({ route: { name: "builder-editor" } }),
      webmcp,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await bridge.refreshRegistration();
    await bridge.refreshRegistration();

    expect(bodies[1].webmcpTools).toEqual(bodies[0].webmcpTools);
  });

  it("claims a server request and executes a direct embedded action", async () => {
    const refresh = vi.fn(async () => ({ refreshed: true }));
    const action = vi.fn(async (_args, runtime) => {
      await runtime.refresh({ scope: "content" });
      return {
        resourceId: runtime.context.resource?.id,
        sessionId: runtime.session.id,
      };
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/_agent-native/browser-sessions" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({
          ok: true,
          session: {
            sessionId: body.sessionId,
            session: body.session,
            active: true,
            actions: body.actions,
          },
        });
      }
      if (
        url === "/_agent-native/browser-sessions/embedded-tab/requests/claim" &&
        method === "POST"
      ) {
        return jsonResponse({
          ok: true,
          request: {
            id: "req-embedded",
            sessionId: "embedded-tab",
            type: "run-action",
            name: "focus-symbol",
            args: { symbolId: "hero" },
            status: "claimed",
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000,
          },
        });
      }
      if (
        url ===
          "/_agent-native/browser-sessions/embedded-tab/requests/req-embedded/complete" &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          ok: true,
          result: { resourceId: "content-1", sessionId: "embedded-tab" },
        });
        return jsonResponse({ ok: true, request: { id: "req-embedded" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });

    const bridge = createAgentNativeBrowserSessionBridge({
      session: { id: "embedded-tab", label: "Embedded app" },
      getContext: () => ({
        resource: { type: "content", id: "content-1" },
      }),
      actions: [
        {
          name: "focus-symbol",
          description: "Focus a symbol in the editor",
          schema: { type: "object" },
          run: action,
        },
      ],
      commands: { refreshData: refresh },
      fetch: fetchMock as unknown as typeof fetch,
    });

    const claimed = await bridge.claimOnce();
    expect(claimed).toMatchObject({ id: "req-embedded" });
    expect(action).toHaveBeenCalledWith(
      { symbolId: "hero" },
      expect.objectContaining({
        origin: "agent-native-embedded",
        requestId: "req-embedded",
      }),
    );
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "refreshData",
        payload: { scope: "content" },
      }),
      undefined,
    );
  });

  it("executes the descriptor from the live direct WebMCP listing", async () => {
    const tool = {
      name: "get-order",
      description: "Read an order",
      origin: "https://shop.example",
      inputSchema: { type: "object" },
    };
    const listTools = vi.fn(async () => [tool]);
    const executeTool = vi.fn(async () => {
      throw new Error("stale executeTool path");
    });
    const executeListedTool = vi.fn(async () => ({ status: "shipped" }));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (
        url === "/_agent-native/browser-sessions/embedded-tab/requests/claim" &&
        method === "POST"
      ) {
        return jsonResponse({
          ok: true,
          request: {
            id: "req-webmcp",
            sessionId: "embedded-tab",
            type: "run-webmcp-tool",
            name: "get-order",
            origin: "https://shop.example",
            args: { id: "order-1" },
            status: "claimed",
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000,
          },
        });
      }
      if (
        url ===
          "/_agent-native/browser-sessions/embedded-tab/requests/req-webmcp/complete" &&
        method === "POST"
      ) {
        expect(JSON.parse(String(init?.body))).toEqual({
          ok: true,
          result: { status: "shipped" },
        });
        return jsonResponse({ ok: true, request: { id: "req-webmcp" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });

    const bridge = createAgentNativeBrowserSessionBridge({
      sessionId: "embedded-tab",
      session: { id: "embedded-tab" },
      webmcp: {
        supported: true,
        listTools,
        executeTool,
        executeListedTool,
      },
      fetch: fetchMock as unknown as typeof fetch,
    });

    await bridge.claimOnce();

    expect(listTools).toHaveBeenCalledOnce();
    expect(executeListedTool).toHaveBeenCalledWith(tool, {
      id: "order-1",
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("routes host WebMCP through the host bridge with mixed direct options", async () => {
    const { host } = hostWindow();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/_agent-native/browser-sessions" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        expect(body.webmcpTools).toEqual([
          expect.objectContaining({
            name: "get-order",
            inputSchema: { type: "object" },
          }),
        ]);
        return jsonResponse({
          ok: true,
          session: {
            sessionId: body.sessionId,
            session: body.session,
            active: true,
            actions: body.actions,
            webmcpTools: body.webmcpTools,
          },
        });
      }
      if (
        url === "/_agent-native/browser-sessions/mixed-tab/requests/claim" &&
        method === "POST"
      ) {
        return jsonResponse({
          ok: true,
          request: {
            id: "req-webmcp",
            sessionId: "mixed-tab",
            type: "run-webmcp-tool",
            name: "get-order",
            origin: "https://shop.example",
            args: { id: "order-1" },
            status: "claimed",
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000,
          },
        });
      }
      if (
        url ===
          "/_agent-native/browser-sessions/mixed-tab/requests/req-webmcp/complete" &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          ok: true,
          result: { status: "shipped" },
        });
        return jsonResponse({ ok: true, request: { id: "req-webmcp" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });

    const bridge = createAgentNativeBrowserSessionBridge({
      targetWindow: host,
      hostOrigin: "https://app.example",
      webmcp: "host",
      session: { id: "mixed-tab" },
      getContext: () => ({ route: { name: "orders" } }),
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(bridge.claimOnce()).resolves.toMatchObject({
      id: "req-webmcp",
    });
  });
});
