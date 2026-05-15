// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_NATIVE_HOST_MESSAGE_TYPES,
  announceAgentNativeFrameReady,
  createAgentNativeHostBridge,
  requestAgentNativeHostContext,
  sendAgentNativeHostCommand,
} from "./host-bridge.js";

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function targetWindow() {
  const sent: Array<{ message: unknown; targetOrigin: string }> = [];
  return {
    sent,
    win: {
      postMessage: vi.fn((message: unknown, targetOrigin: string) => {
        sent.push({ message, targetOrigin });
      }),
    } as unknown as Window,
  };
}

function dispatchFromAgent(
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

describe("createAgentNativeHostBridge", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/customers/acme?tab=activity#top");
    document.title = "Acme";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responds to context requests with default and custom page context", async () => {
    const target = targetWindow();
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
      getContext: () => ({
        route: { name: "customer-detail", params: { id: "acme" } },
        resource: { type: "customer", id: "acme" },
      }),
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT,
      requestId: "ctx-1",
    });
    await nextTick();

    expect(target.sent).toHaveLength(1);
    expect(target.sent[0].targetOrigin).toBe("https://agent.example");
    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.CONTEXT,
      ok: true,
      requestId: "ctx-1",
      context: {
        title: "Acme",
        route: {
          pathname: "/customers/acme",
          search: "?tab=activity",
          hash: "#top",
          name: "customer-detail",
          params: { id: "acme" },
        },
        resource: { type: "customer", id: "acme" },
      },
    });

    bridge.stop();
  });

  it("sends init with auth after the iframe announces readiness", async () => {
    const target = targetWindow();
    const events: string[] = [];
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example/app",
      auth: () => ({
        token: "secret-token",
        headers: { Authorization: "Bearer secret-token" },
      }),
      onEvent: (event) => events.push(event.type),
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.READY,
      requestId: "ready-1",
    });
    await nextTick();

    expect(events).toEqual(["ready", "init"]);
    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.INIT,
      requestId: "ready-1",
      auth: {
        token: "secret-token",
        headers: { Authorization: "Bearer secret-token" },
      },
    });

    bridge.stop();
  });

  it("executes registered host commands and returns results", async () => {
    const target = targetWindow();
    const handler = vi.fn(() => ({ refreshed: true }));
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
      commands: { refreshData: handler },
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND,
      requestId: "cmd-1",
      command: "refreshData",
      payload: { table: "customers" },
    });
    await nextTick();

    expect(handler).toHaveBeenCalledWith(
      {
        command: "refreshData",
        payload: { table: "customers" },
        requestId: "cmd-1",
        origin: "https://agent.example",
      },
      expect.any(MessageEvent),
    );
    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT,
      ok: true,
      requestId: "cmd-1",
      result: { refreshed: true },
    });

    bridge.stop();
  });

  it("ignores messages from untrusted origins", async () => {
    const target = targetWindow();
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
    }).start();

    dispatchFromAgent(target.win, "https://evil.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.GET_CONTEXT,
      requestId: "ctx-evil",
    });
    await nextTick();

    expect(target.sent).toHaveLength(0);
    bridge.stop();
  });
});

describe("iframe-side host helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announces readiness to the host window", () => {
    const target = targetWindow();

    announceAgentNativeFrameReady({
      targetWindow: target.win,
      targetOrigin: "https://host.example",
    });

    expect(target.sent[0]).toMatchObject({
      targetOrigin: "https://host.example",
      message: { type: AGENT_NATIVE_HOST_MESSAGE_TYPES.READY },
    });
  });

  it("requests host context and resolves the matching response", async () => {
    const host = {
      postMessage: vi.fn((message: Record<string, unknown>) => {
        setTimeout(() => {
          dispatchFromAgent(host as unknown as Window, "https://host.example", {
            type: AGENT_NATIVE_HOST_MESSAGE_TYPES.CONTEXT,
            requestId: message.requestId,
            ok: true,
            context: { resource: { type: "page", id: "home" } },
          });
        }, 0);
      }),
    } as unknown as Window;

    const context = await requestAgentNativeHostContext({
      targetWindow: host,
      targetOrigin: "https://host.example",
      hostOrigin: "https://host.example",
    });

    expect(context.resource).toEqual({ type: "page", id: "home" });
  });

  it("sends host commands and resolves command results", async () => {
    const host = {
      postMessage: vi.fn((message: Record<string, unknown>) => {
        setTimeout(() => {
          dispatchFromAgent(host as unknown as Window, "https://host.example", {
            type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND_RESULT,
            requestId: message.requestId,
            ok: true,
            result: { ok: true },
          });
        }, 0);
      }),
    } as unknown as Window;

    const result = await sendAgentNativeHostCommand(
      "remountView",
      {
        scope: "content",
      },
      {
        targetWindow: host,
        targetOrigin: "https://host.example",
        hostOrigin: "https://host.example",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.COMMAND,
        command: "remountView",
        payload: { scope: "content" },
      }),
      "https://host.example",
    );
  });
});
