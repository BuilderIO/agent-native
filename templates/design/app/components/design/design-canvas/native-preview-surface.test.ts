// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { prepareNativePreviewSurface } from "./native-preview-surface";

const html =
  "<!doctype html><html><head></head><body><p>Board</p></body></html>";

describe("native preview surface clock", () => {
  it("pins an optional host epoch on the generated runtime script", () => {
    const epochMs = 1_790_000_000_123.5;
    const prepared = prepareNativePreviewSurface({
      html,
      sandbox: "allow-scripts",
      profile: "overview",
      alwaysRuntime: true,
      initialPixelRatio: 2,
      animationEpochMs: epochMs,
    });
    const document = new DOMParser().parseFromString(
      prepared.html,
      "text/html",
    );
    const script = document.querySelector<HTMLScriptElement>(
      "script[data-agent-native-native-shader-runtime]",
    );
    expect(script?.dataset.agentNativeAnimationEpochMs).toBe(String(epochMs));
    expect(script?.dataset.agentNativeExportInitialPixelRatio).toBe("2");
  });

  it("keeps ordinary documents without a native runtime inert", () => {
    expect(
      prepareNativePreviewSurface({
        html,
        sandbox: "allow-scripts",
        profile: "overview",
        animationEpochMs: 1_790_000_000_123.5,
      }).html,
    ).toBe(html);
  });
});
