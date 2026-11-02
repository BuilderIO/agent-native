import { describe, expect, it } from "vitest";

import {
  CLIPS_FEATURE_FLAGS,
  CLIPS_HOSTED_FREE_CLIPS_FLAG,
  CLIPS_LEGACY_FEATURE_FLAGS,
  CLIPS_PRIVATE_DIAGNOSTIC_CAPTURE_FLAG,
  CLIPS_DIAGNOSTIC_AGENT_GRANTS_FLAG,
} from "./feature-flags.js";

describe("Clips feature flags", () => {
  it("keeps new private capture and grant rollouts off without a legacy opt-in", () => {
    for (const flag of [
      CLIPS_PRIVATE_DIAGNOSTIC_CAPTURE_FLAG,
      CLIPS_DIAGNOSTIC_AGENT_GRANTS_FLAG,
    ]) {
      expect(flag.defaultValue).toBe(false);
      expect(CLIPS_FEATURE_FLAGS).toContainEqual(flag);
      expect(
        CLIPS_LEGACY_FEATURE_FLAGS.some(({ key }) => key === flag.key),
      ).toBe(false);
    }
  });
  // oracle-change: first-run credits is no longer registered as a flag.
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
