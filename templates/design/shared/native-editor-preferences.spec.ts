import { describe, expect, it } from "vitest";

import {
  isEffectPreviewPolicy,
  isUserSettingsContainer,
  parseNativeShaderPreviewPreference,
} from "./native-editor-preferences";

describe("Design editor shader preferences", () => {
  it("keeps inheritance distinct from an explicit policy", () => {
    expect(parseNativeShaderPreviewPreference(undefined)).toEqual({
      status: "absent",
      policy: null,
    });
    expect(parseNativeShaderPreviewPreference(null)).toEqual({
      status: "absent",
      policy: null,
    });
    expect(
      parseNativeShaderPreviewPreference({
        quality: "quality",
        frameRateTarget: 120,
        colorMode: "display-p3",
        dynamicRange: "hdr",
      }),
    ).toEqual({
      status: "ok",
      policy: {
        quality: "quality",
        frameRateTarget: 120,
        colorMode: "display-p3",
        dynamicRange: "hdr",
      },
    });
  });

  it("accepts only object-or-null user settings containers", () => {
    expect(isUserSettingsContainer(null)).toBe(true);
    expect(isUserSettingsContainer({ nativeShaderPreview: null })).toBe(true);
    expect(isUserSettingsContainer("corrupt")).toBe(false);
    expect(isUserSettingsContainer(12)).toBe(false);
    expect(isUserSettingsContainer([])).toBe(false);
  });

  it.each([
    { quality: "fast", frameRateTarget: 60 },
    { quality: "auto", frameRateTarget: 30 },
    { quality: "auto", frameRateTarget: 60, colorMode: "rec2020" },
    { quality: "auto", frameRateTarget: 60, extra: true },
    [],
  ])("rejects malformed or unknown policy values: %j", (value) => {
    expect(isEffectPreviewPolicy(value)).toBe(false);
    expect(parseNativeShaderPreviewPreference(value).status).toBe("invalid");
  });
});
