import { actionsToEngineTools } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import { creativeContextActions } from "./index.js";

const UNION_ACTIONS = [
  "manage-context-pack",
  "manage-brand-profile",
  "manage-context-source",
  "manage-layout-template",
  "review-context-items",
] as const;

describe("creative-context agent input schemas", () => {
  it("advertises every published action with an object-shaped input schema", () => {
    const tools = actionsToEngineTools(creativeContextActions);
    const expectedAgentTools = Object.entries(creativeContextActions)
      .filter(([, action]) => action.agentTool !== false)
      .map(([name]) => name)
      .sort();

    expect(tools.map((tool) => tool.name).sort()).toEqual(expectedAgentTools);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).not.toHaveProperty("anyOf");
      expect(tool.inputSchema).not.toHaveProperty("oneOf");
    }
  });

  it("advertises every management action as an object-shaped agent tool", () => {
    const entries = Object.fromEntries(
      UNION_ACTIONS.map((name) => [name, creativeContextActions[name]]),
    );
    const tools = actionsToEngineTools(entries);

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...UNION_ACTIONS].sort(),
    );
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties?.operation).toBeDefined();
      expect(tool.inputSchema).not.toHaveProperty("anyOf");
      expect(tool.inputSchema).not.toHaveProperty("oneOf");
    }
  });
});
