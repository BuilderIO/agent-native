import { expect, it } from "vitest";

import setWorkspaceAppAccess from "./set-workspace-app-access.js";

it("refuses full-app panels", () => {
  expect(setWorkspaceAppAccess.requiresSignedInBrowser).toBe(true);
});
