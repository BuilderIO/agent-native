import { describe, expect, it } from "vitest";

import { CLIPS_WISPRFLOW, isLabEnabled } from "./labs";

describe("Clips voice dictation lab", () => {
  it("keeps Dictate enabled by default", () => {
    expect(CLIPS_WISPRFLOW.defaultEnabled).toBe(true);
  });

  it("uses the default until values load, while honoring an explicit opt-out", () => {
    expect(isLabEnabled({}, CLIPS_WISPRFLOW)).toBe(true);
    expect(
      isLabEnabled({ [CLIPS_WISPRFLOW.key]: false }, CLIPS_WISPRFLOW),
    ).toBe(false);
  });

  it("keeps a corrupt Lab from disabling an unrelated Lab", () => {
    expect(
      isLabEnabled(
        { "clips.video-editing": { error: "invalid-choice" } },
        CLIPS_WISPRFLOW,
      ),
    ).toBe(true);
    expect(
      isLabEnabled(
        { [CLIPS_WISPRFLOW.key]: { error: "invalid-choice" } },
        CLIPS_WISPRFLOW,
      ),
    ).toBe(false);
  });
});
