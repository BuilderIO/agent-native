import { expect, it } from "vitest";

import type { ActionRunContext } from "../../action.js";
import upsertWorkspaceUserGroup from "./upsert-workspace-user-group.js";

it("refuses full-app panels", () => {
  expect(upsertWorkspaceUserGroup.requiresSignedInBrowser).toBe(true);
});

it("serves upsert-workspace-user-group to outside agents unlisted, and asks only them to approve it", async () => {
  expect(upsertWorkspaceUserGroup.mcpTool).toBe("search");
  const approves = upsertWorkspaceUserGroup.needsApproval as (
    args: unknown,
    ctx?: ActionRunContext,
  ) => boolean | Promise<boolean>;
  expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
    false,
  );
  expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(true);
});
