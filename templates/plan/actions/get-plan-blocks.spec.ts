import { describe, expect, it } from "vitest";

import getPlanBlocksAction from "./get-plan-blocks.js";

describe("get-plan-blocks action", () => {
  it("is available in the compact MCP catalog used by PR visual recap CI", () => {
    expect(getPlanBlocksAction.publicAgent).toMatchObject({
      expose: true,
      readOnly: true,
    });
    expect(getPlanBlocksAction.requiresAuth).toBe(false);
    expect(getPlanBlocksAction.mcpApp).toMatchObject({
      compactCatalog: true,
    });
  });

  it("teaches bare top-level prose and valid MDX component closing syntax", async () => {
    const result = (await (
      getPlanBlocksAction.run as (args: {
        format: "reference";
      }) => Promise<unknown>
    )({ format: "reference" })) as { reference: string };

    expect(result.reference).toContain("MDX prose and component syntax");
    expect(result.reference).toContain(
      "write ordinary top-level prose as normal Markdown",
    );
    expect(result.reference).toContain(
      "Never write a bare opening tag like `<RichText ...>`",
    );
  });
});
