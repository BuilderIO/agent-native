import { describe, expect, it } from "vitest";

import type { MotionDockTrack } from "../components/design/MotionDock";
import {
  applyMotionAutoKeyframesForStyles,
  applyMotionStyleKeyframeEdit,
  upsertMotionStyleKeyframes,
} from "./design-editor/motion-state";

function track(overrides: Partial<MotionDockTrack> = {}): MotionDockTrack {
  return {
    targetNodeId: "hero",
    property: "opacity",
    label: "Hero",
    keyframes: [
      { t: 0, value: "0", ease: "linear" },
      { t: 1, value: "1", ease: "linear" },
    ],
    ...overrides,
  };
}

describe("applyMotionAutoKeyframesForStyles (item 7 — motion auto-key wiring)", () => {
  it("keys an already-tracked property at the playhead", () => {
    const tracks = [track()];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { opacity: "0.5" },
      playheadT: 0.5,
      timelineDurationMs: 2000,
    });
    expect(next).not.toBe(tracks);
    const created = next[0]!.keyframes.find((kf) => kf.t === 0.5);
    expect(created?.value).toBe("0.5");
  });

  it("returns the SAME reference (no-op) when nothing is tracked for the node", () => {
    const tracks = [track({ targetNodeId: "other-node" })];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { opacity: "0.5" },
      playheadT: 0.5,
      timelineDurationMs: 2000,
    });
    expect(next).toBe(tracks);
  });

  it("returns the SAME reference when the property has no existing track", () => {
    const tracks = [track({ property: "opacity" })];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { transform: "rotate(45deg)" },
      playheadT: 0.5,
      timelineDurationMs: 2000,
    });
    expect(next).toBe(tracks);
  });

  it("maps camelCase style property names to the track's kebab-case catalog name", () => {
    const tracks = [
      track({
        property: "background-color",
        keyframes: [
          { t: 0, value: "#000" },
          { t: 1, value: "#fff" },
        ],
      }),
    ];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { backgroundColor: "#888888" },
      playheadT: 0.25,
      timelineDurationMs: 1000,
    });
    expect(next).not.toBe(tracks);
    const created = next[0]!.keyframes.find((kf) => kf.t === 0.25);
    expect(created?.value).toBe("#888888");
  });

  it("keys multiple properties from one batched style commit", () => {
    const tracks = [
      track({ property: "opacity" }),
      track({
        property: "transform",
        keyframes: [
          { t: 0, value: "translateX(0px)" },
          { t: 1, value: "translateX(100px)" },
        ],
      }),
    ];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { opacity: "0.4", transform: "translateX(40px)" },
      playheadT: 0.4,
      timelineDurationMs: 1000,
    });
    expect(next).not.toBe(tracks);
    expect(
      next
        .find((t) => t.property === "opacity")!
        .keyframes.some((kf) => kf.t === 0.4 && kf.value === "0.4"),
    ).toBe(true);
    expect(
      next
        .find((t) => t.property === "transform")!
        .keyframes.some(
          (kf) => kf.t === 0.4 && kf.value === "translateX(40px)",
        ),
    ).toBe(true);
  });

  it("skips undefined-value style entries without throwing", () => {
    const tracks = [track()];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { opacity: undefined },
      playheadT: 0.5,
      timelineDurationMs: 2000,
    });
    expect(next).toBe(tracks);
  });

  it("skips non-motion-animatable properties (e.g. display, position)", () => {
    const tracks = [track({ property: "display" })];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { display: "flex" },
      playheadT: 0.5,
      timelineDurationMs: 2000,
    });
    expect(next).toBe(tracks);
  });

  it("preserves an existing keyframe's ease when overwriting its value", () => {
    const tracks = [
      track({
        keyframes: [
          { t: 0, value: "0", ease: "linear" },
          { t: 0.5, value: "0.3", ease: "ease-in" },
          { t: 1, value: "1", ease: "linear" },
        ],
      }),
    ];
    const next = applyMotionAutoKeyframesForStyles(tracks, {
      targetNodeId: "hero",
      styles: { opacity: "0.9" },
      playheadT: 0.5,
      timelineDurationMs: 2000,
      defaultEase: "linear",
    });
    const updated = next[0]!.keyframes.find((kf) => kf.t === 0.5);
    expect(updated).toMatchObject({ value: "0.9", ease: "ease-in" });
  });
});

describe("upsertMotionStyleKeyframes", () => {
  it("creates a track for a newly edited property when auto-keyframing is on", () => {
    expect(
      upsertMotionStyleKeyframes({
        tracks: [],
        targetNodeId: "hero",
        label: "Hero",
        styles: { opacity: "0.5" },
        computedStyles: { opacity: "1" },
        playhead: 0.5,
        timelineDurationMs: 2000,
      }),
    ).toEqual([
      {
        targetNodeId: "hero",
        property: "opacity",
        keyframes: [
          { t: 0, value: "1", ease: "ease" },
          { t: 0.5, value: "0.5", ease: "ease" },
          { t: 1, value: "1", ease: "ease" },
        ],
        label: "Hero",
      },
    ]);
  });

  it("uses track-local time when inserting a keyframe in an existing track", () => {
    const tracks = [
      track({
        delayMs: 250,
        durationMs: 500,
        keyframes: [
          { t: 0, value: "0", ease: "linear" },
          { t: 1, value: "1", ease: "ease-in" },
        ],
      }),
    ];
    const next = upsertMotionStyleKeyframes({
      tracks,
      targetNodeId: "hero",
      label: "Hero",
      styles: { opacity: "0.8" },
      playhead: 0.5,
      timelineDurationMs: 1000,
      defaultEase: "ease-out",
    });

    expect(next[0]?.keyframes).toEqual([
      { t: 0, value: "0", ease: "linear" },
      { t: 0.5, value: "0.8", ease: "ease-out" },
      { t: 1, value: "1", ease: "ease-in" },
    ]);
  });

  it("preserves easing when replacing an existing keyframe value", () => {
    const next = upsertMotionStyleKeyframes({
      tracks: [
        track({
          keyframes: [
            { t: 0, value: "0", ease: "linear" },
            { t: 0.5, value: "0.3", ease: "ease-in" },
            { t: 1, value: "1", ease: "linear" },
          ],
        }),
      ],
      targetNodeId: "hero",
      label: "Hero",
      styles: { opacity: "0.8" },
      playhead: 0.5,
      timelineDurationMs: 1000,
      defaultEase: "ease-out",
    });

    expect(next[0]?.keyframes).toEqual([
      { t: 0, value: "0", ease: "linear" },
      { t: 0.5, value: "0.8", ease: "ease-in" },
      { t: 1, value: "1", ease: "linear" },
    ]);
  });
});

describe("applyMotionStyleKeyframeEdit", () => {
  it("creates a track for a new property when auto-keyframing is on", () => {
    const next = applyMotionStyleKeyframeEdit([], {
      targetNodeId: "hero",
      label: "Hero",
      styles: { opacity: "0.5" },
      computedStyles: { opacity: "1" },
      playhead: 0.5,
      timelineDurationMs: 2000,
      autoKeyframeEnabled: true,
    });

    expect(next[0]?.keyframes).toEqual([
      { t: 0, value: "1", ease: "ease" },
      { t: 0.5, value: "0.5", ease: "ease" },
      { t: 1, value: "1", ease: "ease" },
    ]);
  });

  it("updates an existing track at the playhead when auto-keyframing is off", () => {
    const next = applyMotionStyleKeyframeEdit([track()], {
      targetNodeId: "hero",
      label: "Hero",
      styles: { opacity: "0.5" },
      playhead: 0.5,
      timelineDurationMs: 2000,
      defaultEase: "ease",
      autoKeyframeEnabled: false,
    });

    expect(next[0]?.keyframes).toEqual([
      { t: 0, value: "0", ease: "linear" },
      { t: 0.5, value: "0.5", ease: "ease" },
      { t: 1, value: "1", ease: "linear" },
    ]);
  });

  it("does not create a track when auto-keyframing is off", () => {
    const tracks: MotionDockTrack[] = [];
    expect(
      applyMotionStyleKeyframeEdit(tracks, {
        targetNodeId: "hero",
        label: "Hero",
        styles: { opacity: "0.5" },
        playhead: 0.5,
        timelineDurationMs: 2000,
        autoKeyframeEnabled: false,
      }),
    ).toBe(tracks);
  });
});
