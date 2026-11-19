import { expect, it } from "vitest";

import deleteApiKey from "./delete-api-key.js";

it("refuses full-app panels", () => {
  expect(deleteApiKey.requiresSignedInBrowser).toBe(true);
});
