import { describe, expect, it } from "vitest";

import type { ActionRunContext } from "../../action.js";
import createResourceVersion from "./create-resource-version.js";
import getResourceVersion from "./get-resource-version.js";
import listResourceHistory from "./list-resource-history.js";
import listResourceVersions from "./list-resource-versions.js";
import restoreResourceVersion from "./restore-resource-version.js";

describe("history actions over MCP", () => {
  it.each([
    ["create-resource-version", createResourceVersion],
    ["get-resource-version", getResourceVersion],
    ["list-resource-history", listResourceHistory],
    ["list-resource-versions", listResourceVersions],
  ] as const)(
    "serves %s to outside agents unlisted, through tool search",
    (_name, action) => {
      expect(action.mcpTool).toBe("search");
    },
  );
  it("serves restore-resource-version unlisted, and asks only outside agents to approve it", async () => {
    expect(restoreResourceVersion.mcpTool).toBe("search");
    const approves = restoreResourceVersion.needsApproval as (
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
});
