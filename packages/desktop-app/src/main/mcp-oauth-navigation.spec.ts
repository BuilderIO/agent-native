import { describe, expect, it, vi } from "vitest";

import {
  classifyMcpOAuthNavigation,
  createMcpOAuthNavigationGate,
  restoreMcpOAuthNavigationTarget,
} from "./mcp-oauth-navigation.js";

describe("MCP OAuth navigation gate", () => {
  it("tracks the authenticated webview while OAuth is active", () => {
    const gate = createMcpOAuthNavigationGate();
    const release = gate.begin(42);

    expect(gate.isActive(42)).toBe(true);
    expect(gate.isActive(43)).toBe(false);

    release();
    expect(gate.isActive(42)).toBe(false);
  });

  it("keeps a target active until all nested flows release it", () => {
    const gate = createMcpOAuthNavigationGate();
    const releaseFirst = gate.begin(42);
    const releaseSecond = gate.begin(42);

    releaseFirst();
    expect(gate.isActive(42)).toBe(true);

    releaseSecond();
    expect(gate.isActive(42)).toBe(false);
  });
});

describe("MCP OAuth navigation outcomes", () => {
  const navigation = {
    origin: "https://dispatch.example.com",
    returnPath: "/integrations",
  };

  it("completes after the hosted callback redirects to the return path", () => {
    expect(
      classifyMcpOAuthNavigation({
        ...navigation,
        candidateUrl: "https://dispatch.example.com/integrations",
        httpResponseCode: 200,
      }),
    ).toBe("success");
  });

  it("rejects an HTTP error from the hosted callback instead of waiting for timeout", () => {
    expect(
      classifyMcpOAuthNavigation({
        ...navigation,
        candidateUrl:
          "https://dispatch.example.com/_agent-native/mcp/servers/oauth/callback?error=invalid_state",
        httpResponseCode: 400,
      }),
    ).toBe("error");
  });

  it("rejects an HTTP error from the MCP start or provider navigation", () => {
    expect(
      classifyMcpOAuthNavigation({
        ...navigation,
        candidateUrl:
          "https://dispatch.example.com/_agent-native/mcp/servers/oauth/start?name=Notion",
        httpResponseCode: 400,
      }),
    ).toBe("error");
    expect(
      classifyMcpOAuthNavigation({
        ...navigation,
        candidateUrl: "https://mcp.example.com/oauth/authorize?state=valid",
        httpResponseCode: 502,
      }),
    ).toBe("error");
  });

  it("keeps a successful callback redirect pending until its return navigation", () => {
    expect(
      classifyMcpOAuthNavigation({
        ...navigation,
        candidateUrl:
          "https://dispatch.example.com/_agent-native/mcp/servers/oauth/callback?code=one-time&state=valid",
        httpResponseCode: 302,
      }),
    ).toBe("pending");
  });

  it("rejects an HTTP error on the return path as well", () => {
    expect(
      classifyMcpOAuthNavigation({
        ...navigation,
        candidateUrl: "https://dispatch.example.com/integrations",
        httpResponseCode: 403,
      }),
    ).toBe("error");
  });

  it("restores a failed flow to the validated integrations route before retry", async () => {
    const loadURL = vi.fn(async () => {});

    await restoreMcpOAuthNavigationTarget(
      {
        isDestroyed: () => false,
        loadURL,
      },
      navigation.origin,
      navigation.returnPath,
    );

    expect(loadURL).toHaveBeenCalledExactlyOnceWith(
      "https://dispatch.example.com/integrations",
    );
  });
});
