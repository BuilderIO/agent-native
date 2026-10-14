import type { CodeLayerNode } from "@shared/code-layer";
import type { MotionEase } from "@shared/motion-timeline";
import {
  MOTION_PROPERTY_PRESETS,
  createMotionTrack,
  createMotionTrackFromPreset,
  upsertMotionKeyframeAtTime,
} from "@shared/motion-timeline";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { MotionDockTrack } from "@/components/design/MotionDock";
import type { ElementInfo } from "@/components/design/types";
import {
  MOTION_KEYFRAME_TIME_EPSILON,
  computedMotionStyleValue,
  isMotionAnimatableProperty,
} from "@/pages/design-editor/motion-state";

export interface ToggleMotionKeyframeArgs {
  canEditDesign: boolean;
  markMotionTracksDirty: () => void;
  motionDefaultEase: string;
  motionLivePlayheadRef: RefObject<number | null>;
  motionPlayhead: number;
  selectedCodeLayerNode: CodeLayerNode | null;
  selectedElement: ElementInfo | null;
  selectedMotionTargetNodeId: string | null;
  setMotionTracks: Dispatch<SetStateAction<MotionDockTrack[]>>;
}

export function runToggleMotionKeyframe(
  {
    canEditDesign,
    markMotionTracksDirty,
    motionDefaultEase,
    motionLivePlayheadRef,
    motionPlayhead,
    selectedCodeLayerNode,
    selectedElement,
    selectedMotionTargetNodeId,
    setMotionTracks,
  }: ToggleMotionKeyframeArgs,
  cssProperty: string,
) {
  if (!canEditDesign || !selectedMotionTargetNodeId) return;
  const preset = MOTION_PROPERTY_PRESETS.find(
    (candidate) => candidate.property === cssProperty,
  );
  if (!preset && !isMotionAnimatableProperty(cssProperty)) return;
  const activePlayhead = motionLivePlayheadRef.current ?? motionPlayhead;
  const playheadT = Math.max(0, Math.min(1, activePlayhead));
  const measuredDimension =
    cssProperty === "width"
      ? selectedElement?.boundingRect.width
      : cssProperty === "height"
        ? selectedElement?.boundingRect.height
        : undefined;
  const currentValue =
    computedMotionStyleValue(selectedElement?.computedStyles, cssProperty) ??
    preset?.to ??
    (typeof measuredDimension === "number"
      ? `${measuredDimension}px`
      : undefined);
  if (!currentValue) return;
  const label =
    selectedCodeLayerNode?.layerName ||
    selectedElement?.tagName ||
    "Selected element";
  setMotionTracks((current) => {
    const existingIndex = current.findIndex(
      (track) =>
        track.targetNodeId === selectedMotionTargetNodeId &&
        track.property === cssProperty,
    );
    const ease = motionDefaultEase as MotionEase;
    if (existingIndex === -1) {
      const track = preset
        ? createMotionTrackFromPreset(selectedMotionTargetNodeId, preset, ease)
        : createMotionTrack(selectedMotionTargetNodeId, cssProperty, {
            from: currentValue,
            to: currentValue,
            ease,
          });
      const seeded: MotionDockTrack = {
        ...track,
        label,
        keyframes: upsertMotionKeyframeAtTime(
          track.keyframes,
          { t: playheadT, value: currentValue, ease },
          MOTION_KEYFRAME_TIME_EPSILON,
        ),
      };
      return [...current, seeded];
    }
    const track = current[existingIndex]!;
    const existingAtPlayhead = track.keyframes.find(
      (kf) => Math.abs(kf.t - playheadT) <= MOTION_KEYFRAME_TIME_EPSILON,
    );
    const nextKeyframes = existingAtPlayhead
      ? track.keyframes.filter((kf) => kf !== existingAtPlayhead)
      : upsertMotionKeyframeAtTime(
          track.keyframes,
          { t: playheadT, value: currentValue, ease },
          MOTION_KEYFRAME_TIME_EPSILON,
        );
    if (nextKeyframes.length === 0) {
      return current.filter((_, index) => index !== existingIndex);
    }
    return current.map((candidate, index) =>
      index === existingIndex
        ? { ...candidate, keyframes: nextKeyframes }
        : candidate,
    );
  });
  markMotionTracksDirty();
}
