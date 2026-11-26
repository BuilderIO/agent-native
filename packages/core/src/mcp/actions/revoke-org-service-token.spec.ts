import { expect, it } from "vitest";

import revokeOrgServiceToken from "./revoke-org-service-token.js";

it("refuses full-app panels", () => {
  expect(revokeOrgServiceToken.requiresSignedInBrowser).toBe(true);
});
