import { describe, expect, it } from "vitest";

import {
  buildMcpOAuthStartUrl,
  createMcpIntegrationFormDefaults,
  DEFAULT_MCP_INTEGRATIONS,
  filterMcpIntegrations,
  getDefaultMcpIntegrations,
  isCustomMcpIntegrationEnabled,
  isMcpIntegrationCatalogAvailable,
  mcpIntegrationAuthLabel,
  resolveMcpIntegrationScope,
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
    expect(filterMcpIntegrations("issues").map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "sentry",
        "linear",
        "atlassian",
        "github",
        "gitlab",
      ]),
    );
    expect(filterMcpIntegrations("jira").map((item) => item.id)).toEqual([
      "atlassian",
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

  it("includes the OAuth endpoint and setup guidance for Atlassian", () => {
    const atlassian = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "atlassian",
    );

    expect(atlassian).toMatchObject({
      url: "https://mcp.atlassian.com/v1/mcp/authv2",
      authMode: "oauth",
      docsUrl:
        "https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/",
      setupNoteKey: "mcpIntegrations.catalog.atlassian.setupNote",
    });
  });

  it("records logo and provider-gating metadata for remote directory entries", () => {
    const context7 = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "context7",
    );
    const semgrep = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "semgrep",
    );
    const cloudflare = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "cloudflare",
    );
    const figma = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "figma",
    );

    expect(context7?.logoUrl).toBe("https://context7.com/favicon.ico");
    expect(semgrep?.logoUrl).toBe("https://semgrep.dev/favicon.ico");
    expect(cloudflare).toMatchObject({
      url: "https://mcp.cloudflare.com/mcp",
      authMode: "oauth",
      connectionMode: "oauth",
      availability: "ready",
      logoUrl: "https://cdn.simpleicons.org/cloudflare",
    });
    expect(figma).toMatchObject({
      url: "https://mcp.figma.com/mcp",
      connectionMode: "manual",
      availability: "client-restricted",
      setupNoteKey: "mcpIntegrations.catalog.figma.setupNote",
    });
  });

  it("labels authentication modes for compact badges", () => {
    expect(mcpIntegrationAuthLabel("none")).toBe("No auth");
    expect(mcpIntegrationAuthLabel("headers")).toBe("Header");
    expect(mcpIntegrationAuthLabel("oauth")).toBe("OAuth");
  });

  it("builds an encoded OAuth start URL", () => {
    const url = buildMcpOAuthStartUrl({
      name: "Linear & Issues",
      url: "https://mcp.linear.app/sse?tenant=one&mode=oauth",
      description: "Read and write issues",
      scope: "org",
      returnUrl: "/settings?tab=mcp#linear",
    });
    const params = new URL(url, "https://example.com").searchParams;

    expect(new URL(url, "https://example.com").pathname).toBe(
      "/_agent-native/mcp/servers/oauth/start",
    );
    expect(params.get("name")).toBe("Linear & Issues");
    expect(params.get("url")).toBe(
      "https://mcp.linear.app/sse?tenant=one&mode=oauth",
    );
    expect(params.get("description")).toBe("Read and write issues");
    expect(params.get("scope")).toBe("org");
    expect(params.get("return")).toBe("/settings?tab=mcp#linear");
  });

  it("falls back to personal scope when organization access is unavailable", () => {
    expect(resolveMcpIntegrationScope("org", false, true)).toBe("user");
    expect(resolveMcpIntegrationScope("org", true, false)).toBe("user");
    expect(resolveMcpIntegrationScope("org", true, true)).toBe("org");
    expect(resolveMcpIntegrationScope("user", true, true)).toBe("user");
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
