import { expect, it } from "vitest";

import bulkUpdateWorkspaceUserGroups from "./bulk-update-workspace-user-groups.js";

it("refuses full-app panels", () => {
  expect(bulkUpdateWorkspaceUserGroups.requiresSignedInBrowser).toBe(true);
});
