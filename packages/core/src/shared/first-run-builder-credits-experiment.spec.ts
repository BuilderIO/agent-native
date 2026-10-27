import { describe, expect, it } from "vitest";

import {
  assignFirstRunBuilderCreditsV2,
  FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
  FIRST_RUN_BUILDER_CREDITS_V2_FLAG_KEY,
} from "./first-run-builder-credits-experiment.js";

describe("first-run Builder credits v2 assignment", () => {
  it("returns no assignment without an authenticated user id", () => {
    expect(assignFirstRunBuilderCreditsV2(undefined)).toBeNull();
    expect(assignFirstRunBuilderCreditsV2(null)).toBeNull();
    expect(assignFirstRunBuilderCreditsV2("  ")).toBeNull();
  });

  it("assigns the same arm for the same authenticated user id", () => {
    const first = assignFirstRunBuilderCreditsV2("auth-user-123");
    expect(first).toEqual(assignFirstRunBuilderCreditsV2("auth-user-123"));
    expect(first).toMatchObject({
      experiment_id: FIRST_RUN_BUILDER_CREDITS_V2_EXPERIMENT_ID,
    });
    expect(["control", "credits"]).toContain(first?.experiment_variant);
  });

  it("uses the experiment id in the stable assignment key", () => {
    const userId = "auth-user-123";
    const first = assignFirstRunBuilderCreditsV2(userId);
    expect(first?.experiment_id).toBe("first_run_builder_credits_v2");
    expect(FIRST_RUN_BUILDER_CREDITS_V2_FLAG_KEY).toBe(
      "clips-first-run-credits-v2",
    );
  });
});
