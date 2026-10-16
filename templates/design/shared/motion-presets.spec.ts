import { describe, expect, it } from "vitest";

import {
  createMotionPresetTracks,
  createMotionPresetTracksForTargets,
} from "./motion-presets";
import type { MotionPropertyPreset } from "./motion-timeline";

const positionPreset: MotionPropertyPreset = {
  property: "translate",
  label: "Position",
  from: "0px 16px",
  to: "0px 0px",
  group: "primary",
};

describe("createMotionPresetTracks", () => {
  it("starts the preset at the current playhead and fills the remaining timeline", () => {
    const result = createMotionPresetTracks({
      targetNodeId: "hero",
      preset: positionPreset,
      defaultEase: "ease-out",
      currentTimeMs: 750,
      timelineDurationMs: 2000,
    });

    expect(result.timelineDurationMs).toBe(2000);
    expect(result.tracks).toEqual([
      {
        id: expect.any(String),
        targetNodeId: "hero",
        property: "translate",
        composition: "add",
        delayMs: 750,
        durationMs: 1250,
        keyframes: [
          { t: 0, value: "0px 16px", ease: "ease-out" },
          { t: 1, value: "0px 0px", ease: "ease-out" },
        ],
      },
    ]);
  });

  it("creates a useful width and height animation for the Size preset", () => {
    const result = createMotionPresetTracks({
      targetNodeId: "card",
      preset: {
        property: "size",
        label: "Size",
        group: "primary",
        additionalProperties: ["width", "height"],
      },
      defaultEase: "ease",
      currentTimeMs: 0,
      timelineDurationMs: 2000,
      currentValues: { width: "240px", height: "96px" },
    });

    expect(
      result.tracks.map((track) => [track.property, track.keyframes]),
    ).toEqual([
      [
        "width",
        [
          { t: 0, value: "0px", ease: "ease" },
          { t: 1, value: "240px", ease: "ease" },
        ],
      ],
      [
        "height",
        [
          { t: 0, value: "0px", ease: "ease" },
          { t: 1, value: "96px", ease: "ease" },
        ],
      ],
    ]);
  });

  it("adds every size axis when one already has a track", () => {
    const result = createMotionPresetTracks({
      targetNodeId: "card",
      preset: {
        property: "size",
        label: "Size",
        group: "primary",
        additionalProperties: ["width", "height"],
      },
      defaultEase: "ease",
      currentTimeMs: 0,
      timelineDurationMs: 2000,
      currentValues: { width: "240px", height: "96px" },
    });

    expect(result.tracks.map((track) => track.property)).toEqual([
      "width",
      "height",
    ]);
  });

  it("keeps a preset at the endpoint within the current timeline duration", () => {
    const result = createMotionPresetTracks({
      targetNodeId: "hero",
      preset: positionPreset,
      defaultEase: "ease",
      currentTimeMs: 2000,
      timelineDurationMs: 2000,
    });

    expect(result.timelineDurationMs).toBe(2000);
    expect(result.tracks[0]).toMatchObject({ delayMs: 2000, durationMs: 50 });
  });

  it("adds a new track when the preset property already exists", () => {
    const result = createMotionPresetTracks({
      targetNodeId: "hero",
      preset: positionPreset,
      defaultEase: "ease",
      currentTimeMs: 0,
      timelineDurationMs: 2000,
    });

    expect(result.timelineDurationMs).toBe(2000);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      targetNodeId: "hero",
      property: "translate",
    });
  });
});

describe("createMotionPresetTracksForTargets", () => {
  it("applies one preset to every selected layer", () => {
    const result = createMotionPresetTracksForTargets({
      targets: [
        {
          nodeId: "hero",
          label: "Hero",
          currentValues: { width: "240px", height: "96px" },
        },
        {
          nodeId: "card",
          label: "Card",
          currentValues: { width: "160px", height: "72px" },
        },
      ],
      preset: {
        property: "size",
        label: "Size",
        group: "primary",
        additionalProperties: ["width", "height"],
      },
      defaultEase: "ease-out",
      currentTimeMs: 500,
      timelineDurationMs: 2000,
    });

    expect(result.timelineDurationMs).toBe(2000);
    expect(
      result.tracks.map(({ targetNodeId, property, label }) => [
        targetNodeId,
        property,
        label,
      ]),
    ).toEqual([
      ["hero", "width", "Hero"],
      ["hero", "height", "Hero"],
      ["card", "width", "Card"],
      ["card", "height", "Card"],
    ]);
    expect(result.tracks[2]?.keyframes).toEqual([
      { t: 0, value: "0px", ease: "ease-out" },
      { t: 1, value: "160px", ease: "ease-out" },
    ]);
  });
});
