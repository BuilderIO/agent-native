import {
  DEFAULT_MCP_INTEGRATIONS,
  findMcpIntegrationForText,
  getDefaultMcpIntegrations,
} from "@agent-native/core/client/resources";
import { describe, expect, it } from "vitest";

import { MAIL_NATIVE_MCP_PRESET_EXCLUSIONS } from "./native-mcp-exclusions";

describe("Mail native MCP exclusions", () => {
  it("removes the duplicate Google Workspace setup path", () => {
    const googleWorkspace = DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === "google-workspace",
    );
    const configuredIntegrations = getDefaultMcpIntegrations({
      defaults: { exclude: [...MAIL_NATIVE_MCP_PRESET_EXCLUSIONS] },
    });

    expect(googleWorkspace?.brandAliases).toContain("Gmail");
    expect(
      configuredIntegrations.map((integration) => integration.id),
    ).not.toContain("google-workspace");
    expect(
      findMcpIntegrationForText(
        "Review and prioritize my unread Gmail messages.",
        configuredIntegrations,
      ),
    ).toBeNull();
  });
});
