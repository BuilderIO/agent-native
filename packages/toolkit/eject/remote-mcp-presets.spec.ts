import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MCP_INTEGRATIONS,
  McpIntegrationDialog,
  getDefaultMcpIntegrations,
} from "../src/app/eject/remote-mcp-presets.js";

describe("ejected MCP preset UI", () => {
  it("lets caller overrides win and injects the merged catalog into UI", () => {
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

  it("filters ejected UI integrations by config without dropping overrides", () => {
    vi.stubGlobal("__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__", {
      defaults: {
        include: ["github", "hubspot"],
        exclude: ["hubspot"],
      },
    });
    const github = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "github",
    )!;
    const override = { ...github, name: "App-owned GitHub" };

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
      (element.props.integrations as typeof DEFAULT_MCP_INTEGRATIONS).map(
        ({ id, name }) => ({ id, name }),
      ),
    ).toEqual([{ id: "github", name: "App-owned GitHub" }]);
  });
});
