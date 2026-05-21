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
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "./mcp-app-host.js";

function setParent(parent: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
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

function enableMcpEmbedBridge(): void {
  window.history.replaceState(
    null,
    "",
    "/?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1",
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
    setParent(parent);

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
    setParent(parent);
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
});
