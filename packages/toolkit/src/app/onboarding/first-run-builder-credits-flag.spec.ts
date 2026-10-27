import { describe, expect, it } from "vitest";

import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG } from "./first-run-builder-credits-flag.js";

describe("first-run Builder credits v2 feature flag", () => {
  it("uses one default-off definition for every onboarding app", () => {
    expect(FIRST_RUN_BUILDER_CREDITS_V2_FLAG).toMatchObject({
      key: "clips-first-run-credits-v2",
      defaultValue: false,
      displayName: "First-run Builder credits v2",
    });
  });
});
