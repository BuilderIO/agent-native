import { expect, it } from "vitest";

import createOrgServiceToken from "./create-org-service-token.js";

it("refuses full-app panels", () => {
  expect(createOrgServiceToken.requiresSignedInBrowser).toBe(true);
});
