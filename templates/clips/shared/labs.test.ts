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
});
