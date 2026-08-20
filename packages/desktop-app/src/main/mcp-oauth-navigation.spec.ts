import { describe, expect, it } from "vitest";

import { createMcpOAuthNavigationGate } from "./mcp-oauth-navigation.js";

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
