import { expect, it } from "vitest";

import upsertWorkspaceUserGroup from "./upsert-workspace-user-group.js";

it("refuses full-app panels", () => {
  expect(upsertWorkspaceUserGroup.requiresSignedInBrowser).toBe(true);
});
