// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { describe, expect, it } from "vitest";

import {
  AGENT_NATIVE_EMBED_MESSAGE_TYPES,
  AGENT_NATIVE_EMBED_PROTOCOL,
  AGENT_NATIVE_EMBED_VERSION,
} from "../../embedding/protocol.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import {
  buildMcpAppCsp,
  clampMcpAppHeight,
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

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
