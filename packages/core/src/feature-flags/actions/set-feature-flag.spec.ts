import { expect, it } from "vitest";

import setFeatureFlag from "./set-feature-flag.js";

it("refuses full-app panels", () => {
  expect(setFeatureFlag.requiresSignedInBrowser).toBe(true);
});
