import { expect, it } from "vitest";

import deleteWorkspaceUserGroup from "./delete-workspace-user-group.js";

it("refuses full-app panels", () => {
  expect(deleteWorkspaceUserGroup.requiresSignedInBrowser).toBe(true);
});
