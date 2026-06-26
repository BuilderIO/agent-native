import { describe, expect, it } from "vitest";

import { buildPickerChatHandoffPrompt } from "./picker-chat-handoff";

describe("buildPickerChatHandoffPrompt", () => {
  it("builds a complete image generation handoff for Assets chat", () => {
    expect(
      buildPickerChatHandoffPrompt({
        mediaType: "image",
        prompt: "A cinematic product hero",
        count: 3,
        aspectRatio: "16:9",
        libraryId: "lib_123",
        libraryTitle: "Launch kit",
        presetId: "preset_hero",
        presetTitle: "Hero",
        tier: "quality",
        styleStrength: "strong",
        includeLogo: true,
      }),
    ).toBe(
      [
        "Generate 3 image candidates in Assets for this request:",
        "A cinematic product hero",
        "Use the selected library: Launch kit (lib_123).",
        "Use the selected preset: Hero (preset_hero).",
        "Use aspect ratio 16:9.",
        "Use quality tier quality.",
        "Use style strength strong.",
        "Include the library logo if available.",
        "Open the picker with the generated candidates so I can choose.",
      ].join("\n"),
    );
  });

  it("clamps image candidate count and omits empty metadata", () => {
    expect(
      buildPickerChatHandoffPrompt({
        mediaType: "image",
        prompt: "Single banner",
        count: 12,
        aspectRatio: "",
        libraryTitle: " ",
      }),
    ).toBe(
      [
        "Generate 6 image candidates in Assets for this request:",
        "Single banner",
        "Open the picker with the generated candidates so I can choose.",
      ].join("\n"),
    );
  });

  it("builds a video handoff without image-only settings", () => {
    expect(
      buildPickerChatHandoffPrompt({
        mediaType: "video",
        prompt: "A short launch teaser",
        aspectRatio: "9:16",
      }),
    ).toBe(
      [
        "Generate a video asset in Assets for this request:",
        "A short launch teaser",
        "Open the picker with the generated candidates so I can choose.",
      ].join("\n"),
    );
  });
});
