import { describe, expect, it } from "vitest";

import {
  motionAnimatedNodeIds,
  motionLayerCss,
  motionLayersData,
  type MotionLayerCodeSource,
} from "./motion-layer-code";
import { createMotionNativeStyleInstance } from "./motion-native-style-runtime";

const source: MotionLayerCodeSource = {
  tracks: [
    {
      id: "fade",
      targetNodeId: "hero",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    },
    {
      id: "other",
      targetNodeId: "card",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0.5" },
        { t: 1, value: "1" },
      ],
    },
  ],
  nativeStyles: [],
  textAnimations: [],
  durationMs: 1000,
  defaultEase: "ease",
  playbackMode: "loop",
};

describe("motionLayerCss", () => {
  it("splits one layer's CSS into a styles section and a steps section", () => {
    const css = motionLayerCss(source, "hero");
    expect(css?.styles).toContain('[data-agent-native-node-id="hero"]');
    expect(css?.styles).toContain("animation-iteration-count: infinite;");
    expect(css?.styles).not.toContain("@keyframes");
    expect(css?.steps).toContain("@keyframes an-motion-hero--opacity");
    expect(css?.steps).not.toContain("card");
  });

  it("writes resting values only for animated properties", () => {
    const css = motionLayerCss(source, "hero", {
      opacity: "1",
      color: "red",
    });
    expect(css?.styles).toContain("  opacity: 1;");
    expect(css?.styles).not.toContain("color");
  });

  it("follows the next edit to the timeline", () => {
    const before = motionLayerCss(source, "hero");
    const lengthened = motionLayerCss(
      { ...source, playbackMode: "once", durationMs: 2000 },
      "hero",
    );
    expect(lengthened?.styles).toContain("animation-duration: 2s;");
    expect(lengthened?.styles).not.toContain("animation-iteration-count");
    expect(before?.styles).toContain("animation-duration: 1s;");
  });

  it("includes tracks that come from a ready-made style", () => {
    const css = motionLayerCss(
      {
        ...source,
        tracks: [],
        nativeStyles: [
          createMotionNativeStyleInstance({
            styleKey: "Opacity",
            targetNodeId: "hero",
          }),
        ],
      },
      "hero",
    );
    expect(css?.steps).toContain("@keyframes");
  });

  it("returns null for a layer without track motion", () => {
    expect(motionLayerCss(source, "missing")).toBeNull();
  });
});

describe("motionAnimatedNodeIds", () => {
  it("lists layers that move through tracks, styles, or text", () => {
    const ids = motionAnimatedNodeIds({
      ...source,
      nativeStyles: [
        createMotionNativeStyleInstance({
          styleKey: "Scale",
          targetNodeId: "badge",
        }),
      ],
      textAnimations: [
        {
          targetNodeId: "title",
          unit: "word",
          direction: "forward",
          staggerMs: 30,
          property: "opacity",
          durationMs: 500,
          keyframes: [{ t: 0, value: "0" }],
        },
      ],
    });
    expect([...ids].sort()).toEqual(["badge", "card", "hero", "title"]);
  });
});

describe("motionLayersData", () => {
  it("writes every given layer with its tracks", () => {
    const data = JSON.parse(
      motionLayersData(source, [
        { nodeId: "hero", label: "Hero" },
        { nodeId: "card", label: "Card" },
      ]),
    );
    expect(data.map((layer: { layer: string }) => layer.layer)).toEqual([
      "Hero",
      "Card",
    ]);
    expect(data[0].tracks[0]).toEqual({
      property: "opacity",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    });
  });
});
