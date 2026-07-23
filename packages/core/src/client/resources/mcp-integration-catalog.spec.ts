import { describe, expect, it } from "vitest";

import {
  buildMcpOAuthStartUrl,
  createMcpIntegrationFormDefaults,
  DEFAULT_MCP_INTEGRATIONS,
  findMcpIntegrationForText,
  filterMcpIntegrations,
  getMcpIntegrationApiFallback,
  getDefaultMcpIntegrations,
  isCustomMcpIntegrationEnabled,
  isMcpIntegrationCatalogAvailable,
  isMcpConnectionFailureText,
  mcpIntegrationAuthLabel,
  mergeDefaultMcpIntegrations,
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

  it("replaces one remote MCP preset without dropping the rest", () => {
    const slack = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "slack",
    )!;
    const merged = mergeDefaultMcpIntegrations([
      { ...slack, name: "Acme Slack" },
    ]);

    expect(merged).toHaveLength(DEFAULT_MCP_INTEGRATIONS.length);
    expect(merged.find(({ id }) => id === "slack")?.name).toBe("Acme Slack");
    expect(merged.find(({ id }) => id === "stripe")?.name).toBe("Stripe");
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
    const granola = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "granola",
    );

    expect(context7?.logoUrl).toMatch(
      /^data:image\/(?:x-icon|vnd\.microsoft\.icon);base64,/,
    );
    expect(semgrep?.logoUrl).toMatch(
      /^data:image\/(?:x-icon|vnd\.microsoft\.icon);base64,/,
    );
    expect(cloudflare).toMatchObject({
      url: "https://mcp.cloudflare.com/mcp",
      authMode: "oauth",
      connectionMode: "oauth",
      availability: "ready",
    });
    expect(cloudflare?.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(granola?.logoUrl).toMatch(/^data:image\/png;base64,/);
    expect(figma).toMatchObject({
      url: "https://mcp.figma.com/mcp",
      connectionMode: "manual",
      availability: "client-restricted",
      setupNoteKey: "mcpIntegrations.catalog.figma.setupNote",
      apiFallback: {
        secretKey: "FIGMA_ACCESS_TOKEN",
        docsUrl:
          "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
        templateUses: ["design"],
      },
    });
    expect(getMcpIntegrationApiFallback(figma, "design")).toMatchObject({
      secretKey: "FIGMA_ACCESS_TOKEN",
    });
    expect(getMcpIntegrationApiFallback(figma, "analytics")).toBeNull();
    expect(getMcpIntegrationApiFallback(figma, null)).toBeNull();
    expect(DEFAULT_MCP_INTEGRATIONS).toHaveLength(26);
    expect(
      new Set(DEFAULT_MCP_INTEGRATIONS.map((integration) => integration.id))
        .size,
    ).toBe(26);
    for (const integration of DEFAULT_MCP_INTEGRATIONS) {
      expect(integration.logoUrl).toMatch(
        /^data:image\/(?:png|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/,
      );
      expect(["verified", "preflight-only", "restricted"]).toContain(
        integration.verification,
      );
    }
    expect(
      DEFAULT_MCP_INTEGRATIONS.find((item) => item.id === "github"),
    ).toMatchObject({
      availability: "provider-setup",
      verification: "restricted",
    });
    expect(
      DEFAULT_MCP_INTEGRATIONS.find((item) => item.id === "intercom"),
    ).toMatchObject({ url: "https://mcp.intercom.com/mcp" });
    expect(
      DEFAULT_MCP_INTEGRATIONS.find((item) => item.id === "zapier"),
    ).toMatchObject({
      url: "https://mcp.zapier.com/api/v1/connect",
      authMode: "headers",
      availability: "ready",
    });
    expect(
      DEFAULT_MCP_INTEGRATIONS.find((item) => item.id === "paypal"),
    ).toMatchObject({
      url: "https://mcp.paypal.com/sse",
      authMode: "oauth",
      availability: "ready",
    });
    expect(
      DEFAULT_MCP_INTEGRATIONS.find((item) => item.id === "canva"),
    ).toMatchObject({
      url: "https://mcp.canva.com/mcp",
      connectionMode: "manual",
      availability: "client-restricted",
    });
    expect(
      DEFAULT_MCP_INTEGRATIONS.find((item) => item.id === "granola"),
    ).toMatchObject({
      url: "https://mcp.granola.ai/mcp",
      authMode: "oauth",
      connectionMode: "oauth",
      availability: "ready",
      docsUrl: "https://docs.granola.ai/help-center/sharing/integrations/mcp",
    });
  });

  it("matches resource links to their MCP preset", () => {
    expect(
      findMcpIntegrationForText(
        "Please read https://www.notion.so/acme/Project-123",
      )?.id,
    ).toBe("notion");
    expect(
      findMcpIntegrationForText("Canva link: https://canva.com/design/abc")?.id,
    ).toBe("canva");
    expect(
      findMcpIntegrationForText("I cannot read this Notion page")?.id,
    ).toBe("notion");
    expect(findMcpIntegrationForText("Explain linear algebra")).toBeNull();
    expect(findMcpIntegrationForText("Use monday for this task")).toBeNull();
    expect(findMcpIntegrationForText("Use monday.com for this task")?.id).toBe(
      "monday",
    );
    expect(
      findMcpIntegrationForText("Connect Linear to read my issues")?.id,
    ).toBe("linear");
    expect(findMcpIntegrationForText("Do the Granola thing")?.id).toBe(
      "granola",
    );
    expect(findMcpIntegrationForText("Do the Jira thing")?.id).toBe(
      "atlassian",
    );
    expect(
      findMcpIntegrationForText("Summarize my Granola meeting recordings")?.id,
    ).toBe("granola");
    expect(findMcpIntegrationForText("Pull my meeting recordings")).toBeNull();
    expect(
      findMcpIntegrationForText("Find call transcripts from Gong"),
    ).toBeNull();
    expect(
      findMcpIntegrationForText(
        "Make the action items and decisions larger on this slide",
      ),
    ).toBeNull();
    expect(findMcpIntegrationForText("I love Granola")).toBeNull();
    expect(
      findMcpIntegrationForText(
        "Open this meeting: https://app.granola.ai/meeting/123",
      )?.id,
    ).toBe("granola");
    expect(isMcpConnectionFailureText("I can't read that Notion link")).toBe(
      true,
    );
    expect(isMcpConnectionFailureText("I can read it now")).toBe(false);
  });

  it("matches exact display brands and branded aliases only", () => {
    for (const integration of DEFAULT_MCP_INTEGRATIONS) {
      expect(
        findMcpIntegrationForText(
          `Connect ${integration.name} to this workspace`,
          [integration],
        )?.id,
      ).toBe(integration.id);
    }

    const granola = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "granola",
    )!;
    const custom = {
      ...granola,
      id: "internal-notes",
      provider: "internal-notes",
      name: "Acme Notes",
      aliases: ["transcripts"],
      brandAliases: ["Acme Meetings"],
    };

    expect(
      findMcpIntegrationForText("Connect Acme Meetings", [custom])?.id,
    ).toBe("internal-notes");
    expect(
      findMcpIntegrationForText("Connect internal-notes", [custom]),
    ).toBeNull();
    expect(
      findMcpIntegrationForText("Find my transcripts", [custom]),
    ).toBeNull();
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
