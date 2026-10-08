import { describe, expect, it } from "vitest";

import {
  getDefaultMcpIntegrations,
  isMcpIntegrationUrl,
} from "../client/resources/mcp-integration-catalog.js";
import {
  hasMcpProviderMatchRules,
  MCP_PROVIDER_ENDPOINTS,
  mcpServerUrlMatchesProvider,
} from "./mcp-provider-hosts.js";

describe("shared MCP provider matcher parity with the catalog", () => {
  const integrations = getDefaultMcpIntegrations().filter((integration) =>
    integration.url.trim(),
  );

  it("covers a representative set of catalog integrations", () => {
    expect(integrations.length).toBeGreaterThan(30);
  });

  it("matches every catalog integration's canonical endpoint", () => {
    const missed = integrations
      .filter(
        (integration) =>
          mcpServerUrlMatchesProvider(integration.id, integration.url) !== true,
      )
      .map((integration) => `${integration.id} -> ${integration.url}`);

    expect(missed).toEqual([]);
  });

  it("agrees with the catalog matcher for every integration endpoint", () => {
    for (const integration of integrations) {
      expect(isMcpIntegrationUrl(integration, integration.url)).toBe(true);
      expect(mcpServerUrlMatchesProvider(integration.id, integration.url)).toBe(
        true,
      );
    }
  });

  it("keeps the endpoint table in sync with the catalog url", () => {
    for (const integration of integrations) {
      expect(MCP_PROVIDER_ENDPOINTS[integration.id]).toBe(integration.url);
    }
  });

  it("can answer for every catalog provider", () => {
    const unanswerable = integrations
      .filter((integration) => !hasMcpProviderMatchRules(integration.id))
      .map((integration) => integration.id);

    expect(unanswerable).toEqual([]);
  });

  it("does not cross-match one provider's endpoint to another provider", () => {
    const notion = integrations.find(
      (integration) => integration.id === "notion",
    );
    const github = integrations.find(
      (integration) => integration.id === "github",
    );
    expect(notion && github).toBeTruthy();

    expect(mcpServerUrlMatchesProvider("notion", github!.url)).toBe(false);
    expect(mcpServerUrlMatchesProvider("github", notion!.url)).toBe(false);
  });
});
