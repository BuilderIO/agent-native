import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PR_VISUAL_RECAP_MCP_TOOLS = [
  "get-plan-blocks",
  "create-visual-recap",
  "set-resource-visibility",
] as const;

describe("Plan MCP PR visual recap catalog", () => {
  it("keeps the PR visual recap publishing tools registered and exposed", () => {
    const planRoot = process.cwd();
    const connectorCatalogSource = readFileSync(
      join(planRoot, "server", "lib", "plan-connector-catalog.ts"),
      "utf8",
    );
    const mcpPluginSource = readFileSync(
      join(planRoot, "server", "plugins", "00-mcp.ts"),
      "utf8",
    );
    const agentChatSource = readFileSync(
      join(planRoot, "server", "plugins", "agent-chat.ts"),
      "utf8",
    );

    expect(mcpPluginSource).toContain("mountMCP");
    expect(mcpPluginSource).toContain("PLAN_CONNECTOR_CATALOG");
    expect(agentChatSource).toContain("disableMcp: true");

    for (const tool of PR_VISUAL_RECAP_MCP_TOOLS) {
      expect(connectorCatalogSource).toContain(`"${tool}"`);
    }

    expect(existsSync(join(planRoot, "actions", "get-plan-blocks.ts"))).toBe(
      true,
    );
    expect(
      existsSync(join(planRoot, "actions", "create-visual-recap.ts")),
    ).toBe(true);
    expect(
      existsSync(
        join(
          planRoot,
          "..",
          "..",
          "packages",
          "core",
          "src",
          "sharing",
          "actions",
          "set-resource-visibility.ts",
        ),
      ),
    ).toBe(true);
  });
});
