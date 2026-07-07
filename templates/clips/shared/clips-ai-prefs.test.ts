import { describe, expect, it } from "vitest";

import {
  buildFullVideoAiInstructions,
  fullVideoAiModelSelection,
  isIncludeFullVideoInAiEnabled,
  withFullVideoAiInstructions,
} from "../shared/clips-ai-prefs.js";

describe("clips-ai-prefs", () => {
  it("defaults includeFullVideoInAi to off", () => {
    expect(isIncludeFullVideoInAiEnabled(undefined)).toBe(false);
    expect(isIncludeFullVideoInAiEnabled({})).toBe(false);
    expect(isIncludeFullVideoInAiEnabled({ includeFullVideoInAi: false })).toBe(
      false,
    );
  });

  it("turns on only for explicit true", () => {
    expect(isIncludeFullVideoInAiEnabled({ includeFullVideoInAi: true })).toBe(
      true,
    );
  });

  it("appends watch-the-clip instructions when enabled", () => {
    const base = "Regenerate the title.";
    expect(withFullVideoAiInstructions(base, "rec-1", false)).toBe(base);
    const withVideo = withFullVideoAiInstructions(base, "rec-1", true);
    expect(withVideo).toContain(base);
    expect(withVideo).toContain("Include full video");
    expect(withVideo).toContain("Gemini");
    expect(withVideo).toContain("get-recording-player-data");
    expect(withVideo).toContain("rec-1");
    expect(buildFullVideoAiInstructions("rec-2")).toContain(
      "create-recording-agent-link",
    );
  });

  it("selects a Gemini Builder model for full-video turns", () => {
    expect(fullVideoAiModelSelection()).toEqual({
      engine: "builder",
      model: "gemini-3-5-flash",
    });
  });
});
