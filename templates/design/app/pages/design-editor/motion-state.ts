import type { CodeLayerProjection } from "@shared/code-layer";
import type { MotionAnimationStyleDefinition } from "@shared/motion-animation-styles";
import type { MotionAudioClip } from "@shared/motion-code";
import type { MotionEasingVariable } from "@shared/motion-easing";
import type { MotionNativeStyleInstance } from "@shared/motion-native-style";
import {
  MOTION_TEXT_PROPERTIES,
  type MotionTextAnimation,
  type MotionTextDocument,
  type MotionTextProperty,
} from "@shared/motion-text-code";
import {
  applyMotionAutoKeyframe,
  type MotionEase,
  type MotionPlaybackMode,
  type MotionTrack,
  MOTION_TIMELINE_MAX_DURATION_MS,
} from "@shared/motion-timeline";

import type { MotionDockTrack } from "@/components/design/MotionDock";

import { camelStyleProperty } from "./style-utils";

export interface MotionTimelineRow {
  id: string | null;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: unknown;
  animationStyles?: MotionAnimationStyleDefinition[];
  nativeStyles?: MotionNativeStyleInstance[];
  easingVariables?: MotionEasingVariable[];
  textDocument?: MotionTextDocument | null;
  audioClips?: MotionAudioClip[];
  durationMs: number;
  playbackMode?: MotionPlaybackMode;
  defaultEase: string;
  compiledHash: string | null;
  cssHash?: string | null;
  source?: "stored" | "recovered-css" | "stored-css-drift";
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MotionTimelineQueryResult {
  designId: string;
  timelines: MotionTimelineRow[];
  count: number;
  recoveryErrors?: Array<{
    sourceRef: string;
    errorCode: string;
    message: string;
  }>;
}

export function hasMotionTimelineContent(args: {
  id: string | null;
  tracks: readonly MotionDockTrack[];
  animationStyles: readonly MotionAnimationStyleDefinition[];
  nativeStyles: readonly MotionNativeStyleInstance[];
  easingVariables: readonly MotionEasingVariable[];
  textDocument: MotionTextDocument | null;
  audioClips: readonly MotionAudioClip[];
}): boolean {
  return Boolean(
    args.id ||
    args.tracks.length ||
    args.animationStyles.length ||
    args.nativeStyles.length ||
    args.easingVariables.length ||
    args.textDocument ||
    args.audioClips.length,
  );
}

export interface SelectedMotionTarget {
  nodeId: string;
  label: string;
  isText: boolean;
}

export interface MotionSourcePreviewProof {
  modulePath: string;
  moduleVersionHash: string;
  renderedNodeIds: string[];
}

export interface MotionSourceWriteCapabilitySnapshot {
  status: "supported" | "unsupported";
  modulePath: string;
  moduleVersionHash: string;
  targetNodeIds: string[];
  code?: string;
  reason?: string;
}

interface MotionTargetInspectorElement {
  sourceLayerIdentity?: { screenId?: string; nodeId?: string };
  textContent?: string;
  tagName: string;
}

interface MotionTargetCodeLayerNode {
  id: string;
  dataAttributes: Readonly<Record<string, string | undefined>>;
  layerName?: string;
  paintsOwnText?: boolean;
}

export function resolveSelectedMotionTargets<
  TElement extends MotionTargetInspectorElement,
>(args: {
  elements: readonly TElement[];
  activeScreenId: string | null | undefined;
  nodes: readonly MotionTargetCodeLayerNode[];
  preferredTarget?: SelectedMotionTarget | null;
}): Array<SelectedMotionTarget & { element: TElement }> {
  const nodesById = new Map(args.nodes.map((node) => [node.id, node]));
  return args.elements.flatMap((element) => {
    const identity = element.sourceLayerIdentity;
    if (
      !identity?.nodeId ||
      !args.activeScreenId ||
      identity.screenId !== args.activeScreenId
    ) {
      return [];
    }

    const layerNode = nodesById.get(identity.nodeId);
    const nodeId =
      layerNode?.dataAttributes["data-agent-native-node-id"]?.trim() ?? "";
    if (!nodeId || !layerNode) return [];

    const textLabel = element.textContent?.trim().replace(/\s+/g, " ");
    return [
      {
        nodeId,
        label:
          args.preferredTarget?.nodeId === nodeId
            ? args.preferredTarget.label
            : layerNode.layerName || textLabel?.slice(0, 48) || element.tagName,
        isText:
          args.preferredTarget?.nodeId === nodeId
            ? args.preferredTarget.isText
            : Boolean(layerNode.paintsOwnText),
        element,
      },
    ];
  });
}

export function motionSourcePreviewProofForTargets(
  projection: CodeLayerProjection,
  targetNodeIds: readonly string[],
): MotionSourcePreviewProof | null {
  if (targetNodeIds.length === 0) return null;
  const targets = [...new Set(targetNodeIds)];
  const nodesByMotionId = new Map<string, MotionSourcePreviewProof>();
  for (const node of projection.nodes) {
    const nodeId = node.dataAttributes["data-agent-native-node-id"]?.trim();
    const modulePath =
      node.dataAttributes["data-agent-native-motion-source-file"]?.trim();
    const moduleVersionHash =
      node.dataAttributes["data-agent-native-motion-source-hash"]?.trim();
    if (
      !nodeId ||
      !modulePath ||
      !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.(?:tsx|jsx|html?)$/i.test(
        modulePath,
      ) ||
      !moduleVersionHash ||
      !/^[a-f0-9]{64}$/i.test(moduleVersionHash)
    ) {
      continue;
    }
    const proof = nodesByMotionId.get(nodeId);
    if (proof) {
      nodesByMotionId.set(nodeId, {
        ...proof,
        renderedNodeIds: [...proof.renderedNodeIds, nodeId],
      });
    } else {
      nodesByMotionId.set(nodeId, {
        modulePath,
        moduleVersionHash,
        renderedNodeIds: [nodeId],
      });
    }
  }

  let selectedProof: MotionSourcePreviewProof | null = null;
  for (const targetNodeId of targets) {
    const target = nodesByMotionId.get(targetNodeId);
    if (!target || target.renderedNodeIds.length !== 1) return null;
    if (!selectedProof) {
      selectedProof = target;
      continue;
    }
    if (
      target.modulePath !== selectedProof.modulePath ||
      target.moduleVersionHash !== selectedProof.moduleVersionHash
    ) {
      return null;
    }
  }
  if (!selectedProof) return null;

  const renderedNodeIds = projection.nodes.flatMap((node) => {
    const nodeId = node.dataAttributes["data-agent-native-node-id"]?.trim();
    return nodeId &&
      node.dataAttributes["data-agent-native-motion-source-file"]?.trim() ===
        selectedProof!.modulePath &&
      node.dataAttributes["data-agent-native-motion-source-hash"]?.trim() ===
        selectedProof!.moduleVersionHash
      ? [nodeId]
      : [];
  });
  return { ...selectedProof, renderedNodeIds };
}

export function motionSourceWriteCapabilityAllowsTargets(
  capability: MotionSourceWriteCapabilitySnapshot | null | undefined,
  previewProof: MotionSourcePreviewProof | null,
  targetNodeIds: readonly string[],
): boolean {
  return (
    Boolean(previewProof) &&
    capability?.status === "supported" &&
    capability.modulePath === previewProof?.modulePath &&
    capability.moduleVersionHash === previewProof?.moduleVersionHash &&
    targetNodeIds.length > 0 &&
    capability.targetNodeIds.length === targetNodeIds.length &&
    targetNodeIds.every((nodeId) => capability.targetNodeIds.includes(nodeId))
  );
}

function isMotionTrack(value: unknown): value is MotionTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    targetNodeId?: unknown;
    property?: unknown;
    keyframes?: unknown;
  };
  return (
    typeof candidate.targetNodeId === "string" &&
    typeof candidate.property === "string" &&
    Array.isArray(candidate.keyframes)
  );
}

function normalizeMotionTracks(value: unknown): MotionTrack[] {
  return Array.isArray(value) ? value.filter(isMotionTrack) : [];
}

function labelForMotionTrack(
  track: MotionTrack,
  projection: CodeLayerProjection,
): string {
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] ===
        track.targetNodeId || candidate.id === track.targetNodeId,
  );
  return node?.layerName || node?.tag || track.targetNodeId;
}

export function hydrateMotionDockTracks(
  tracks: unknown,
  projection: CodeLayerProjection,
): MotionDockTrack[] {
  return normalizeMotionTracks(tracks).map((track) => ({
    ...track,
    label: labelForMotionTrack(track, projection),
  }));
}

const MOTION_TEXT_DOCK_PROPERTY_PREFIX = "text:";
const MOTION_TEXT_PROPERTY_SET = new Set<MotionTextProperty>(
  MOTION_TEXT_PROPERTIES,
);

export function motionTextDockProperty(property: MotionTextProperty): string {
  return `${MOTION_TEXT_DOCK_PROPERTY_PREFIX}${property}`;
}

export function motionTextPropertyFromDockTrack(
  property: string,
): MotionTextProperty | null {
  if (!property.startsWith(MOTION_TEXT_DOCK_PROPERTY_PREFIX)) return null;
  const candidate = property.slice(MOTION_TEXT_DOCK_PROPERTY_PREFIX.length);
  return MOTION_TEXT_PROPERTY_SET.has(candidate as MotionTextProperty)
    ? (candidate as MotionTextProperty)
    : null;
}

export function motionTextDocumentAsDockTracks(
  document: MotionTextDocument | null | undefined,
  projection: CodeLayerProjection,
): MotionDockTrack[] {
  return (document?.animations ?? []).map((animation) => ({
    targetNodeId: animation.targetNodeId,
    property: motionTextDockProperty(animation.property),
    keyframes: animation.keyframes,
    delayMs: animation.delayMs ?? 0,
    durationMs: animation.durationMs,
    label: labelForMotionTrack(
      {
        targetNodeId: animation.targetNodeId,
        property: motionTextDockProperty(animation.property),
        keyframes: animation.keyframes,
      },
      projection,
    ),
    isTextAnimation: true,
  }));
}

export function motionTextAnimationsFromDockTracks(
  document: MotionTextDocument | null | undefined,
  tracks: readonly MotionDockTrack[],
): MotionTextAnimation[] {
  const existingAnimations = new Map(
    (document?.animations ?? []).map((animation) => [
      `${animation.targetNodeId}\u001f${motionTextDockProperty(animation.property)}`,
      animation,
    ]),
  );
  return tracks.flatMap((track) => {
    if (!track.isTextAnimation) return [];
    const property = motionTextPropertyFromDockTrack(track.property);
    if (!property) return [];
    const existing = existingAnimations.get(
      `${track.targetNodeId}\u001f${motionTextDockProperty(property)}`,
    );
    if (!existing) return [];
    return [
      {
        ...existing,
        delayMs: track.delayMs ?? 0,
        durationMs: track.durationMs ?? existing.durationMs,
        keyframes: track.keyframes,
      },
    ];
  });
}

export const MOTION_KEYFRAME_TIME_EPSILON = 0.002;

function motionCssPropertyName(property: string): string | null {
  const trimmed = property.trim();
  if (!trimmed || trimmed.startsWith("--")) return null;
  const cssName = trimmed
    .replace(/^css/, "")
    .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    .toLowerCase();
  return /^-?[a-z][a-z0-9-]*$/i.test(cssName) ? cssName : null;
}

const MOTION_ANIMATABLE_PROPERTIES = new Set([
  "opacity",
  "transform",
  "translate",
  "rotate",
  "scale",
  "filter",
  "backdrop-filter",
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "border-radius",
  "border-width",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "background-position",
  "background-size",
]);

export function isMotionAnimatableProperty(property: string): boolean {
  if (MOTION_ANIMATABLE_PROPERTIES.has(property)) return true;
  return (
    /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(
      property,
    ) ||
    /^border-(top|right|bottom|left)-(color|width)$/.test(property) ||
    /^border-(top|bottom)-(left|right)-radius$/.test(property)
  );
}

export function applyMotionAutoKeyframesForStyles(
  tracks: MotionDockTrack[],
  args: {
    targetNodeId: string;
    styles: Record<string, string | undefined>;
    playheadT: number;
    timelineDurationMs: number;
    defaultEase?: MotionEase;
  },
): MotionDockTrack[] {
  let next: MotionDockTrack[] = tracks;
  for (const [rawProperty, rawValue] of Object.entries(args.styles)) {
    if (rawValue === undefined) continue;
    const property = motionCssPropertyName(rawProperty);
    if (!property || !isMotionAnimatableProperty(property)) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    const keyed = applyMotionAutoKeyframe(
      next,
      {
        targetNodeId: args.targetNodeId,
        property,
        value,
        playheadT: args.playheadT,
        timelineDurationMs: args.timelineDurationMs,
      },
      args.defaultEase,
    );
    if (keyed) next = keyed as MotionDockTrack[];
  }
  return next;
}

export function computedMotionStyleValue(
  computedStyles: Record<string, string> | undefined,
  property: string,
): string | undefined {
  if (!computedStyles) return undefined;
  return (
    computedStyles[property] ??
    computedStyles[camelStyleProperty(property)] ??
    computedStyles[
      property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
    ]
  );
}

function defaultMotionBaseValue(property: string, nextValue: string): string {
  if (property === "opacity") return "1";
  if (property === "transform" || property === "filter") return "none";
  return nextValue;
}

export function upsertMotionStyleKeyframes(args: {
  tracks: MotionDockTrack[];
  targetNodeId: string;
  label: string;
  styles: Record<string, string>;
  computedStyles?: Record<string, string>;
  playhead: number;
  timelineDurationMs?: number;
  defaultEase?: string;
}): MotionDockTrack[] {
  const t = Math.max(0, Math.min(1, args.playhead));
  const ease = args.defaultEase ?? "ease";
  let nextTracks = args.tracks;

  for (const [rawProperty, rawValue] of Object.entries(args.styles)) {
    if (rawValue === undefined) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    const property = motionCssPropertyName(rawProperty);
    if (!property) continue;
    if (!isMotionAnimatableProperty(property)) continue;

    const existingIndex = nextTracks.findIndex(
      (track) =>
        track.targetNodeId === args.targetNodeId && track.property === property,
    );

    if (existingIndex >= 0) {
      const keyed = applyMotionAutoKeyframe(
        nextTracks,
        {
          targetNodeId: args.targetNodeId,
          property,
          value,
          playheadT: t,
          timelineDurationMs: args.timelineDurationMs ?? 1,
        },
        ease,
      );
      if (keyed) {
        nextTracks = (keyed as MotionDockTrack[]).map((track, index) =>
          index === existingIndex
            ? { ...track, label: track.label || args.label }
            : track,
        ) as MotionDockTrack[];
      }
      continue;
    }

    const baseValue =
      computedMotionStyleValue(args.computedStyles, property) ??
      computedMotionStyleValue(args.computedStyles, rawProperty) ??
      defaultMotionBaseValue(property, value);
    if (value === baseValue) continue;
    const keyframes =
      t <= MOTION_KEYFRAME_TIME_EPSILON
        ? [
            { t: 0, value, ease },
            { t: 1, value: baseValue, ease },
          ]
        : t >= 1 - MOTION_KEYFRAME_TIME_EPSILON
          ? [
              { t: 0, value: baseValue, ease },
              { t: 1, value, ease },
            ]
          : [
              { t: 0, value: baseValue, ease },
              { t, value, ease },
              { t: 1, value: baseValue, ease },
            ];
    nextTracks = [
      ...nextTracks,
      {
        targetNodeId: args.targetNodeId,
        property,
        keyframes,
        label: args.label,
      },
    ];
  }

  return nextTracks;
}

export function applyMotionStyleKeyframeEdit(
  tracks: MotionDockTrack[],
  args: {
    targetNodeId: string;
    label: string;
    styles: Record<string, string>;
    computedStyles?: Record<string, string>;
    playhead: number;
    timelineDurationMs: number;
    defaultEase?: string;
    autoKeyframeEnabled: boolean;
  },
): MotionDockTrack[] {
  if (args.autoKeyframeEnabled) {
    return upsertMotionStyleKeyframes({ tracks, ...args });
  }
  return applyMotionAutoKeyframesForStyles(tracks, {
    targetNodeId: args.targetNodeId,
    styles: args.styles,
    playheadT: args.playhead,
    timelineDurationMs: args.timelineDurationMs,
    defaultEase: args.defaultEase as MotionEase | undefined,
  });
}

export function motionAnimationStyleDefinitionFromTracks(args: {
  id: string;
  name: string;
  category: MotionAnimationStyleDefinition["category"];
  description?: string;
  targetNodeId: string;
  tracks: readonly MotionTrack[];
}): MotionAnimationStyleDefinition | null {
  const tracks = args.tracks
    .filter((track) => track.targetNodeId === args.targetNodeId)
    .map(({ property, keyframes, enabled, delayMs, durationMs }) => ({
      property,
      keyframes: keyframes.map((keyframe) => ({
        ...keyframe,
        ...(keyframe.motionPath
          ? {
              motionPath: {
                ...keyframe.motionPath,
                control1: { ...keyframe.motionPath.control1 },
                control2: { ...keyframe.motionPath.control2 },
              },
            }
          : {}),
      })),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(delayMs !== undefined ? { delayMs } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    }));
  if (tracks.length === 0) return null;
  return {
    id: args.id,
    name: args.name,
    category: args.category,
    ...(args.description ? { description: args.description } : {}),
    tracks,
  };
}

export function applyMotionAnimationStyleToTargets(args: {
  existingTracks: readonly MotionDockTrack[];
  style: MotionAnimationStyleDefinition;
  targets: readonly { nodeId: string; label: string }[];
  currentTimeMs: number;
  timelineDurationMs: number;
}): { tracks: MotionDockTrack[]; timelineDurationMs: number } {
  const nextTracks: MotionDockTrack[] = [];
  let timelineDurationMs = Math.min(
    MOTION_TIMELINE_MAX_DURATION_MS,
    Math.max(0, args.timelineDurationMs),
  );
  const existingProperties = new Set(
    args.existingTracks.map(
      (track) => `${track.targetNodeId}\u0000${track.property}`,
    ),
  );
  const playheadMs = Math.max(0, args.currentTimeMs);
  const baseTimelineDurationMs = timelineDurationMs;

  for (const target of args.targets) {
    for (const styleTrack of args.style.tracks) {
      if (styleTrack.enabled === false) continue;
      const identity = `${target.nodeId}\u0000${styleTrack.property}`;
      if (existingProperties.has(identity)) continue;
      const startMs = playheadMs + (styleTrack.delayMs ?? 0);
      if (startMs >= MOTION_TIMELINE_MAX_DURATION_MS) continue;
      const requestedDuration =
        styleTrack.durationMs ?? Math.max(50, baseTimelineDurationMs - startMs);
      const durationMs = Math.min(
        requestedDuration,
        MOTION_TIMELINE_MAX_DURATION_MS - startMs,
      );
      if (durationMs <= 0) continue;

      nextTracks.push({
        targetNodeId: target.nodeId,
        label: target.label,
        property: styleTrack.property,
        keyframes: styleTrack.keyframes.map((keyframe) => ({ ...keyframe })),
        ...(startMs > 0 ? { delayMs: startMs } : {}),
        ...(styleTrack.durationMs !== undefined ||
        durationMs !== baseTimelineDurationMs - startMs
          ? { durationMs }
          : {}),
      });
      existingProperties.add(identity);
      timelineDurationMs = Math.max(timelineDurationMs, startMs + durationMs);
    }
  }

  return { tracks: nextTracks, timelineDurationMs };
}

export function motionTimelineFingerprint(
  fileId: string,
  timeline: MotionTimelineRow | null | undefined,
): string {
  if (!timeline) return `${fileId}:empty`;
  return [
    fileId,
    timeline.id ?? "css",
    timeline.updatedAt ?? "no-updated-at",
    timeline.compiledHash ?? "no-compiled-hash",
    timeline.cssHash ?? "no-css-hash",
    timeline.playbackMode ?? "once",
    timeline.source ?? "stored",
    JSON.stringify(timeline.tracks),
    JSON.stringify(timeline.animationStyles ?? []),
    JSON.stringify(timeline.nativeStyles ?? []),
    JSON.stringify(timeline.easingVariables ?? []),
    JSON.stringify(timeline.textDocument ?? null),
    JSON.stringify(timeline.audioClips ?? []),
  ].join(":");
}
