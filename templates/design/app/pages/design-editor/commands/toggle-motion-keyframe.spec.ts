import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MotionDockTrack } from "@/components/design/MotionDock";
import type { ElementInfo } from "@/components/design/types";

import { runToggleMotionKeyframe } from "./toggle-motion-keyframe";

describe("runToggleMotionKeyframe", () => {
  it("removes a track when its final keyframe is toggled off", () => {
    let tracks: MotionDockTrack[] = [
      {
        targetNodeId: "hero",
        property: "translate",
        label: "Hero",
        keyframes: [
          { t: 0, value: "0px 16px", ease: "ease" },
          { t: 1, value: "0px 0px", ease: "ease" },
        ],
      },
    ];
    const playheadRef = { current: 1 };
    const setMotionTracks: Dispatch<SetStateAction<MotionDockTrack[]>> = (
      update,
    ) => {
      tracks = typeof update === "function" ? update(tracks) : update;
    };
    const args = {
      canEditDesign: true,
      markMotionTracksDirty: vi.fn(),
      motionDefaultEase: "ease",
      motionLivePlayheadRef: playheadRef,
      motionPlayhead: 0,
      selectedCodeLayerNode: null,
      selectedElement: null,
      selectedMotionTargetNodeId: "hero",
      setMotionTracks,
    };

    runToggleMotionKeyframe(args, "translate");
    expect(tracks[0]?.keyframes).toHaveLength(1);

    playheadRef.current = 0;
    runToggleMotionKeyframe(args, "translate");
    expect(tracks).toEqual([]);
    expect(args.markMotionTracksDirty).toHaveBeenCalledTimes(2);
  });

  it("creates keyframe tracks for gap and side-specific padding", () => {
    let tracks: MotionDockTrack[] = [];
    const setMotionTracks: Dispatch<SetStateAction<MotionDockTrack[]>> = (
      update,
    ) => {
      tracks = typeof update === "function" ? update(tracks) : update;
    };
    const args = {
      canEditDesign: true,
      markMotionTracksDirty: vi.fn(),
      motionDefaultEase: "ease",
      motionLivePlayheadRef: { current: 0.5 },
      motionPlayhead: 0,
      selectedCodeLayerNode: null,
      selectedElement: {
        tagName: "div",
        classes: [],
        isFlexChild: false,
        isFlexContainer: false,
        computedStyles: { gap: "12px", paddingLeft: "16px" },
        boundingRect: { x: 0, y: 0, width: 100, height: 100 },
      } as ElementInfo,
      selectedMotionTargetNodeId: "hero",
      setMotionTracks,
    };

    runToggleMotionKeyframe(args, "gap");
    runToggleMotionKeyframe(args, "padding-left");

    expect(
      tracks.map(({ property, keyframes }) => [property, keyframes]),
    ).toEqual([
      [
        "gap",
        [
          { t: 0, value: "12px", ease: "ease" },
          { t: 0.5, value: "12px", ease: "ease" },
          { t: 1, value: "12px", ease: "ease" },
        ],
      ],
      [
        "padding-left",
        [
          { t: 0, value: "16px", ease: "ease" },
          { t: 0.5, value: "16px", ease: "ease" },
          { t: 1, value: "16px", ease: "ease" },
        ],
      ],
    ]);
    expect(args.markMotionTracksDirty).toHaveBeenCalledTimes(2);
  });
});
