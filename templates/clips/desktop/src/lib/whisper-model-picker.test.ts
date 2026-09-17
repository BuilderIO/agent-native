import { describe, expect, it } from "vitest";

import { whisperModelOptionLabel } from "./whisper-model-picker";

describe("Whisper model picker labels", () => {
  it("keeps long descriptions out of the compact trigger label", () => {
    expect(
      whisperModelOptionLabel({
        title: "Large v3 Turbo",
        sizeMb: 1549,
      }),
    ).toBe("Large v3 Turbo · 1549 MB");
  });
});
