import { describe, expect, it } from "vitest";

import {
  applyMotionPathEdit,
  parseMotionPathEditMessage,
} from "./motion-path-edit";
import { motionPathTrackForTarget } from "./motion-types";

const track = {
  targetNodeId: "node-1",
  property: "translate",
  keyframes: [
    { t: 0, value: "0px 0px", ease: "linear" },
    { t: 1, value: "120px 40px", ease: "ease" },
  ],
};

describe("motionPathTrackForTarget", () => {
  it("prefers an authored translate track over a native Position style", () => {
    const authoredTrack = { ...track, keyframes: [...track.keyframes] };
    const nativePositionTrack = {
      ...authoredTrack,
      nativeStyleIndex: 0,
    };

    expect(
      motionPathTrackForTarget([nativePositionTrack, authoredTrack], "node-1"),
    ).toBe(authoredTrack);
  });

  it("uses a native Position style when there is no authored translate track", () => {
    const nativePositionTrack = {
      ...track,
      nativeStyleIndex: 0,
    };

    expect(motionPathTrackForTarget([nativePositionTrack], "node-1")).toBe(
      nativePositionTrack,
    );
  });
});

describe("applyMotionPathEdit", () => {
  it("updates a selected position keyframe value", () => {
    expect(
      applyMotionPathEdit(track, {
        targetNodeId: "node-1",
        edits: [{ keyframeT: 1, value: "80px 64px" }],
      })?.keyframes[1],
    ).toEqual({ t: 1, value: "80px 64px", ease: "ease" });
  });

  it("accepts only scoped, well-formed bridge messages", () => {
    expect(
      parseMotionPathEditMessage(
        {
          type: "motion-path-edit",
          targetNodeId: "node-1",
          edits: [{ keyframeT: 1, value: "80px 64px" }],
        },
        "node-1",
      ),
    ).toEqual({
      targetNodeId: "node-1",
      edits: [{ keyframeT: 1, value: "80px 64px" }],
    });
    expect(
      parseMotionPathEditMessage(
        {
          type: "motion-path-edit",
          targetNodeId: "node-2",
          edits: [{ keyframeT: 1, value: "80px 64px" }],
        },
        "node-1",
      ),
    ).toBeNull();
    expect(
      parseMotionPathEditMessage(
        {
          type: "motion-path-edit",
          targetNodeId: "node-1",
          edits: [{ keyframeT: 1, value: "80px 64px", extra: true }],
        },
        "node-1",
      ),
    ).toBeNull();
  });

  it("applies endpoint and adjacent path changes atomically", () => {
    const updated = applyMotionPathEdit(track, {
      targetNodeId: "node-1",
      edits: [
        { keyframeT: 1, value: "80px 64px" },
        {
          keyframeT: 1,
          segmentStartT: 0,
          motionPath: {
            version: 1,
            type: "cubic",
            control1: { x: 24, y: -12 },
            control2: { x: -16, y: 8 },
          },
        },
      ],
    });
    expect(updated?.keyframes).toEqual([
      {
        t: 0,
        value: "0px 0px",
        ease: "linear",
        motionPath: {
          version: 1,
          type: "cubic",
          control1: { x: 24, y: -12 },
          control2: { x: -16, y: 8 },
        },
      },
      { t: 1, value: "80px 64px", ease: "ease" },
    ]);
  });

  it("removes a cubic segment while preserving keyframe data", () => {
    const curved = {
      ...track,
      keyframes: [
        {
          ...track.keyframes[0],
          motionPath: {
            version: 1 as const,
            type: "cubic" as const,
            control1: { x: 10, y: 10 },
            control2: { x: -10, y: -10 },
          },
        },
        track.keyframes[1],
      ],
    };
    expect(
      applyMotionPathEdit(curved, {
        targetNodeId: "node-1",
        edits: [{ keyframeT: 0, motionPath: null }],
      })?.keyframes[0],
    ).toEqual({ t: 0, value: "0px 0px", ease: "linear" });
  });

  it("rejects edits outside the selected 2D Position track", () => {
    expect(
      applyMotionPathEdit(track, {
        targetNodeId: "node-2",
        edits: [{ keyframeT: 1, value: "80px 64px" }],
      }),
    ).toBeNull();
    expect(
      applyMotionPathEdit(
        { ...track, property: "opacity" },
        {
          targetNodeId: "node-1",
          edits: [{ keyframeT: 1, value: "0px 64px" }],
        },
      ),
    ).toBeNull();
  });

  it("rejects missing keyframes, unsupported units, and invalid geometry", () => {
    expect(
      applyMotionPathEdit(track, {
        targetNodeId: "node-1",
        edits: [{ keyframeT: 0.5, value: "80px 64px" }],
      }),
    ).toBeNull();
    expect(
      applyMotionPathEdit(track, {
        targetNodeId: "node-1",
        edits: [{ keyframeT: 1, value: "80% 64px" }],
      }),
    ).toBeNull();
    expect(
      applyMotionPathEdit(track, {
        targetNodeId: "node-1",
        edits: [
          {
            keyframeT: 0,
            motionPath: {
              version: 1,
              type: "cubic",
              control1: { x: Number.NaN, y: 0 },
              control2: { x: 0, y: 0 },
            },
          },
        ],
      }),
    ).toBeNull();
  });
});
