import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

import action from "./run-design-extension-action.js";

describe("run-design-extension-action asset routes", () => {
  it.each(["browse", "insert", "generate"])(
    "routes asset-library %s without delegating to another app",
    async (capabilityId) => {
      const result = (await action.run({
        extensionId: "design.asset-library",
        capabilityId,
      })) as { ok: boolean; route: { action: string; paramHint: string } };

      expect(result.ok).toBe(true);
      expect(result.route.action).not.toBe("call-agent");
      expect(result.route.paramHint).not.toContain("call-agent");
    },
  );

  it("sends generation to the Assets MCP tool and then insert-asset", async () => {
    const result = (await action.run({
      extensionId: "design.asset-library",
      capabilityId: "generate",
    })) as {
      route: { action: string; paramHint: string; mcpTool: boolean };
      nextStep: string;
    };

    expect(result.route.action).toBe("generate-asset");
    expect(result.route.mcpTool).toBe(true);
    expect(result.route.paramHint).toContain("__generate-asset");
    expect(result.route.paramHint).toContain("insert-asset");
    expect(result.route.paramHint).toContain("connect-assets-mcp");
    expect(result.nextStep).toContain('ends in "__generate-asset"');
    expect(result.nextStep).not.toContain('Call the action "generate-asset"');
  });

  it("keeps the plain action wording for Design's own actions", async () => {
    const result = (await action.run({
      extensionId: "design.asset-library",
      capabilityId: "insert",
    })) as { route: { mcpTool: boolean }; nextStep: string };

    expect(result.route.mcpTool).toBe(false);
    expect(result.nextStep).toMatch(/^Call the action "/);
  });
});
