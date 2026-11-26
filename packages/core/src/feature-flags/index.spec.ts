import { describe, expect, it } from "vitest";

import * as featureFlags from "./index.js";
import * as store from "./store.js";

describe("@agent-native/core/feature-flags", () => {
  it("exports the strict evaluator, for callers that must tell an unreadable flag apart from off", () => {
    expect(featureFlags.evaluateFeatureFlagStrict).toBe(
      store.evaluateFeatureFlagStrict,
    );
  });
});
