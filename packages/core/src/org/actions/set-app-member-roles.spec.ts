import { expect, it } from "vitest";

import setAppMemberRoles from "./set-app-member-roles.js";

it("refuses full-app panels", () => {
  expect(setAppMemberRoles.requiresSignedInBrowser).toBe(true);
});
