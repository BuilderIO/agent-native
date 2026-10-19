import { compile } from "./motion-compiler";
import type { MotionEasingVariable } from "./motion-easing";
import type { MotionNativeStyleInstance } from "./motion-native-style";
import { motionNativeStyleTrackGroups } from "./motion-native-style-runtime";
import type { MotionTextAnimation } from "./motion-text-code";
import type {
  MotionEase,
  MotionPlaybackMode,
  MotionTrack,
} from "./motion-timeline";

export interface MotionLayerCodeSource {
  tracks: readonly MotionTrack[];
  nativeStyles: readonly MotionNativeStyleInstance[];
  textAnimations: readonly MotionTextAnimation[];
  durationMs: number;
  defaultEase: MotionEase;
  playbackMode?: MotionPlaybackMode;
  easingVariables?: readonly MotionEasingVariable[];
}

export interface MotionLayerCss {
  /** Resting look plus playback settings of the layer. */
  styles: string;
  /** The keyframe steps, in order. */
  steps: string;
}

function layerTracks(
  source: MotionLayerCodeSource,
  nodeId: string,
): MotionTrack[] {
  const native = motionNativeStyleTrackGroups(source.nativeStyles, {
    trackIds: true,
  }).flat();
  return [...source.tracks, ...native].filter(
    (track) =>
      track.targetNodeId === nodeId &&
      track.enabled !== false &&
      track.keyframes.length > 0,
  );
}

/** Layer ids that have motion of their own, in any form the timeline holds. */
export function motionAnimatedNodeIds(
  source: MotionLayerCodeSource,
): Set<string> {
  return new Set([
    ...source.tracks
      .filter((track) => track.keyframes.length > 0)
      .map((track) => track.targetNodeId),
    ...source.nativeStyles.map((style) => style.targetNodeId),
    ...source.textAnimations.map((animation) => animation.targetNodeId),
  ]);
}

/**
 * The managed CSS for one layer, split into its styles rule and keyframe
 * steps. Null when the layer has no track-based motion to write as CSS.
 * `resting` holds the layer's static values; only animated properties are
 * written. Throws when the layer's tracks cannot compile.
 */
export function motionLayerCss(
  source: MotionLayerCodeSource,
  nodeId: string,
  resting: Readonly<Record<string, string | undefined>> = {},
): MotionLayerCss | null {
  const tracks = layerTracks(source, nodeId);
  if (tracks.length === 0) return null;
  const { css } = compile(
    {
      id: "",
      designId: "",
      sourceRef: null,
      filePath: null,
      tracks,
      durationMs: source.durationMs,
      defaultEase: source.defaultEase,
      playbackMode: source.playbackMode,
      compiledHash: null,
      createdAt: "",
      updatedAt: "",
    },
    { easingVariables: source.easingVariables },
  );
  const blocks = css.split("\n\n");
  const rule = blocks.find((block) => block.startsWith("[data-"));
  if (!rule) return null;
  const restingLines = [...new Set(tracks.map((track) => track.property))]
    .filter((property) => resting[property])
    .map((property) => `  ${property}: ${resting[property]};`);
  const [selector = "", ...declarations] = rule.split("\n");
  return {
    styles: [selector, ...restingLines, ...declarations].join("\n"),
    steps: blocks
      .filter((block) => block.startsWith("@keyframes"))
      .join("\n\n"),
  };
}

/** The given animated layers as JSON text. */
export function motionLayersData(
  source: MotionLayerCodeSource,
  layers: readonly { nodeId: string; label: string }[],
): string {
  const data = layers.map(({ nodeId, label }) => ({
    layer: label,
    nodeId,
    tracks: layerTracks(source, nodeId).map(
      ({ property, delayMs, durationMs, keyframes }) => ({
        property,
        ...(delayMs ? { delayMs } : {}),
        ...(durationMs ? { durationMs } : {}),
        keyframes: keyframes.map(({ t, value, ease }) => ({
          t,
          value,
          ...(ease ? { ease } : {}),
        })),
      }),
    ),
    textAnimations: source.textAnimations.filter(
      (animation) => animation.targetNodeId === nodeId,
    ),
  }));
  return JSON.stringify(data, null, 2);
}
