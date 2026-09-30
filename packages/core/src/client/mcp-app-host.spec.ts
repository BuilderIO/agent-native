// @vitest-environment happy-dom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetEmbedAuthForTests } from "./embed-auth.js";
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

const REQUEST_TIMEOUT_MS = 5000;
const CANCEL_CHAT_ACK_TIMEOUT_MS = 1000;

function setTestUrl(url: string): void {
  const happyDom = (window as unknown as { happyDOM?: { setURL?: unknown } })
    .happyDOM;
  if (happyDom && typeof happyDom.setURL === "function") {
    happyDom.setURL(url);
    return;
  }
  window.history.replaceState(null, "", url);
}

function setParent(parent: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
}

function setDirectParent(parent: Window): void {
  setParent(parent);
  setTestUrl(
    "/?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1",
  );
  _resetMcpAppHostForTests();
}

function setNestedParent(parent: Window): void {
  setParent(parent);
  setTestUrl(
    "/?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1&embedMode=iframe",
  );
  _resetMcpAppHostForTests();
}

function setClaudeTransplantParent(parent: Window): void {
  setParent(parent);
  setTestUrl(
    "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com/picker?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1",
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

async function flushHostLifecycleTurn() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await flushMicrotasks();
}

function enableMcpEmbedBridge(): void {
  setTestUrl(
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
    setTestUrl("http://localhost:3000/");
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
          hostInfo: { name: "Claude Code", version: "1.0.0" },
        },
      });
    });

    expect(getMcpAppHostContext()).toEqual({
      context: { route: { pathname: "/customers" } },
      capabilities: { openLink: true, displayModes: ["inline", "pip"] },
      version: "1.0.0",
      hostInfo: { name: "Claude Code", version: "1.0.0" },
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
        content: [
          {
            type: "text",
            text: "Selected customer: Acme",
            annotations: { audience: ["assistant"] },
          },
        ],
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

  it("does not mistake an ordinary inline browser frame for an MCP App", () => {
    const parent = parentWindow();
    setParent(parent);
    setTestUrl("http://localhost:3000/design/design_1");
    _resetMcpAppHostForTests();
    _resetEmbedAuthForTests();

    expect(sendMcpAppHostMessage({ message: "Apply these design edits" })).toBe(
      false,
    );
    expect(parent.postMessage).not.toHaveBeenCalled();
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
    await flushHostLifecycleTurn();

    expect(getMcpAppHostContext()).toMatchObject({
      version: "2026-01-26",
    });

    calls = getJsonRpcCalls(parent);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "ui/notifications/initialized",
        }),
        expect.objectContaining({
          method: "ui/update-model-context",
          params: {
            content: [
              {
                type: "text",
                text: "Selected customer: Acme",
                annotations: { audience: ["assistant"] },
              },
            ],
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

  it.each([
    ["ok false", { ok: false }],
    ["isError", { isError: true }],
  ])(
    "returns false when the direct host rejects model context with %s",
    async (_label, result) => {
      const parent = parentWindow();
      setDirectParent(parent);

      const modelContextResult = updateMcpAppModelContext({
        content: [{ type: "text", text: "Selected customer: Acme" }],
      });
      await flushMicrotasks();

      const initCall = getJsonRpcCalls(parent).find(
        (call) => call.method === "ui/initialize",
      )!;
      dispatchHostMessage({
        jsonrpc: "2.0",
        id: initCall.id,
        result: { protocolVersion: "2026-01-26" },
      });
      await flushHostLifecycleTurn();

      const contextCall = getJsonRpcCalls(parent).find(
        (call) => call.method === "ui/update-model-context",
      )!;
      dispatchHostMessage({
        jsonrpc: "2.0",
        id: contextCall.id,
        result,
      });

      await expect(modelContextResult).resolves.toBe(false);
    },
  );

  it("sends direct MCP Apps chat messages with hidden context first", async () => {
    const parent = parentWindow();
    setDirectParent(parent);

    const result = sendMcpAppHostMessage({
      context: "Selected row ids: a, b",
      message: "Continue with this selection",
      mode: "plan",
    });
    await flushMicrotasks();

    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: {
        content: [
          {
            type: "text",
            text: "Selected row ids: a, b",
            annotations: { audience: ["assistant"] },
          },
        ],
        mode: "plan",
        requestMode: "plan",
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
        content: [{ type: "text", text: "Continue with this selection" }],
        mode: "plan",
        requestMode: "plan",
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
    await flushHostLifecycleTurn();

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

  it("does not submit a chat after the host rejects its model context", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      context: "Selected row: row-123",
      message: "Summarize this row",
      structuredContent: { rowId: "row-123" },
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: contextCall.id,
      result: { ok: false },
    });

    await expect(result).resolves.toBe(false);
    expect(
      getJsonRpcCalls(parent).some((call) => call.method === "ui/message"),
    ).toBe(false);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("uses MCP model context and messages with the OpenAI bridge", async () => {
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
      requestMode: "plan",
    });

    await flushMicrotasks();
    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: {
        content: [
          {
            type: "text",
            text: "Hidden draft context. Do not ask to read application-state/compose.json.",
            annotations: { audience: ["assistant"] },
          },
        ],
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    expect(messageCall).toMatchObject({
      params: {
        role: "user",
        content: [{ type: "text", text: "Rewrite the selected sentence" }],
      },
    });
    expect(JSON.stringify(messageCall)).not.toContain(
      "application-state/compose.json",
    );
    dispatchHostMessage({ jsonrpc: "2.0", id: messageCall.id, result: {} });

    await expect(result).resolves.toBe(true);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
    expect(setWidgetState).not.toHaveBeenCalled();
  });

  it("sends rich context blocks and clears the OpenAI model context", async () => {
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
      context: "Hidden selected asset context",
      message: "Use the selected Assets image",
      mode: "plan",
      structuredContent: {
        selectedAsset: {
          assetId: "asset-123",
          url: "https://example.com/a.png",
        },
      },
      content: [
        { type: "text", text: "Use the selected Assets image" },
        { type: "image", data: "ZmFrZS1pbWFnZQ==", mimeType: "image/webp" },
      ],
    });

    await flushMicrotasks();
    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: {
        content: [
          {
            type: "text",
            text: "Hidden selected asset context",
            annotations: { audience: ["assistant"] },
          },
          {
            type: "image",
            data: "ZmFrZS1pbWFnZQ==",
            mimeType: "image/webp",
            annotations: { audience: ["assistant"] },
          },
        ],
        structuredContent: {
          selectedAsset: {
            assetId: "asset-123",
            url: "https://example.com/a.png",
          },
        },
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    expect(messageCall).toMatchObject({
      params: {
        role: "user",
        content: [
          { type: "text", text: "Use the selected Assets image" },
          { type: "image", data: "ZmFrZS1pbWFnZQ==", mimeType: "image/webp" },
        ],
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: messageCall.id, result: {} });
    await expect(result).resolves.toBe(true);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
    expect(setWidgetState).not.toHaveBeenCalled();
  });

  it("sends follow-up prompts through the wrapper bridge in nested MCP app frames", async () => {
    const parent = parentWindow();
    setNestedParent(parent);

    const result = sendMcpAppHostMessage({
      context: "Hidden selected asset context",
      message: "Use the selected Assets image",
      mode: "plan",
      structuredContent: {
        selectedAsset: {
          assetId: "asset-123",
          url: "https://example.com/a.png",
        },
      },
      content: [
        { type: "text", text: "Use the selected Assets image" },
        { type: "image", data: "ZmFrZS1pbWFnZQ==", mimeType: "image/webp" },
      ],
    });

    await flushMicrotasks();

    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: "agentNative.submitChat",
        data: {
          requestId: expect.any(String),
          context: "Hidden selected asset context",
          message: "Use the selected Assets image",
          mode: "plan",
          requestMode: "plan",
          content: [
            { type: "text", text: "Use the selected Assets image" },
            { type: "image", data: "ZmFrZS1pbWFnZQ==", mimeType: "image/webp" },
          ],
          structuredContent: {
            selectedAsset: {
              assetId: "asset-123",
              url: "https://example.com/a.png",
            },
          },
          submit: true,
        },
      },
      "*",
    );
    expect(getJsonRpcCalls(parent)).toEqual([]);

    const message = vi.mocked(parent.postMessage).mock.calls[0]?.[0] as {
      data?: { requestId?: string };
    };
    dispatchHostMessage({
      type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE,
      data: { requestId: message.data?.requestId, ok: true },
    });
    await expect(result).resolves.toBe(true);
  });

  it("reports wrapper bridge chat failure when the host does not acknowledge", async () => {
    vi.useFakeTimers();
    const parent = parentWindow();
    setNestedParent(parent);

    const result = sendMcpAppHostMessage({
      message: "Use the selected Assets image",
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(CANCEL_CHAT_ACK_TIMEOUT_MS);
    await expect(result).resolves.toBe(null);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      {
        type: "agentNative.cancelChat",
        data: { requestId: expect.any(String) },
      },
      "*",
    );
  });

  it("uses a late cancellation acknowledgment to safely relay a timed-out chat", async () => {
    vi.useFakeTimers();
    const parent = parentWindow();
    setNestedParent(parent);

    const result = sendMcpAppHostMessage({
      message: "Continue with this selection",
    });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await flushMicrotasks();

    const submitMessage = vi.mocked(parent.postMessage).mock.calls[0]?.[0] as {
      data: { requestId: string };
    };
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      {
        type: "agentNative.cancelChat",
        data: { requestId: submitMessage.data.requestId },
      },
      "*",
    );

    dispatchHostMessage({
      type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE,
      data: {
        requestId: submitMessage.data.requestId,
        ok: false,
        result: { ok: false, notSubmitted: true },
      },
    });

    await expect(result).resolves.toBe(false);
  });

  it.each([
    ["confirmed non-submission", { notSubmitted: true }, false],
    ["an ambiguous rejection", {}, null],
  ])(
    "classifies wrapper chat acknowledgments as %s",
    async (_label, responseResult, expected) => {
      const parent = parentWindow();
      setNestedParent(parent);

      const result = sendMcpAppHostMessage({
        message: "Continue with this selection",
      });
      await flushMicrotasks();

      const submitMessage = vi.mocked(parent.postMessage).mock
        .calls[0]?.[0] as {
        data: { requestId: string };
      };
      dispatchHostMessage({
        type: AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES.RESPONSE,
        data: {
          requestId: submitMessage.data.requestId,
          ok: false,
          result: responseResult,
        },
      });

      await expect(result).resolves.toBe(expected);
    },
  );

  it("uses direct MCP Apps chat messages in Claude transplanted frames", async () => {
    const parent = parentWindow();
    setClaudeTransplantParent(parent);

    const result = sendMcpAppHostMessage({
      context: "Hidden selected asset context",
      message: "Use the selected Assets image",
    });
    await flushMicrotasks();

    expect(parent.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agentNative.submitChat" }),
      "*",
    );

    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: {
        content: [
          {
            type: "text",
            text: "Hidden selected asset context",
            annotations: { audience: ["assistant"] },
          },
        ],
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const messageCall = calls.find((call) => call.method === "ui/message")!;
    expect(messageCall).toMatchObject({
      params: {
        role: "user",
        content: [{ type: "text", text: "Use the selected Assets image" }],
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: messageCall.id, result: {} });

    await expect(result).resolves.toBe(true);
  });

  it("passes rich content blocks through direct MCP Apps chat messages", async () => {
    const parent = parentWindow();
    setClaudeTransplantParent(parent);

    const content = [
      { type: "text", text: "Use the selected Assets image" },
      { type: "image", data: "ZmFrZS1pbWFnZQ==", mimeType: "image/webp" },
    ];
    const result = sendMcpAppHostMessage({
      context: "Hidden selected asset context",
      structuredContent: {
        selectedAsset: {
          assetId: "asset-123",
          url: "https://example.com/a.png",
        },
      },
      content,
      message: "Use the selected Assets image",
    });
    await flushMicrotasks();

    let calls = getJsonRpcCalls(parent);
    const initCall = calls.find((call) => call.method === "ui/initialize")!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    calls = getJsonRpcCalls(parent);
    const contextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(contextCall).toMatchObject({
      params: {
        content: [
          {
            type: "text",
            text: "Hidden selected asset context",
            annotations: { audience: ["assistant"] },
          },
          {
            type: "image",
            data: "ZmFrZS1pbWFnZQ==",
            mimeType: "image/webp",
            annotations: { audience: ["assistant"] },
          },
        ],
        structuredContent: {
          selectedAsset: {
            assetId: "asset-123",
            url: "https://example.com/a.png",
          },
        },
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    calls = getJsonRpcCalls(parent);
    const messageCall = calls.find((call) => call.method === "ui/message")!;
    expect(messageCall).toMatchObject({
      params: {
        role: "user",
        content,
      },
    });
    dispatchHostMessage({ jsonrpc: "2.0", id: messageCall.id, result: {} });

    await expect(result).resolves.toBe(true);
  });

  it("uses the OpenAI fallback for text-only chat when MCP initialization fails", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", {
      sendFollowUpMessage,
    });

    const result = sendMcpAppHostMessage({
      message: "Send a context-free follow-up",
      content: [
        { type: "text", text: "Send a context-free follow-up" },
        { type: "text", text: "Include the row owner" },
      ],
      requestMode: "plan",
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      error: { code: -32601, message: "Method not found" },
    });
    await expect(result).resolves.toBe(true);
    expect(sendFollowUpMessage).toHaveBeenCalledWith({
      prompt:
        "Send a context-free follow-up\n\nAdditional text:\nInclude the row owner",
      scrollToBottom: true,
      mode: "plan",
      requestMode: "plan",
    });
  });

  it("does not expose assistant-only context through the OpenAI fallback", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      context: "Selected row: row-123",
      message: "Summarize this row",
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
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
      error: { code: -32601, message: "Method not found" },
    });

    await expect(result).resolves.toBe(false);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["assistant-only", ["assistant"], false],
    ["user-only", ["user"], false],
    ["both audiences", ["assistant", "user"], true],
  ])(
    "respects %s annotations in the OpenAI fallback",
    async (_label, audience, expected) => {
      const parent = parentWindow();
      setDirectParent(parent);
      const sendFollowUpMessage = vi.fn(async () => ({}));
      vi.stubGlobal("openai", { sendFollowUpMessage });

      const result = sendMcpAppHostMessage({
        message: "Summarize this row",
        content: [
          {
            type: "text",
            text: "Selection detail",
            annotations: { audience },
          },
        ],
      });

      await flushMicrotasks();
      const initCall = getJsonRpcCalls(parent).find(
        (call) => call.method === "ui/initialize",
      )!;
      dispatchHostMessage({
        jsonrpc: "2.0",
        id: initCall.id,
        result: { protocolVersion: "2026-01-26" },
      });
      await flushHostLifecycleTurn();

      const contextCall = getJsonRpcCalls(parent).find(
        (call) => call.method === "ui/update-model-context",
      )!;
      dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
      await flushMicrotasks();

      const messageCall = getJsonRpcCalls(parent).find(
        (call) => call.method === "ui/message",
      )!;
      dispatchHostMessage({
        jsonrpc: "2.0",
        id: messageCall.id,
        error: { code: -32601, message: "Method not found" },
      });

      await expect(result).resolves.toBe(expected);
      expect(sendFollowUpMessage).toHaveBeenCalledTimes(expected ? 1 : 0);
    },
  );

  it("does not replay a direct chat after an ambiguous message timeout", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      message: "Send a context-free follow-up",
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    vi.useFakeTimers();
    await flushMicrotasks();

    expect(
      getJsonRpcCalls(parent).some((call) => call.method === "ui/message"),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toBe(null);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("does not replay after a result-level ui/message rejection", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      message: "Send a context-free follow-up",
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: messageCall.id,
      result: { isError: true },
    });

    await expect(result).resolves.toBe(null);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("does not fall back after an unclassified direct message error", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      message: "Send a context-free follow-up",
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: messageCall.id,
      error: { code: -32000, message: "Host processing failed" },
    });

    await expect(result).resolves.toBe(null);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("uses the OpenAI fallback when the host confirms ui/message is unavailable", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      message: "Send a context-free follow-up",
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: messageCall.id,
      error: { code: -32601, message: "Method not found" },
    });

    await expect(result).resolves.toBe(true);
    expect(sendFollowUpMessage).toHaveBeenCalledWith({
      prompt: "Send a context-free follow-up",
      scrollToBottom: true,
    });
  });

  it("does not expose structured context through the OpenAI fallback", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      message: "Summarize this row",
      structuredContent: { rowId: "row-123" },
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    const contextCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/update-model-context",
    )!;
    dispatchHostMessage({ jsonrpc: "2.0", id: contextCall.id, result: {} });
    await flushMicrotasks();

    const messageCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/message",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: messageCall.id,
      error: { code: -32601, message: "Method not found" },
    });

    await expect(result).resolves.toBe(false);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("reports failure when the OpenAI fallback cannot represent rich content", async () => {
    const parent = parentWindow();
    setDirectParent(parent);
    const sendFollowUpMessage = vi.fn(async () => ({}));
    vi.stubGlobal("openai", { sendFollowUpMessage });

    const result = sendMcpAppHostMessage({
      message: "Describe this image",
      content: [
        { type: "text", text: "Describe this image" },
        { type: "image", data: "ZmFrZS1pbWFnZQ==", mimeType: "image/webp" },
      ],
    });

    await flushMicrotasks();
    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      error: { code: -32601, message: "Method not found" },
    });

    await expect(result).resolves.toBe(false);
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
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
    await flushHostLifecycleTurn();
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
    await flushHostLifecycleTurn();

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
            annotations: { audience: ["assistant"] },
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
        content: [{ type: "text", text: "Rewrite the selected sentence" }],
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
        content: [{ type: "text", text: "Continue without selection" }],
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

  it("serializes direct MCP Apps context and message pairs", async () => {
    const parent = parentWindow();
    setDirectParent(parent);

    const firstResult = sendMcpAppHostMessage({
      context: "Context A",
      message: "Message A",
    });
    const secondResult = sendMcpAppHostMessage({
      context: "Context B",
      message: "Message B",
    });
    await flushMicrotasks();

    const initCall = getJsonRpcCalls(parent).find(
      (call) => call.method === "ui/initialize",
    )!;
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: initCall.id,
      result: { protocolVersion: "2026-01-26" },
    });
    await flushHostLifecycleTurn();

    let calls = getJsonRpcCalls(parent);
    const firstContextCall = calls.find(
      (call) => call.method === "ui/update-model-context",
    )!;
    expect(firstContextCall.params).toMatchObject({
      content: [{ text: "Context A" }],
    });
    expect(
      calls.filter((call) => call.method === "ui/update-model-context"),
    ).toHaveLength(1);
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
    expect(firstMessageCall.params).toMatchObject({
      content: [{ text: "Message A" }],
    });
    expect(calls.filter((call) => call.method === "ui/message")).toHaveLength(
      1,
    );
    expect(
      calls.filter((call) => call.method === "ui/update-model-context"),
    ).toHaveLength(1);
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: firstMessageCall.id,
      result: {},
    });
    await flushHostLifecycleTurn();

    calls = getJsonRpcCalls(parent);
    const contextCalls = calls.filter(
      (call) => call.method === "ui/update-model-context",
    );
    expect(contextCalls).toHaveLength(2);
    const secondContextCall = contextCalls[1]!;
    expect(secondContextCall.params).toMatchObject({
      content: [{ text: "Context B" }],
    });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: secondContextCall.id,
      result: {},
    });
    await flushHostLifecycleTurn();

    const messageCalls = getJsonRpcCalls(parent).filter(
      (call) => call.method === "ui/message",
    );
    expect(messageCalls).toHaveLength(2);
    const secondMessageCall = messageCalls[1]!;
    expect(secondMessageCall.params).toMatchObject({
      content: [{ text: "Message B" }],
    });
    dispatchHostMessage({
      jsonrpc: "2.0",
      id: secondMessageCall.id,
      result: {},
    });

    await expect(firstResult).resolves.toBe(true);
    await expect(secondResult).resolves.toBe(true);
  });
});
