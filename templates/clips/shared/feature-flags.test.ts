import { describe, expect, it } from "vitest";

import {
  CLIPS_FEATURE_FLAGS,
  CLIPS_HOSTED_FREE_CLIPS_FLAG,
  CLIPS_LEGACY_FEATURE_FLAGS,
} from "./feature-flags.js";

describe("Clips feature flags", () => {
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
