import { describe, expect, it } from "vitest";

import type { ActionRunContext } from "../../action.js";
import listResourceShares from "./list-resource-shares.js";
import shareResource from "./share-resource.js";
import unshareResource from "./unshare-resource.js";

describe("sharing actions over MCP", () => {
  it.each([
    ["list-resource-shares", listResourceShares],
    ["share-resource", shareResource],
  ] as const)(
    "serves %s to outside agents unlisted, through tool search",
    (_name, action) => {
      expect(action.mcpTool).toBe("search");
    },
  );
  it("serves unshare-resource unlisted, and asks only outside agents to approve it", async () => {
    expect(unshareResource.mcpTool).toBe("search");
    const approves = unshareResource.needsApproval as (
      args: unknown,
      ctx?: ActionRunContext,
    ) => boolean | Promise<boolean>;
    expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
      false,
    );
    expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(
      true,
    );
  });
  it("lets a person remove access from a directory widget without asking", async () => {
    const approves = unshareResource.needsApproval as (
      args: unknown,
      ctx?: ActionRunContext,
    ) => boolean | Promise<boolean>;
    expect(
      await approves({}, {
        caller: "mcp",
        mcpDirectoryWidgetWrite: {
          appId: "content",
          resourceIds: { resourceType: "document", documentId: "doc-1" },
          actionNames: ["unshare-resource"],
        },
      } as ActionRunContext),
    ).toBe(false);
  });
});
