import { FIRST_RUN_BUILDER_CREDITS_V2_FLAG } from "@agent-native/toolkit/app/onboarding/first-run-builder-credits-flag";
import { describe, expect, it } from "vitest";

import {
  CLIPS_FEATURE_FLAGS,
  CLIPS_HOSTED_FREE_CLIPS_FLAG,
  CLIPS_LEGACY_FEATURE_FLAGS,
} from "./feature-flags.js";

describe("Clips feature flags", () => {
  it("registers first-run credits v2 default-off and outside legacy migration", () => {
    expect(FIRST_RUN_BUILDER_CREDITS_V2_FLAG).toMatchObject({
      key: "clips-first-run-credits-v2",
      defaultValue: false,
    });
    expect(
      CLIPS_FEATURE_FLAGS.find(
        ({ key }) => key === FIRST_RUN_BUILDER_CREDITS_V2_FLAG.key,
      ),
    ).toEqual(FIRST_RUN_BUILDER_CREDITS_V2_FLAG);
    expect(
      CLIPS_LEGACY_FEATURE_FLAGS.some(
        ({ key }) => key === FIRST_RUN_BUILDER_CREDITS_V2_FLAG.key,
      ),
    ).toBe(false);
  });

  it("registers hosted free Clips as default-off without legacy migration", () => {
    expect(CLIPS_HOSTED_FREE_CLIPS_FLAG).toMatchObject({
      key: "clips-hosted-free-clips",
      defaultValue: false,
    });
    expect(
      CLIPS_FEATURE_FLAGS.find(
        ({ key }) => key === CLIPS_HOSTED_FREE_CLIPS_FLAG.key,
      ),
    ).toEqual(CLIPS_HOSTED_FREE_CLIPS_FLAG);
    expect(
      CLIPS_LEGACY_FEATURE_FLAGS.some(
        ({ key }) => key === CLIPS_HOSTED_FREE_CLIPS_FLAG.key,
      ),
    ).toBe(false);
  });
});
