import { describe, expect, it } from "vitest";

import { CLIPS_WISPRFLOW } from "./labs";

describe("Clips voice dictation lab", () => {
  it("keeps Dictate enabled by default", () => {
    expect(CLIPS_WISPRFLOW.defaultEnabled).toBe(true);
  });
});
