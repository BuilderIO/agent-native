import { describe, expect, it } from "vitest";

import { createMotionAnimationStyleTracks } from "./motion-animation-style";

describe("createMotionAnimationStyleTracks", () => {
  it("creates the composite Size properties together at the playhead", () => {
    const result = createMotionAnimationStyleTracks({
      targets: [
        {
          nodeId: "hero",
          label: "Hero",
          currentValues: { width: "320px", height: "180px" },
        },
      ],
      style: {
        label: "Size",
        kind: "composite",
        preset: {
          property: "size",
          label: "Size",
          group: "primary",
          additionalProperties: ["width", "height"],
        },
      },
      defaultEase: "ease-out",
      currentTimeMs: 400,
      timelineDurationMs: 1000,
      existingTracks: [],
    });

    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map(({ property }) => property)).toEqual([
      "width",
      "height",
    ]);
    expect(result.tracks).toMatchObject([
      {
        delayMs: 400,
        durationMs: 600,
        keyframes: [{ value: "0px" }, { value: "320px" }],
      },
      {
        delayMs: 400,
        durationMs: 600,
        keyframes: [{ value: "0px" }, { value: "180px" }],
      },
    ]);
  });

  it("preserves existing properties while creating the selected individual style", () => {
    const existingTracks = [
      {
        targetNodeId: "hero",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ];
    const result = createMotionAnimationStyleTracks({
      targets: [{ nodeId: "hero", label: "Hero" }],
      style: {
        label: "Rotation",
        kind: "individual",
        preset: {
          property: "rotate",
          label: "Rotation",
          from: "0deg",
          to: "360deg",
          group: "primary",
        },
      },
      defaultEase: "ease-out",
      currentTimeMs: 500,
      timelineDurationMs: 1000,
      existingTracks,
    });

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      targetNodeId: "hero",
      property: "rotate",
      delayMs: 500,
      durationMs: 500,
    });
  });
});
