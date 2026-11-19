import { expect, it } from "vitest";

import { createCustomProviderRegistrationAction } from "./custom-provider-registration.js";

it("refuses full-app panels", () => {
  expect(createCustomProviderRegistrationAction().requiresSignedInBrowser).toBe(
    true,
  );
});
