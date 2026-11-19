import { expect, it } from "vitest";

import setPassword from "./set-password.js";

it("refuses full-app panels", () => {
  expect(setPassword.requiresSignedInBrowser).toBe(true);
});
