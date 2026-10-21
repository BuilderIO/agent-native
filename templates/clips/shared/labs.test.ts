import { describe, expect, it } from "vitest";

import {
  CLIPS_LOOKBACK_CONTEXT,
  CLIPS_VOICE_DICTATION,
  isLabEnabled,
} from "./labs";

describe("Clips earlier screen time lab", () => {
  it("is on by default, and an explicit opt-out still turns it off", () => {
    expect(CLIPS_LOOKBACK_CONTEXT.defaultEnabled).toBe(true);
    expect(isLabEnabled({}, CLIPS_LOOKBACK_CONTEXT)).toBe(true);
    expect(
      isLabEnabled(
        { [CLIPS_LOOKBACK_CONTEXT.key]: false },
        CLIPS_LOOKBACK_CONTEXT,
      ),
    ).toBe(false);
  });
});

describe("Clips voice dictation lab", () => {
  it("keeps Dictate enabled by default", () => {
    expect(CLIPS_VOICE_DICTATION.defaultEnabled).toBe(true);
  });

  it("uses the default until values load, while honoring an explicit opt-out", () => {
    expect(isLabEnabled({}, CLIPS_VOICE_DICTATION)).toBe(true);
    expect(
      isLabEnabled(
        { [CLIPS_VOICE_DICTATION.key]: false },
        CLIPS_VOICE_DICTATION,
      ),
    ).toBe(false);
  });

  it("keeps a corrupt Lab from disabling an unrelated Lab", () => {
    expect(
      isLabEnabled(
        { "clips.video-editing": { error: "invalid-choice" } },
        CLIPS_VOICE_DICTATION,
      ),
    ).toBe(true);
    expect(
      isLabEnabled(
        { [CLIPS_VOICE_DICTATION.key]: { error: "invalid-choice" } },
        CLIPS_VOICE_DICTATION,
      ),
    ).toBe(false);
  });
});
