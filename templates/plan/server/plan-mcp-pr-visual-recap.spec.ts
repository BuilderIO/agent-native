import { describe, expect, it } from "vitest";
import actionsRegistry from "../.generated/actions-registry.js";
import { PLAN_CONNECTOR_CATALOG } from "./plugins/agent-chat.js";

const PR_VISUAL_RECAP_MCP_TOOLS = [
  "get-plan-blocks",
  "create-visual-recap",
  "set-resource-visibility",
] as const;

describe("Plan MCP PR visual recap catalog", () => {
  it("keeps the PR visual recap publishing tools registered and exposed", () => {
    const registeredTools = new Set(Object.keys(actionsRegistry));

    for (const tool of PR_VISUAL_RECAP_MCP_TOOLS) {
      expect(registeredTools).toContain(tool);
      expect(PLAN_CONNECTOR_CATALOG).toContain(tool);
    }
  });
});
