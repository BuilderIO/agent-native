import { describe, expect, it } from "vitest";

import {
  CLIPS_FEATURE_FLAGS,
  CLIPS_FIRST_RUN_CREDITS_V2_FLAG,
  CLIPS_HOSTED_FREE_CLIPS_FLAG,
  CLIPS_LEGACY_FEATURE_FLAGS,
} from "./feature-flags.js";

describe("Clips feature flags", () => {
  it("registers first-run credits v2 default-off and outside legacy migration", () => {
    expect(CLIPS_FIRST_RUN_CREDITS_V2_FLAG).toMatchObject({
      key: "clips-first-run-credits-v2",
      defaultValue: false,
    });
    expect(
      CLIPS_FEATURE_FLAGS.find(
        ({ key }) => key === CLIPS_FIRST_RUN_CREDITS_V2_FLAG.key,
      ),
    ).toEqual(CLIPS_FIRST_RUN_CREDITS_V2_FLAG);
    expect(
      CLIPS_LEGACY_FEATURE_FLAGS.some(
        ({ key }) => key === CLIPS_FIRST_RUN_CREDITS_V2_FLAG.key,
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
