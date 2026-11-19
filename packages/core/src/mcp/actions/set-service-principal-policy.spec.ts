import { expect, it } from "vitest";

import setServicePrincipalPolicy from "./set-service-principal-policy.js";

it("refuses full-app panels", () => {
  expect(setServicePrincipalPolicy.requiresSignedInBrowser).toBe(true);
});
