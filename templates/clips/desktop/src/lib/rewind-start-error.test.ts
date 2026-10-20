import { describe, expect, it } from "vitest";

import { getRewindStartErrorKind } from "./rewind-start-error";

describe("getRewindStartErrorKind", () => {
  it.each([
    [
      "Screen Recording permission denied while starting the native screen recorder.",
      "permission",
    ],
    ["Screen capture permission is required.", "permission"],
    [
      "Screen Memory visuals + audio could not start its required ScreenCaptureKit screen, system-audio, and microphone sources: Content unavailable: The user declined TCCs for application, window, display capture",
      "permission",
    ],
    ["Screen Memory capture is currently macOS-only.", "unsupported"],
    ["Not enough disk space to start Screen Memory.", "diskSpace"],
    [
      "Rewind capture settings stay unchanged while a Clip is recording.",
      "recording",
    ],
    ["screen memory directory unavailable: permission denied", "storage"],
    ["app data directory unavailable: path could not be resolved", "storage"],
    ["no app_data_dir", "storage"],
    ["write tmp: permission denied", "storage"],
    ["rename: permission denied", "storage"],
    ["temporary ScreenCaptureKit startup error", "unknown"],
  ] as const)("classifies %s", (error, kind) => {
    expect(getRewindStartErrorKind(error)).toBe(kind);
  });

  it("classifies native string errors", () => {
    expect(
      getRewindStartErrorKind(
        "Screen Recording permission denied while starting capture.",
      ),
    ).toBe("permission");
  });
});
