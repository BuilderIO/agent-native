import { describe, expect, it } from "vitest";

import {
  getProviderApiConfig,
  listProviderApiCatalog,
  listProviderApiIdsForTemplateUse,
} from "./provider-api-definitions.js";
import {
  DEFAULT_MCP_INTEGRATIONS,
  McpIntegrationDialog,
  getDefaultMcpIntegrations,
} from "./remote-mcp-presets.js";
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForCapability,
} from "./workspace-connections.js";

describe("ejected catalog wrappers", () => {
  it("lets caller MCP overrides win and injects the merged catalog into UI", () => {
    const github = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "github",
    )!;
    const override = { ...github, name: "App-owned GitHub" };

    expect(
      getDefaultMcpIntegrations(true, [override]).find(
        (integration) => integration.id === "github",
      )?.name,
    ).toBe("App-owned GitHub");

    const element = McpIntegrationDialog({
      open: false,
      onOpenChange() {},
      defaultScope: "user",
      canCreateOrgMcp: false,
      hasOrg: false,
      async onCreateMcpServer() {},
      integrations: [override],
    });
    expect(
      (element.props.integrations as typeof DEFAULT_MCP_INTEGRATIONS).find(
        (integration) => integration.id === "github",
      )?.name,
    ).toBe("App-owned GitHub");
  });

  it("preserves caller workspace overrides in direct and filtered helpers", () => {
    const slack = getWorkspaceConnectionProvider("slack")!;
    const override = {
      ...slack,
      label: "App-owned Slack",
      capabilities: ["docs" as const],
    };

    expect(getWorkspaceConnectionProvider("slack", [override])?.label).toBe(
      "App-owned Slack",
    );
    expect(
      listWorkspaceConnectionProvidersForCapability("docs", [override]).find(
        (provider) => provider.id === "slack",
      )?.label,
    ).toBe("App-owned Slack");
  });

  it("preserves caller provider API overrides across catalog helpers", () => {
    const sentry = getProviderApiConfig("sentry");
    const override = {
      ...sentry,
      label: "App-owned Sentry",
      templateUses: ["mail" as const],
    };

    expect(getProviderApiConfig("sentry", [override]).label).toBe(
      "App-owned Sentry",
    );
    expect(
      listProviderApiCatalog("sentry", {
        providerOverrides: [override],
      })[0]?.label,
    ).toBe("App-owned Sentry");
    expect(listProviderApiIdsForTemplateUse("mail", [override])).toContain(
      "sentry",
    );
  });
});
