// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { describe, expect, it } from "vitest";

const appBridgeHarness = vi.hoisted(() => ({
  app: null as any,
  enabled: false,
  connected: null as Promise<void> | null,
  toolInput: null as any,
  toolResult: null as any,
}));

vi.mock("@modelcontextprotocol/ext-apps/app-bridge", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@modelcontextprotocol/ext-apps/app-bridge")
    >();

  class TestPostMessageTransport {
    peer: TestPostMessageTransport | null = null;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: any) => void;

    async start() {
      if (!appBridgeHarness.enabled || this.peer) return;
      const viewTransport = new TestPostMessageTransport();
      this.peer = viewTransport;
      viewTransport.peer = this;

      const { App } = await import("@modelcontextprotocol/ext-apps");
      const app = new App(
        { name: "Test MCP App", version: "1.0.0" },
        {},
        { autoResize: false },
      );
      app.ontoolinput = (params: unknown) => {
        appBridgeHarness.toolInput = params;
      };
      app.ontoolresult = (params: unknown) => {
        appBridgeHarness.toolResult = params;
      };
      appBridgeHarness.app = app;
      appBridgeHarness.connected = app.connect(viewTransport as any);
      await appBridgeHarness.connected;
    }

    async send(message: any) {
      queueMicrotask(() => this.peer?.onmessage?.(message));
    }

    async close() {
      this.onclose?.();
    }
  }

  return { ...actual, PostMessageTransport: TestPostMessageTransport };
});

import {
  AGENT_NATIVE_EMBED_MESSAGE_TYPES,
  AGENT_NATIVE_EMBED_PROTOCOL,
  AGENT_NATIVE_EMBED_VERSION,
} from "@agent-native/core/embedding/protocol";
import {
  callMcpTool,
  listVisibleMcpTools,
  type AgentMcpAppPayload,
} from "@agent-native/core/mcp-client";
import { setGlobalMcpManager } from "@agent-native/core/server/agent-chat/mcp-glue";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { OptionalPeerDependencyError } from "@agent-native/core/shared/optional-peer";
import * as optionalPeers from "@agent-native/core/shared/optional-peer";

import {
  buildMcpAppCsp,
  clampMcpAppHeight,
  createReadOnlyMcpAppSrcDoc,
  DEFAULT_MCP_APP_IFRAME_HEIGHT,
  isMcpAppReadyMessage,
  MCP_APP_INITIALIZE_TIMEOUT_MS,
  McpAppRenderer,
  supportedMcpAppPermissions,
} from "./McpAppRenderer.js";

describe("McpAppRenderer security helpers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    await appBridgeHarness.app?.close().catch(() => undefined);
    appBridgeHarness.app = null;
    appBridgeHarness.enabled = false;
    appBridgeHarness.connected = null;
    appBridgeHarness.toolInput = null;
    appBridgeHarness.toolResult = null;
    setGlobalMcpManager(null as any);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("grants only supported iframe permissions", () => {
    expect(
      supportedMcpAppPermissions({
        camera: {},
        microphone: {},
        geolocation: {},
        clipboardWrite: {},
      }),
    ).toEqual({ clipboardWrite: {} });
  });

  it("defaults to 650px and caps reported height to the visible viewport", () => {
    expect(DEFAULT_MCP_APP_IFRAME_HEIGHT).toBe(650);
    expect(clampMcpAppHeight(1200, 700)).toBe(700);
    expect(clampMcpAppHeight(420, 700)).toBe(420);
    expect(clampMcpAppHeight(120, 700)).toBe(220);
    expect(clampMcpAppHeight(420, 180)).toBe(180);
  });

  it("treats embedded app frame handshakes as ready signals", () => {
    expect(isMcpAppReadyMessage({ type: "agentNative.embeddedAppReady" })).toBe(
      true,
    );
    expect(
      isMcpAppReadyMessage({
        type: "agentNative.frameOrigin",
        origin: "http://127.0.0.1:8100",
      }),
    ).toBe(true);
    expect(
      isMcpAppReadyMessage({
        protocol: AGENT_NATIVE_EMBED_PROTOCOL,
        version: AGENT_NATIVE_EMBED_VERSION,
        type: AGENT_NATIVE_EMBED_MESSAGE_TYPES.READY,
      }),
    ).toBe(true);
    expect(isMcpAppReadyMessage({ type: "agentNative.submitChat" })).toBe(
      false,
    );
    expect(isMcpAppReadyMessage(null)).toBe(false);
  });

  it("builds a restrictive CSP and drops invalid source expressions", () => {
    const csp = buildMcpAppCsp({
      connectDomains: [
        "https://api.example.com/v1",
        "http://127.0.0.1:8080/assets",
        "javascript:alert(1)",
        "https://bad.example.com; script-src *",
      ],
      resourceDomains: [
        "https://cdn.example.com/assets",
        "http://localhost:5173",
      ],
      frameDomains: [
        "https:",
        "https://frames.example.com",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://evil.example:*",
      ],
    });

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(
      "connect-src https://api.example.com http://127.0.0.1:8080 ws://127.0.0.1:8080",
    );
    expect(csp).not.toContain("javascript:");
    expect(csp).not.toContain("bad.example.com");
    expect(csp).toContain("style-src 'unsafe-inline' https://cdn.example.com");
    expect(csp).toContain("http://localhost:5173");
    expect(csp).toContain(
      "frame-src https: https://frames.example.com http://localhost:* http://127.0.0.1:*",
    );
    expect(csp).not.toContain("http://evil.example:*");
  });

  it("stops waiting forever when a loaded resource never initializes the MCP bridge", async () => {
    vi.useFakeTimers();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const payload = mcpAppPayload({
      resourceHtml: "<!doctype html><html><body>Static widget</body></html>",
      openUrl: "https://plan.agent-native.com/plans/plan-123",
    });

    await act(async () => {
      root.render(React.createElement(McpAppRenderer, { app: payload }));
    });

    expect(container.textContent).toContain("Loading MCP App");
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();

    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });

    await act(async () => {
      vi.advanceTimersByTime(MCP_APP_INITIALIZE_TIMEOUT_MS + 1);
    });

    expect(container.textContent).toContain(
      "MCP App did not finish initializing.",
    );
    expect(container.querySelector(".agent-mcp-app__error-box")).toBeTruthy();
    expect(container.querySelector("iframe")).toBe(iframe);
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Open in new tab",
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openSpy).toHaveBeenCalledWith(
      "https://plan.agent-native.com/plans/plan-123",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("keeps embedded apps mounted when the wrapper reports readiness before the MCP bridge initializes", async () => {
    vi.useFakeTimers();
    const payload = mcpAppPayload({
      resourceHtml: "<!doctype html><html><body>Inline app</body></html>",
      openUrl: "https://plan.agent-native.com/plans/plan-123",
    });

    await act(async () => {
      root.render(React.createElement(McpAppRenderer, { app: payload }));
    });

    expect(container.textContent).toContain("Loading MCP App");
    const iframe = container.querySelector("iframe");
    expect(iframe?.contentWindow).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocol: AGENT_NATIVE_EMBED_PROTOCOL,
            version: AGENT_NATIVE_EMBED_VERSION,
            type: AGENT_NATIVE_EMBED_MESSAGE_TYPES.READY,
            payload: { app: "assets", mode: "picker" },
          },
          source: iframe?.contentWindow ?? null,
        }),
      );
    });

    expect(container.textContent).not.toContain("Loading MCP App");

    await act(async () => {
      vi.advanceTimersByTime(MCP_APP_INITIALIZE_TIMEOUT_MS + 1);
    });

    expect(container.textContent).not.toContain(
      "MCP App did not finish initializing.",
    );
  });

  it("initializes the v2 bridge and proxies MCP tool listing and calls through the app API", async () => {
    appBridgeHarness.enabled = true;
    const callTool = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "tool result" }],
    }));
    const tool = {
      source: "apps",
      name: "mcp__apps__inspect",
      originalName: "inspect",
      description: "Inspect an item",
      inputSchema: { type: "object" },
      raw: {
        name: "inspect",
        _meta: { ui: { visibility: ["app"] } },
      },
    };
    const endpoints: string[] = [];
    setGlobalMcpManager({
      getTools: () => [tool],
      getToolsForServer: (serverId: string) =>
        serverId === "apps" ? [tool] : [],
      callTool,
    } as any);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const endpoint = new URL(String(input), "http://localhost").pathname;
        endpoints.push(endpoint);
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (
          !endpoint.endsWith("/list-tools") &&
          !endpoint.endsWith("/call-tool")
        ) {
          throw new Error(`Unexpected MCP App endpoint: ${endpoint}`);
        }
        const response = await runWithRequestContext(
          { userEmail: "alice@example.com", orgId: "acme" },
          () =>
            endpoint.endsWith("/list-tools")
              ? listVisibleMcpTools({ serverId: body.serverId })
              : callMcpTool(body.serverId, body.toolName, body.arguments),
        );
        return Response.json(
          endpoint.endsWith("/list-tools") ? { tools: response } : response,
        );
      }),
    );
    const payload = {
      ...mcpAppPayload({
        resourceHtml:
          "<!doctype html><html><body>Interactive app</body></html>",
        openUrl: "https://plan.agent-native.com/plans/plan-123",
      }),
      serverId: "apps",
    };

    await act(async () => {
      root.render(
        React.createElement(McpAppRenderer, {
          app: payload,
        }),
      );
    });

    await act(async () => {
      await vi.waitFor(() => expect(appBridgeHarness.connected).toBeTruthy());
      await appBridgeHarness.connected;
      await vi.waitFor(() => expect(appBridgeHarness.toolInput).not.toBeNull());
      expect(appBridgeHarness.app).not.toBeNull();
    });
    expect(appBridgeHarness.toolInput).toEqual({ arguments: { embed: true } });
    expect(appBridgeHarness.toolResult).toEqual({
      content: [],
      structuredContent: payload.toolResult.structuredContent,
    });

    let listed: any;
    await act(async () => {
      listed = await appBridgeHarness.app.request({
        method: "tools/list",
        params: {},
      });
    });
    expect(listed.tools).toEqual([
      expect.objectContaining({
        name: "inspect",
        description: "Inspect an item",
      }),
    ]);

    let result: any;
    await act(async () => {
      result = await appBridgeHarness.app.callServerTool({
        name: "inspect",
        arguments: { id: "item-1" },
      });
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "tool result" }],
    });
    expect(callTool).toHaveBeenCalledWith("mcp__apps__inspect", {
      id: "item-1",
    });
    expect(endpoints).toEqual([
      "/_agent-native/mcp/apps/list-tools",
      "/_agent-native/mcp/apps/call-tool",
    ]);
  });

  it("renders saved app markup as a sanitized non-scripted snapshot", async () => {
    const payload = mcpAppPayload({
      resourceHtml:
        '<!doctype html><script>window.leak = true</script><html><head><meta http-equiv="refresh" content="0;url=https://tracker.example"></head><body onload="window.leak = true"><a href="https://tracker.example">Saved app</a><img src="https://tracker.example/image.png"></body></html>',
      openUrl: "https://plan.agent-native.com/plans/plan-123",
    });
    payload.resource!._meta = {
      ui: { csp: { resourceDomains: ["https://untrusted-cdn.example.com"] } },
    };

    act(() => {
      root.render(
        React.createElement(McpAppRenderer, {
          app: payload,
          readOnly: true,
        }),
      );
    });

    await vi.waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull(),
    );
    const renderedIframe = container.querySelector("iframe");
    expect(renderedIframe?.getAttribute("sandbox")).toBe("");
    await vi.waitFor(() =>
      expect(renderedIframe?.srcdoc).toContain("connect-src 'none'"),
    );
    expect(renderedIframe?.srcdoc).toContain("script-src 'none'");
    expect(renderedIframe?.srcdoc).toContain("navigate-to 'none'");
    expect(
      renderedIframe?.srcdoc?.indexOf("Content-Security-Policy"),
    ).toBeLessThan(renderedIframe?.srcdoc?.indexOf("<body") ?? -1);
    expect(renderedIframe?.srcdoc).toContain("Saved app");
    expect(renderedIframe?.srcdoc).not.toContain("window.leak");
    expect(renderedIframe?.srcdoc).not.toContain("tracker.example");
    expect(renderedIframe?.srcdoc).not.toContain("untrusted-cdn.example.com");
    expect(container.querySelector("button")).toBeNull();
  });

  it("places the read-only policy before any replayed markup", async () => {
    const parseFromString = vi.spyOn(DOMParser.prototype, "parseFromString");
    const srcDoc = await createReadOnlyMcpAppSrcDoc(
      "<script>window.early = true</script><p>Replay</p>",
    );

    expect(parseFromString).not.toHaveBeenCalled();
    expect(srcDoc.indexOf("Content-Security-Policy")).toBeLessThan(
      srcDoc.indexOf("<body"),
    );
    expect(srcDoc).not.toContain("window.early");
    expect(srcDoc).toContain("Replay");
  });

  it("preserves the typed install hint when the read-only sanitizer peer is missing", async () => {
    const missingPeer = new OptionalPeerDependencyError("linkedom");
    vi.spyOn(optionalPeers, "loadOptionalPeer").mockRejectedValue(missingPeer);

    await expect(createReadOnlyMcpAppSrcDoc("<p>Saved app</p>")).rejects.toBe(
      missingPeer,
    );
  });
});

function mcpAppPayload({
  resourceHtml,
  openUrl,
}: {
  resourceHtml: string;
  openUrl: string;
}): AgentMcpAppPayload {
  return {
    serverId: "plan",
    toolName: "open_app",
    originalToolName: "open_app",
    resourceUri: "ui://plan/open_app/shell-v53",
    toolInput: { embed: true },
    toolResult: {
      structuredContent: {
        openLink: { webUrl: openUrl },
      },
    },
    resource: {
      uri: "ui://plan/open_app/shell-v53",
      mimeType: "text/html;profile=mcp-app",
      text: resourceHtml,
    },
  };
}
