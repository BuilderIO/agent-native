// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetHostHardReloadCooldownForTests,
  AGENT_NATIVE_HOST_MESSAGE_TYPES,
  announceAgentNativeFrameReady,
  createAgentNativeHostBridge,
  defaultAgentNativeHostCommands,
  readAgentNativeScreenContext,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
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
      session: { id: "tab-1", label: "Customer tab" },
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
      session: expect.objectContaining({
        id: "tab-1",
        label: "Customer tab",
      }),
      context: expect.objectContaining({
        session: expect.objectContaining({ id: "tab-1" }),
      }),
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

  it("lists live browser-session actions without exposing run functions", async () => {
    const target = targetWindow();
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
      actions: [
        {
          name: "publish-content",
          description: "Publish the selected content entry",
          schema: {
            type: "object",
            properties: { contentId: { type: "string" } },
            required: ["contentId"],
          },
          run: () => ({ ok: true }),
        },
      ],
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS,
      requestId: "actions-1",
    });
    await nextTick();

    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTIONS,
      ok: true,
      requestId: "actions-1",
      actions: [
        {
          name: "publish-content",
          description: "Publish the selected content entry",
          source: "client",
          availability: "browser-session",
        },
      ],
    });
    expect(JSON.stringify(target.sent[0].message)).not.toContain("run");

    bridge.stop();
  });

  it("runs live client actions with args and current host context", async () => {
    const target = targetWindow();
    const run = vi.fn(({ contentId }, runtime) => ({
      published: contentId,
      route: runtime.context.route?.name,
    }));
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
      getContext: () => ({ route: { name: "content-entry" } }),
      actions: [
        {
          name: "publish-content",
          description: "Publish content",
          run,
        },
      ],
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION,
      requestId: "action-1",
      name: "publish-content",
      args: { contentId: "content-123" },
    });
    await nextTick();

    expect(run).toHaveBeenCalledWith(
      { contentId: "content-123" },
      expect.objectContaining({
        requestId: "action-1",
        origin: "https://agent.example",
        context: expect.objectContaining({
          route: expect.objectContaining({ name: "content-entry" }),
        }),
      }),
    );
    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
      ok: true,
      requestId: "action-1",
      result: { published: "content-123", route: "content-entry" },
    });

    bridge.stop();
  });

  it("requires host approval before running destructive client actions", async () => {
    const target = targetWindow();
    const run = vi.fn(() => ({ deleted: true }));
    const requestApproval = vi.fn(() => ({ approved: true }));
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
      session: "tab-approval",
      commands: { requestApproval },
      actions: [
        {
          name: "delete-content",
          description: "Delete content",
          destructive: true,
          approval: { title: "Delete content?", risk: "high" },
          run,
        },
      ],
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION,
      requestId: "action-approval",
      name: "delete-content",
      args: { contentId: "content-123" },
    });
    await nextTick();

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "requestApproval",
        payload: expect.objectContaining({
          args: { contentId: "content-123" },
          session: expect.objectContaining({ id: "tab-approval" }),
          approval: { title: "Delete content?", risk: "high" },
        }),
      }),
      expect.any(MessageEvent),
    );
    expect(run).toHaveBeenCalledOnce();
    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
      ok: true,
      result: { deleted: true },
    });

    bridge.stop();
  });

  it("blocks destructive client actions when approval is denied", async () => {
    const target = targetWindow();
    const run = vi.fn(() => ({ deleted: true }));
    const bridge = createAgentNativeHostBridge({
      targetWindow: target.win,
      agentOrigin: "https://agent.example",
      commands: { requestApproval: () => ({ approved: false }) },
      actions: [
        {
          name: "delete-content",
          description: "Delete content",
          destructive: true,
          run,
        },
      ],
    }).start();

    dispatchFromAgent(target.win, "https://agent.example", {
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION,
      requestId: "action-denied",
      name: "delete-content",
      args: { contentId: "content-123" },
    });
    await nextTick();

    expect(run).not.toHaveBeenCalled();
    expect(target.sent[0].message).toMatchObject({
      type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
      ok: false,
      requestId: "action-denied",
      error: 'Client action "delete-content" was not approved',
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

  it("requests host actions and runs a host action", async () => {
    const host = {
      postMessage: vi.fn((message: Record<string, unknown>) => {
        setTimeout(() => {
          if (message.type === AGENT_NATIVE_HOST_MESSAGE_TYPES.LIST_ACTIONS) {
            dispatchFromAgent(
              host as unknown as Window,
              "https://host.example",
              {
                type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTIONS,
                requestId: message.requestId,
                ok: true,
                actions: [{ name: "select-row", description: "Select a row" }],
              },
            );
          } else {
            dispatchFromAgent(
              host as unknown as Window,
              "https://host.example",
              {
                type: AGENT_NATIVE_HOST_MESSAGE_TYPES.ACTION_RESULT,
                requestId: message.requestId,
                ok: true,
                result: { selected: "row-1" },
              },
            );
          }
        }, 0);
      }),
    } as unknown as Window;

    const actions = await requestAgentNativeHostActions({
      targetWindow: host,
      targetOrigin: "https://host.example",
      hostOrigin: "https://host.example",
    });
    const result = await runAgentNativeHostAction(
      "select-row",
      { rowId: "row-1" },
      {
        targetWindow: host,
        targetOrigin: "https://host.example",
        hostOrigin: "https://host.example",
      },
    );

    expect(actions).toEqual([
      { name: "select-row", description: "Select a row" },
    ]);
    expect(result).toEqual({ selected: "row-1" });
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AGENT_NATIVE_HOST_MESSAGE_TYPES.RUN_ACTION,
        name: "select-row",
        args: { rowId: "row-1" },
      }),
      "https://host.example",
    );
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

describe("readAgentNativeScreenContext", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard?range=7d");
    document.title = "Dashboard";
    document.body.innerHTML =
      '<main><h1>Revenue</h1><button data-secret="hidden">Refresh</button></main>';
  });

  it("returns route, visible text, viewport, and optional html", () => {
    const context = readAgentNativeScreenContext({
      includeDomHtml: true,
      maxTextLength: 20,
      maxHtmlLength: 80,
    });

    expect(context.route).toMatchObject({
      pathname: "/dashboard",
      search: "?range=7d",
    });
    expect(context.screen).toMatchObject({
      title: "Dashboard",
      visibleText: "Revenue Refresh",
      viewport: expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    });
    expect(context.screen?.html).toContain("<body>");
  });
});

describe("defaultAgentNativeHostCommands hard-reload cooldown", () => {
  const commandRequest = (command: string) => ({
    command,
    origin: "https://host.example",
  });
  const fakeEvent = new MessageEvent("message");

  beforeEach(() => {
    _resetHostHardReloadCooldownForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockReload() {
    const reload = vi.fn();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: reload,
    });
    return reload;
  }

  it("reloads on the first command and swallows repeats inside the cooldown", async () => {
    const reload = mockReload();

    expect(
      defaultAgentNativeHostCommands.hardReload?.(
        commandRequest("hardReload"),
        fakeEvent,
      ),
    ).toEqual({ reloading: true });
    // Both command aliases share a single guard.
    expect(
      defaultAgentNativeHostCommands["hard-reload"]?.(
        commandRequest("hard-reload"),
        fakeEvent,
      ),
    ).toEqual({ reloading: true });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the cooldown has elapsed", async () => {
    const reload = mockReload();

    await defaultAgentNativeHostCommands.hardReload?.(
      commandRequest("hardReload"),
      fakeEvent,
    );
    vi.advanceTimersByTime(2_100);
    await defaultAgentNativeHostCommands.hardReload?.(
      commandRequest("hardReload"),
      fakeEvent,
    );

    expect(reload).toHaveBeenCalledTimes(2);
  });
});
