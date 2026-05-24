// @vitest-environment happy-dom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES,
  _resetMcpAppHostForTests,
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  sendMcpAppHostMessage,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "./mcp-app-host.js";
import { _resetEmbedAuthForTests } from "./embed-auth.js";

function setParent(parent: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
}

function setDirectParent(parent: Window): void {
  setParent(parent);
  window.history.replaceState(
    null,
    "",
    "/?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1",
  );
  _resetMcpAppHostForTests();
}

function setNestedParent(parent: Window): void {
  setParent(parent);
  window.history.replaceState(
    null,
    "",
    "/?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1&embedMode=iframe",
  );
  _resetMcpAppHostForTests();
}

function parentWindow() {
  return {
    postMessage: vi.fn(),
  } as unknown as Window;
}

function dispatchHostMessage(data: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: window.parent }),
  );
}

function getJsonRpcCalls(parent: Window) {
  return vi
    .mocked(parent.postMessage)
    .mock.calls.map(([message]) => message)
    .filter(
      (message): message is Record<string, unknown> =>
        Boolean(message) &&
        typeof message === "object" &&
        (message as Record<string, unknown>).jsonrpc === "2.0",
    );
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function enableMcpEmbedBridge(): void {
  window.history.replaceState(
    null,
    "",
    "/?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1&embedMode=iframe",
  );
}

describe("MCP app host client helpers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    enableMcpEmbedBridge();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    setParent(window);
    window.history.replaceState(null, "", "/");
    _resetMcpAppHostForTests();
    _resetEmbedAuthForTests();
    sessionStorage.clear();
  });

  it("caches host context and exposes it through the React hook", async () => {
    setParent(parentWindow());
    const snapshots: unknown[] = [];

    function Probe() {
      snapshots.push(useMcpAppHostContext());
      return null;
    }

    await act(async () => {
      root.render(React.createElement(Probe));
    });

    act(() => {
      dispatchHostMessage({
        type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.HOST_CONTEXT,
        data: {
          context: { route: { pathname: "/customers" } },
          capabilities: { openLink: true, displayModes: ["inline", "pip"] },
          version: "1.0.0",
        },
      });
    });

    expect(getMcpAppHostContext()).toEqual({
      context: { route: { pathname: "/customers" } },
      capabilities: { openLink: true, displayModes: ["inline", "pip"] },
      version: "1.0.0",
    });
    expect(snapshots.at(-1)).toEqual(getMcpAppHostContext());
  });

  it("posts model context, link, and display mode requests to the parent", async () => {
    const parent = parentWindow();
    setNestedParent(parent);

    const modelContextResult = updateMcpAppModelContext({
      content: [{ type: "text", text: "Selected customer: Acme" }],
      structuredContent: { customerId: "acme" },
    });
    const linkResult = openMcpAppHostLink("https://example.com/customer/acme");
    const displayResult = requestMcpAppDisplayMode("pip");

    expect(parent.postMessage).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(parent.postMessage).mock.calls;
    expect(calls[0][0]).toMatchObject({
      type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.UPDATE_MODEL_CONTEXT,
      data: {
        content: [{ type: "text", text: "Selected customer: Acme" }],
        structuredContent: { customerId: "acme" },
      },
    });
    expect(calls[1][0]).toMatchObject({
      type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.OPEN_LINK,
      data: { url: "https://example.com/customer/acme" },
    });
    expect(calls[2][0]).toMatchObject({
      type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.REQUEST_DISPLAY_MODE,
      data: { mode: "pip" },
    });

    for (const call of calls) {
      const message = call[0] as { data: { requestId: string } };
      dispatchHostMessage({
        type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE,
        data: { requestId: message.data.requestId, ok: true },
      });
    }

    await expect(modelContextResult).resolves.toBe(true);
    await expect(linkResult).resolves.toBe(true);
    await expect(displayResult).resolves.toBe(true);
  });

  it("returns false outside a child frame and resolves false on host errors", async () => {
    expect(openMcpAppHostLink("https://example.com")).toBe(false);

    const parent = parentWindow();
    setNestedParent(parent);
    const result = requestMcpAppDisplayMode("fullscreen");
    const message = vi.mocked(parent.postMessage).mock.calls[0][0] as {
      data: { requestId: string };
    };

    dispatchHostMessage({
      type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE,
      data: {
        requestId: message.data.requestId,
        ok: false,
        error: "unsupported display mode",
      },
    });

    await expect(result).resolves.toBe(false);
  });

  it("resolves false when the wrapper does not respond", async () => {
    vi.useFakeTimers();
    setParent(parentWindow());

    const result = updateMcpAppModelContext({
      content: [{ type: "text", text: "No receiver" }],
    });

    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe(false);
  });

  it("talks directly to the MCP Apps host after direct frame navigation", async () => {
    const parent = parentWindow();
    setDirectParent(parent);

    const modelContextResult = updateMcpAppModelContext({
      content: [{ type: "text", text: "Selected customer: Acme" }],
      structuredContent: { customerId: "acme" },
    });
    await flushMicrotasks();

    let calls = getJsonRpcCalls(parent);
    expect(calls[0]).toMatchObject({
      method: "ui/initialize",
      params: {
        appCapabilities: {
          availableDisplayModes: ["inline", "fullscreen", "pip"],
        },
      },
    });
    const initId = calls[0].id;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initId,
      result: {
        protocolVersion: "2026-01-26",
        hostCapabilities: { openLinks: {} },
        hostContext: {
          displayMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
        },
      },
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "ui/notifications/initialized",
        }),
        expect.objectContaining({
          method: "ui/update-model-context",
          params: {
            content: [{ type: "text", text: "Selected customer: Acme" }],
            structuredContent: { customerId: "acme" },
          },
        }),
      ]),
    );
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: contextCall.id,
      result: {},
    });

    await expect(modelContextResult).resolves.toBe(true);

    const linkResult = openMcpAppHostLink("https://example.com/customer/acme");
    const displayResult = requestMcpAppDisplayMode("fullscreen");
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const linkCall = calls.find((call) => call.method === "ui/open-link")!;
    const displayCall = calls.find(
      (call) => call.method === "ui/request-display-mode",
    )!;
    expect(linkCall).toMatchObject({
      params: { url: "https://example.com/customer/acme" },
    });
    expect(displayCall).toMatchObject({
      params: { mode: "fullscreen" },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: linkCall.id, result: {} });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: displayCall.id,
      result: { mode: "fullscreen" },
    });

    await expect(linkResult).resolves.toBe(true);
    await expect(displayResult).resolves.toBe(true);
  });

  it("sends direct MCP Apps chat messages with hidden context first", async () => {
    const parent = parentWindow();
    setDirectParent(parent);

    const result = sendMcpAppHostMessage({
      context: "Selected row ids: a, b",
      message: "Continue with this selection",
    });
    await flushMicrotasks();

    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: {
        content: [{ type: "text", text: "Selected row ids: a, b" }],
      },
    });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: contextCall.id,
      result: {},
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const messageCall = calls.find((call) => call.method === "ui/message")!;
    expect(messageCall).toMatchObject({
      params: {
        role: "user",
        content: { type: "text", text: "Continue with this selection" },
      },
    });

    dispatchHostMessage({
      jsonrpc: "2.0",
      id: messageCall.id,
      result: {},
    });

    await expect(result).resolves.toBe(true);
  });

  it("clears direct MCP Apps hidden context when a chat turn has none", async () => {
    const parent = parentWindow();
    setDirectParent(parent);

    const result = sendMcpAppHostMessage({
      message: "Continue without selection",
    });
    await flushMicrotasks();

    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: { content: [] },
    });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: contextCall.id,
      result: {},
    });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: messageCall.id,
      result: {},
    });

    await expect(result).resolves.toBe(true);
  });

  it("does not concatenate hidden context into ChatGPT follow-up prompts", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    const setWidgetState = vi.fn();
    vi.stubGlobal("openai", {
      widgetState: { existing: true },
      setWidgetState,
      sendFollowUpMessage,
    });

    const result = sendMcpAppHostMessage({
      context:
        "Hidden draft context. Do not ask to read application-state/compose.json.",
      message: "Rewrite the selected sentence",
    });

    await expect(result).resolves.toBe(true);
    expect(setWidgetState).toHaveBeenCalledWith({
      existing: true,
      agentNativeChatContext:
        "Hidden draft context. Do not ask to read application-state/compose.json.",
    });
    expect(sendFollowUpMessage).toHaveBeenCalledWith({
      prompt: "Rewrite the selected sentence",
      scrollToBottom: true,
    });
    expect(JSON.stringify(sendFollowUpMessage.mock.calls)).not.toContain(
      "application-state/compose.json",
    );
  });

  it("clears ChatGPT hidden context when a follow-up has no context", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    const setWidgetState = vi.fn();
    vi.stubGlobal("openai", {
      widgetState: {
        existing: true,
        agentNativeChatContext: "Previous draft context",
      },
      setWidgetState,
      sendFollowUpMessage,
    });

    const result = sendMcpAppHostMessage({
      message: "Send a context-free follow-up",
    });

    await expect(result).resolves.toBe(true);
    expect(setWidgetState).toHaveBeenCalledWith({
      existing: true,
      agentNativeChatContext: null,
    });
    expect(sendFollowUpMessage).toHaveBeenCalledWith({
      prompt: "Send a context-free follow-up",
      scrollToBottom: true,
    });
  });

  it("keeps direct MCP host helpers enabled after the URL token is stripped", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    window.history.replaceState(
      null,
      "",
      "/?embedded=1&__an_mcp_chat_bridge=1",
    );
    sessionStorage.setItem("agent-native:embed-auth-token", "signed-token");
    sessionStorage.setItem("agent-native:mcp-chat-bridge", "1");

    const result = openMcpAppHostLink("https://example.com");
    await flushMicrotasks();

    const calls = getJsonRpcCalls(parent);
    expect(calls[0]).toMatchObject({ method: "ui/initialize" });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: calls[0].id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushMicrotasks();
    const linkCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/open-link",
    )!;
    dispatchHostMessage({ jsonrpc: "2.0", id: linkCall.id, result: {} });
    await expect(result).resolves.toBe(true);
  });

  it("clears direct MCP Apps hidden context between turns in the same session", async () => {
    const parent = parentWindow();
    setDirectParent(parent);

    const firstResult = sendMcpAppHostMessage({
      context:
        "Hidden draft context. Do not ask to read application-state/compose.json.",
      message: "Rewrite the selected sentence",
    });
    await flushMicrotasks();

    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const firstContextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(firstContextCall).toMatchObject({
      params: {
        content: [
          {
            type: "text",
            text: "Hidden draft context. Do not ask to read application-state/compose.json.",
          },
        ],
      },
    });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: firstContextCall.id,
      result: {},
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const firstMessageCall = calls.find(
      (call) => call.method === "ui/message",
    )!;
    expect(firstMessageCall).toMatchObject({
      params: {
        role: "user",
        content: { type: "text", text: "Rewrite the selected sentence" },
      },
    });
    expect(JSON.stringify(firstMessageCall)).not.toContain(
      "application-state/compose.json",
    );
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: firstMessageCall.id,
      result: {},
    });
    await expect(firstResult).resolves.toBe(true);

    vi.mocked(parent.postMessage).mockClear();

    const secondResult = sendMcpAppHostMessage({
      message: "Continue without selection",
    });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const secondContextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(secondContextCall).toMatchObject({
      params: { content: [] },
    });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: secondContextCall.id,
      result: {},
    });
    await flushMicrotasks();

    const secondMessageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    expect(secondMessageCall).toMatchObject({
      params: {
        role: "user",
        content: { type: "text", text: "Continue without selection" },
      },
    });
    expect(JSON.stringify(secondMessageCall)).not.toContain(
      "application-state/compose.json",
    );
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: secondMessageCall.id,
      result: {},
    });

    await expect(secondResult).resolves.toBe(true);
  });
});
