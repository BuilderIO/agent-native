import { expect, it } from "vitest";

import type { ActionRunContext } from "../../action.js";
import deleteWorkspaceUserGroup from "./delete-workspace-user-group.js";

it("refuses full-app panels", () => {
  expect(deleteWorkspaceUserGroup.requiresSignedInBrowser).toBe(true);
});

it("serves delete-workspace-user-group to outside agents unlisted, and asks only them to approve it", async () => {
  expect(deleteWorkspaceUserGroup.mcpTool).toBe("search");
  const approves = deleteWorkspaceUserGroup.needsApproval as (
    args: unknown,
    ctx?: ActionRunContext,
  ) => boolean | Promise<boolean>;
  expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
    false,
  );
  expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(true);
});
