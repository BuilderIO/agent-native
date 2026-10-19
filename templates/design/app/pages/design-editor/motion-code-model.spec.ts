import type { MotionLayerCodeSource } from "@shared/motion-layer-code";
import { createMotionNativeStyleInstance } from "@shared/motion-native-style-runtime";
import { describe, expect, it } from "vitest";

import { buildMotionCodeModel } from "./motion-code-model";

const node = (
  id: string,
  layerName: string,
  children: string[] = [],
  style: Record<string, string> = {},
) => ({
  id,
  layerName,
  children,
  style,
  dataAttributes: { "data-agent-native-node-id": `motion-${id}` },
});

const nodes = [
  node("frame", "Frame", ["card", "title"]),
  node("card", "Card", [], { opacity: "1" }),
  node("title", "Title"),
  node("plain", "Plain"),
];

const source: MotionLayerCodeSource = {
  tracks: [
    {
      id: "card-fade",
      targetNodeId: "motion-card",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    },
  ],
  nativeStyles: [],
  textAnimations: [
    {
      targetNodeId: "motion-title",
      unit: "word",
      direction: "forward",
      staggerMs: 30,
      property: "opacity",
      durationMs: 500,
      keyframes: [{ t: 0, value: "0" }],
    },
  ],
  durationMs: 1000,
  defaultEase: "ease",
};

const target = (id: string, label: string) => ({
  nodeId: `motion-${id}`,
  label,
});

describe("buildMotionCodeModel", () => {
  it("writes CSS with the resting look for a layer that moves", () => {
    const model = buildMotionCodeModel({
      source,
      nodes,
      targets: [target("card", "Card")],
    });
    expect(model.layers[0]?.css?.styles).toContain("  opacity: 1;");
    expect(model.layers[0]?.css?.steps).toContain("@keyframes");
    expect(model.layers[0]?.animatedBelow).toEqual([]);
  });

  it("lists animated layers and no text for a frame", () => {
    const model = buildMotionCodeModel({
      source,
      nodes,
      targets: [target("frame", "Frame")],
    });
    expect(model.layers[0]?.css).toBeNull();
    expect(model.layers[0]?.animatedBelow.map((layer) => layer.label)).toEqual([
      "Card",
      "Title",
    ]);
  });

  it("fills the data form with every animated layer in the selection", () => {
    const model = buildMotionCodeModel({
      source,
      nodes,
      targets: [target("frame", "Frame")],
    });
    expect(
      JSON.parse(model.data).map((layer: { layer: string }) => layer.layer),
    ).toEqual(["Card", "Title"]);
    expect(model.animatedCount).toBe(2);
  });

  it("has nothing to show for a layer without motion", () => {
    const model = buildMotionCodeModel({
      source,
      nodes,
      targets: [target("plain", "Plain")],
    });
    expect(model.layers[0]).toMatchObject({ css: null, animatedBelow: [] });
    expect(model.animatedCount).toBe(0);
  });

  it("leaves text-only motion without CSS but in the data form", () => {
    const model = buildMotionCodeModel({
      source,
      nodes,
      targets: [target("title", "Title")],
    });
    expect(model.layers[0]?.css).toBeNull();
    expect(model.layers[0]?.animated).toBe(true);
    expect(model.animatedCount).toBe(1);
  });

  it("marks a layer without motion as not animated", () => {
    const model = buildMotionCodeModel({
      source,
      nodes,
      targets: [target("plain", "Plain")],
    });
    expect(model.layers[0]?.animated).toBe(false);
  });

  it("includes styles that were added from the add menu", () => {
    const model = buildMotionCodeModel({
      source: {
        ...source,
        nativeStyles: [
          createMotionNativeStyleInstance({
            styleKey: "Rotation",
            targetNodeId: "motion-plain",
          }),
        ],
      },
      nodes,
      targets: [target("plain", "Plain")],
    });
    expect(model.layers[0]?.css?.steps).toContain("rotate");
  });
});
