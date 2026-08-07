import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAgentChatMcpOptions } from "./mcp-options.js";

describe("resolveAgentChatMcpOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to a mounted MCP server with no overrides", () => {
    const resolved = resolveAgentChatMcpOptions(undefined);
    expect(resolved.enabled).toBe(true);
    expect(resolved.catalog).toBeUndefined();
    expect(resolved.connectorCatalog).toBeUndefined();
    expect(resolved.externalAgents).toBeUndefined();
    expect(resolved.builtinCrossAppTools).toBeUndefined();
  });

  it("reads the nested `mcp` option", () => {
    const resolved = resolveAgentChatMcpOptions({
      mcp: {
        enabled: false,
        catalog: "app",
        connectorCatalog: ["list-emails"],
        externalAgents: { writes: "ask_app_only" },
        builtinCrossAppTools: false,
        title: "Mail",
      },
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.catalog).toBe("app");
    expect(resolved.connectorCatalog).toEqual(["list-emails"]);
    expect(resolved.externalAgents).toEqual({ writes: "ask_app_only" });
    expect(resolved.builtinCrossAppTools).toBe(false);
    expect(resolved.title).toBe("Mail");
  });

  it("accepts the deprecated top-level keys and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = resolveAgentChatMcpOptions({
      disableMcp: true,
      connectorCatalog: ["list-events"],
      externalAgents: { authenticatedReads: "auto" },
      mcpServerInfo: { title: "Calendar", websiteUrl: "/" },
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.connectorCatalog).toEqual(["list-events"]);
    expect(resolved.externalAgents).toEqual({ authenticatedReads: "auto" });
    expect(resolved.title).toBe("Calendar");
    expect(resolved.websiteUrl).toBe("/");
    expect(warn).toHaveBeenCalled();
  });

  it("treats `disableMcp: true` and `mcp.enabled: false` as agreeing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The two forms are inverses, so a naive equality check would read this
    // pair as a conflict and refuse to boot an app that migrated correctly.
    const resolved = resolveAgentChatMcpOptions({
      disableMcp: true,
      mcp: { enabled: false },
    });
    expect(resolved.enabled).toBe(false);
  });

  it("throws when the legacy and nested forms disagree", () => {
    expect(() =>
      resolveAgentChatMcpOptions({
        disableMcp: true,
        mcp: { enabled: true },
      }),
    ).toThrow(/disableMcp/);

    expect(() =>
      resolveAgentChatMcpOptions({
        connectorCatalog: ["a"],
        mcp: { connectorCatalog: ["b"] },
      }),
    ).toThrow(/connectorCatalog/);

    expect(() =>
      resolveAgentChatMcpOptions({
        mcpServerInfo: { title: "Old" },
        mcp: { title: "New" },
      }),
    ).toThrow(/mcpServerInfo\.title/);
  });
});
