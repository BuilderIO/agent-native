import { expect, it } from "vitest";

import changePassword from "./change-password.js";

it("refuses full-app panels", () => {
  expect(changePassword.requiresSignedInBrowser).toBe(true);
});
