import type {
  MotionNativeStyleInstance,
  MotionNativeStyleKey,
} from "@shared/motion-native-style";
import type { MotionEase } from "@shared/motion-timeline";
import {
  MOTION_KEYFRAME_TIME_EPSILON,
  createMotionTrack,
  timelineTimeToTrackTime,
  upsertMotionKeyframeAtTime,
} from "@shared/motion-timeline";

import {
  MOTION_MENU_BASIC_PROPERTIES,
  MOTION_MENU_MORE_PROPERTIES,
  motionControlsOffered,
  type MotionMenuProperty,
} from "@/components/design/edit-panel/motion-controls";
import { parseRotationValue } from "@/components/design/edit-panel/transform-helpers";
import type { MotionDockTrack } from "@/components/design/MotionDock";
import type { ElementInfo } from "@/components/design/types";

import { computedMotionStyleValue } from "./motion-state";
import { isScreenRootElementInfo } from "./selection-state";

/** The order the right-click "next animation style" choice cycles through. */
export const READY_MADE_STYLE_ORDER = [
  "Position",
  "Scale",
  "Rotation",
  "Size",
  "Opacity",
] as const satisfies readonly MotionNativeStyleKey[];

export function selectionHasOutermostFrame(
  elements: readonly ElementInfo[],
): boolean {
  return elements.some(isScreenRootElementInfo);
}

/**
 * A choice is offered only when every selected layer's panel offers it. Null
 * when the selection cannot take motion at all (nothing selected, or it holds
 * a screen's outermost frame).
 */
export function motionMenuProperties(elements: readonly ElementInfo[]): {
  basic: MotionMenuProperty[];
  more: MotionMenuProperty[];
} | null {
  if (elements.length === 0 || selectionHasOutermostFrame(elements)) {
    return null;
  }
  const offered = elements.map(motionControlsOffered);
  const common = (properties: readonly MotionMenuProperty[]) =>
    properties.filter((property) =>
      offered.every((list) => list.includes(property)),
    );
  return {
    basic: common(MOTION_MENU_BASIC_PROPERTIES),
    more: common(MOTION_MENU_MORE_PROPERTIES),
  };
}

function transformAngleDegrees(transform: string): number {
  const matrix = /^matrix\(([^)]+)\)$/.exec(transform);
  if (matrix) {
    const [a = 1, b = 0] = matrix[1]!.split(",").map(Number);
    return Math.round(((Math.atan2(b, a) * 180) / Math.PI) * 10) / 10 || 0;
  }
  return parseRotationValue(transform) || 0;
}

/**
 * The layer's current value for a property, as a keyframe value. The inspector
 * writes rotation into `transform`, so `rotate` alone reads "none" for a
 * layer that is already turned.
 */
export function motionMarkerValue(
  styles: Record<string, string>,
  property: MotionMenuProperty,
): string {
  const read = (name: string) => {
    const value = computedMotionStyleValue(styles, name)?.trim();
    return value || undefined;
  };
  const unset = (value: string | undefined) =>
    value === undefined || value === "none";
  switch (property) {
    case "rotate": {
      const rotate = read("rotate");
      if (!unset(rotate)) return rotate!;
      const transform = read("transform");
      return `${unset(transform) ? 0 : transformAngleDegrees(transform!)}deg`;
    }
    case "translate": {
      const translate = read("translate");
      return unset(translate) ? "0px 0px" : translate!;
    }
    case "scale": {
      const scale = read("scale");
      return unset(scale) ? "1" : scale!;
    }
    case "opacity":
      return read("opacity") ?? "1";
    case "border-radius":
      return read("border-radius") ?? read("border-top-left-radius") ?? "0px";
    case "background-color":
      return read("background-color") ?? "transparent";
    case "border-color":
      return read("border-color") ?? read("border-top-color") ?? "currentcolor";
    case "border-width":
      return read("border-width") ?? read("border-top-width") ?? "0px";
    case "box-shadow":
      return read("box-shadow") ?? "none";
  }
}

/**
 * Adds a keyframe at the playhead on each target's track for the property,
 * creating the track when missing. Never removes: a keyframe already at the
 * playhead stays as it is.
 */
export function addMotionMarkers(args: {
  tracks: MotionDockTrack[];
  targets: ReadonlyArray<{ nodeId: string; label: string; value: string }>;
  property: MotionMenuProperty;
  playhead: number;
  timelineDurationMs: number;
  ease: MotionEase;
}): MotionDockTrack[] {
  const { property, ease, timelineDurationMs } = args;
  const playhead = Math.min(1, Math.max(0, args.playhead));
  return args.targets.reduce((tracks, target) => {
    const index = tracks.findIndex(
      (track) =>
        track.targetNodeId === target.nodeId && track.property === property,
    );
    if (index === -1) {
      return [
        ...tracks,
        {
          ...createMotionTrack(target.nodeId, property, { ease }),
          label: target.label,
          keyframes: [{ t: playhead, value: target.value, ease }],
        },
      ];
    }
    const track = tracks[index]!;
    const t = timelineTimeToTrackTime(
      track,
      playhead * timelineDurationMs,
      timelineDurationMs,
    );
    if (
      track.keyframes.some(
        (keyframe) => Math.abs(keyframe.t - t) <= MOTION_KEYFRAME_TIME_EPSILON,
      )
    ) {
      return tracks;
    }
    return tracks.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? {
            ...candidate,
            keyframes: upsertMotionKeyframeAtTime(candidate.keyframes, {
              t,
              value: target.value,
              ease,
            }),
          }
        : candidate,
    );
  }, args.tracks);
}

/**
 * The style the right-click ready-made choice adds: text cascade for text
 * layers that lack it, otherwise the next style in order the selection lacks,
 * searching on from the last style it already has. Null when none is left.
 */
export function nextReadyMadeStyle(args: {
  targets: ReadonlyArray<{ nodeId: string; isText: boolean }>;
  nativeStyles: ReadonlyArray<
    Pick<MotionNativeStyleInstance, "styleKey" | "targetNodeId">
  >;
}): { styleKey: MotionNativeStyleKey; nodeIds: string[] } | null {
  const lacking = (styleKey: MotionNativeStyleKey) =>
    args.targets
      .filter(
        ({ nodeId }) =>
          !args.nativeStyles.some(
            (style) =>
              style.targetNodeId === nodeId && style.styleKey === styleKey,
          ),
      )
      .map(({ nodeId }) => nodeId);

  if (args.targets.length > 0 && args.targets.every(({ isText }) => isText)) {
    const nodeIds = lacking("TextStagger");
    if (nodeIds.length > 0) return { styleKey: "TextStagger", nodeIds };
  }
  let lastHeld = -1;
  READY_MADE_STYLE_ORDER.forEach((styleKey, index) => {
    if (lacking(styleKey).length === 0) lastHeld = index;
  });
  const count = READY_MADE_STYLE_ORDER.length;
  for (let step = 1; step <= count; step += 1) {
    const styleKey = READY_MADE_STYLE_ORDER[(lastHeld + step) % count]!;
    const nodeIds = lacking(styleKey);
    if (nodeIds.length > 0) return { styleKey, nodeIds };
  }
  return null;
}
