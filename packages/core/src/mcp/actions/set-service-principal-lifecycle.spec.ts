import { expect, it } from "vitest";

import setServicePrincipalLifecycle from "./set-service-principal-lifecycle.js";

it("refuses full-app panels", () => {
  expect(setServicePrincipalLifecycle.requiresSignedInBrowser).toBe(true);
});
