import { describe, expect, it } from "vitest";

import {
  createMcpIntegrationFormDefaults,
  DEFAULT_MCP_INTEGRATIONS,
  filterMcpIntegrations,
  getDefaultMcpIntegrations,
  isCustomMcpIntegrationEnabled,
  isMcpIntegrationCatalogAvailable,
  mcpIntegrationAuthLabel,
} from "./mcp-integration-catalog.js";

describe("MCP integration catalog", () => {
  it("includes direct-connect defaults that do not need headers", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    );
    const semgrep = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "semgrep",
    );

    expect(context7?.url).toBe("https://mcp.context7.com/mcp");
    expect(context7?.authMode).toBe("none");
    expect(semgrep?.url).toBe("https://mcp.semgrep.ai/mcp");
    expect(semgrep?.authMode).toBe("none");
  });

  it("searches names, providers, use cases, urls, and keywords", () => {
    expect(filterMcpIntegrations("postgres").map((item) => item.id)).toEqual([
      "supabase",
      "neon",
    ]);
    expect(filterMcpIntegrations("issues").map((item) => item.id)).toEqual([
      "sentry",
      "linear",
    ]);
    expect(
      filterMcpIntegrations("mcp.sentry.dev").map((item) => item.id),
    ).toEqual(["sentry"]);
  });

  it("prefills form values from a selected preset without fabricating headers", () => {
    const sentry = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "sentry",
    );

    expect(createMcpIntegrationFormDefaults(sentry)).toEqual({
      name: "Sentry",
      url: "https://mcp.sentry.dev/mcp",
      description: "Inspect issues, events, and debugging data.",
      headersText: "",
    });
  });

  it("labels authentication modes for compact badges", () => {
    expect(mcpIntegrationAuthLabel("none")).toBe("No auth");
    expect(mcpIntegrationAuthLabel("headers")).toBe("Header");
    expect(mcpIntegrationAuthLabel("oauth")).toBe("OAuth");
  });

  it("can hide all default presets while leaving custom setup available", () => {
    const config = { defaults: false };

    expect(getDefaultMcpIntegrations(config)).toEqual([]);
    expect(isCustomMcpIntegrationEnabled(config)).toBe(true);
    expect(isMcpIntegrationCatalogAvailable(config)).toBe(true);
  });

  it("can hide the whole MCP integration entry", () => {
    expect(getDefaultMcpIntegrations(false)).toEqual([]);
    expect(isCustomMcpIntegrationEnabled(false)).toBe(false);
    expect(isMcpIntegrationCatalogAvailable(false)).toBe(false);
  });

  it("can include or exclude individual default presets", () => {
    expect(
      getDefaultMcpIntegrations({
        defaults: { include: ["context7", "sentry"] },
      }).map((item) => item.id),
    ).toEqual(["context7", "sentry"]);

    expect(
      getDefaultMcpIntegrations({
        defaults: { exclude: ["stripe", "notion"] },
      }).map((item) => item.id),
    ).not.toContain("stripe");
  });

  it("hides the menu when neither defaults nor custom servers are enabled", () => {
    expect(
      isMcpIntegrationCatalogAvailable({ defaults: false, custom: false }),
    ).toBe(false);
  });
});
