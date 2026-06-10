import { describe, expect, it } from "vitest";
import getPlanBlocksAction from "./get-plan-blocks.js";

describe("get-plan-blocks action", () => {
  it("is available in the compact MCP catalog used by PR visual recap CI", () => {
    expect(getPlanBlocksAction.publicAgent).toMatchObject({
      expose: true,
      readOnly: true,
    });
    expect(getPlanBlocksAction.mcpApp).toMatchObject({
      compactCatalog: true,
    });
  });
});
