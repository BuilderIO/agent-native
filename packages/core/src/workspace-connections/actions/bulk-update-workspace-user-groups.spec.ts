import { expect, it } from "vitest";

import type { ActionRunContext } from "../../action.js";
import bulkUpdateWorkspaceUserGroups from "./bulk-update-workspace-user-groups.js";

it("refuses full-app panels", () => {
  expect(bulkUpdateWorkspaceUserGroups.requiresSignedInBrowser).toBe(true);
});

it("serves bulk-update-workspace-user-groups to outside agents unlisted, and asks only them to approve it", async () => {
  const { default: action } =
    await import("./bulk-update-workspace-user-groups.js");
  expect(action.mcpTool).toBe("search");
  const approves = action.needsApproval as (
    args: unknown,
    ctx?: ActionRunContext,
  ) => boolean | Promise<boolean>;
  expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
    false,
  );
  expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(true);
});
