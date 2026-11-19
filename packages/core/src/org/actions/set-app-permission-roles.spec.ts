import { expect, it } from "vitest";

import setAppPermissionRoles from "./set-app-permission-roles.js";

it("refuses full-app panels", () => {
  expect(setAppPermissionRoles.requiresSignedInBrowser).toBe(true);
});
