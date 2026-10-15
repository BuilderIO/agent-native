import postcss from "postcss";

import {
  assertMotionAnimationStyleDefinitions,
  type MotionAnimationStyleDefinition,
} from "./motion-animation-styles";
import {
  compile,
  hashCss,
  MotionCssSourceParseError,
  parse,
  parsePlaybackMode,
  parseTimelineSpanMs,
} from "./motion-compiler";
import {
  assertValidMotionEasingVariables,
  isMotionEaseVariableReference,
  motionEaseToCss,
  resolveMotionEase,
} from "./motion-easing";
import type { MotionEasingVariable } from "./motion-easing";
import {
  assertMotionNativeStyleInstances,
  type MotionNativeStyleInstance,
} from "./motion-native-style";
import {
  motionNativeStyleEndTimeMs,
  motionNativeStyleWithPathTrimTrack,
  motionNativeStyleWithPositionTrack,
  motionNativeStylesToTracks,
} from "./motion-native-style-runtime";
import type {
  MotionPlaybackMode,
  MotionTimeline,
  MotionTrack,
} from "./motion-timeline";
import {
  isMotionPathSegmentV1,
  motionTimelineDurationForTracks,
  MOTION_TIMELINE_MAX_DURATION_MS,
  parseMotionPosition,
} from "./motion-timeline";

export const MOTION_CODE_METADATA_VERSION = 3 as const;
const LEGACY_MOTION_CODE_METADATA_VERSION = 1;
export const MOTION_SOURCE_MARKER_NAME = "agent-native-motion-source";
export const MOTION_SOURCE_WRITE_UNAVAILABLE =
  "motion_source_write_unavailable";

export interface MotionCodeDocument {
  version: typeof MOTION_CODE_METADATA_VERSION;
  durationMs: number;
  defaultEase: string;
  playbackMode?: MotionPlaybackMode;
  tracks: MotionTrack[];
  animationStyles?: MotionAnimationStyleDefinition[];
  nativeStyles?: MotionNativeStyleInstance[];
  easingVariables?: MotionEasingVariable[];
  audioClips?: MotionAudioClip[];
}

export interface MotionAudioClip {
  id: string;
  name?: string;
  sourceUrl: string;
  timelineStartMs: number;
  sourceTrimStartMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
}

export interface MotionCodeCompileOptions {
  easingVariables?: readonly MotionEasingVariable[];
  audioClips?: readonly MotionAudioClip[];
}

export function motionAudioClipsEndTimeMs(
  audioClips: readonly MotionAudioClip[],
): number {
  assertMotionAudioClips(audioClips);
  return Math.ceil(
    Math.max(
      0,
      ...audioClips.map((clip) => clip.timelineStartMs + clip.durationMs),
    ),
  );
}

export type MotionSourceDocumentErrorCode =
  | "malformed-marker"
  | "unsupported-version"
  | "malformed-payload"
  | "invalid-document"
  | "duplicate-marker"
  | "unserializable-document";

export class MotionSourceDocumentError extends Error {
  constructor(
    readonly code: MotionSourceDocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MotionSourceDocumentError";
  }
}

export type MotionCodeMetadataReadResult =
  | { status: "absent" }
  | { status: "valid"; document: MotionCodeDocument }
  | { status: "invalid"; error: MotionSourceDocumentError };

export function motionCodeDocumentFromTimeline(
  timeline: MotionTimeline,
  options: MotionCodeCompileOptions = {},
): MotionCodeDocument {
  const audioClips = options.audioClips;
  const audioEndMs = motionAudioClipsEndTimeMs(audioClips ?? []);
  const nativeStyleEndMs = Math.ceil(
    Math.max(
      0,
      ...(timeline.nativeStyles ?? []).map(motionNativeStyleEndTimeMs),
    ),
  );
  const document: MotionCodeDocument = {
    version: MOTION_CODE_METADATA_VERSION,
    durationMs: Math.max(
      motionTimelineDurationForTracks(timeline.durationMs, timeline.tracks),
      nativeStyleEndMs,
      audioEndMs,
    ),
    defaultEase: timeline.defaultEase,
    tracks: timeline.tracks,
    ...(timeline.playbackMode ? { playbackMode: timeline.playbackMode } : {}),
    ...(timeline.animationStyles
      ? { animationStyles: timeline.animationStyles }
      : {}),
    ...(timeline.nativeStyles ? { nativeStyles: timeline.nativeStyles } : {}),
    ...(options.easingVariables !== undefined
      ? { easingVariables: [...options.easingVariables] }
      : {}),
    ...(audioClips !== undefined ? { audioClips: [...audioClips] } : {}),
  };
  assertMotionCodeDocument(document);
  return document;
}

export function compileMotionCode(
  timeline: MotionTimeline,
  options: MotionCodeCompileOptions = {},
) {
  const audioEndMs = motionAudioClipsEndTimeMs(options.audioClips ?? []);
  const nativeTracks = motionNativeStylesToTracks(timeline.nativeStyles ?? []);
  const nativeStyleEndMs = Math.ceil(
    Math.max(
      0,
      ...(timeline.nativeStyles ?? []).map(motionNativeStyleEndTimeMs),
    ),
  );
  const compiled = compile(
    {
      ...timeline,
      tracks: [...timeline.tracks, ...nativeTracks],
      durationMs: Math.max(timeline.durationMs, nativeStyleEndMs, audioEndMs),
    },
    options,
  );
  const css = withMotionCodeMetadata(
    compiled.css,
    motionCodeDocumentFromTimeline(timeline, options),
  );
  return { css, hash: hashCss(css) };
}

interface MarkerLocation {
  start: number;
  end: number;
  body: string;
}

/**
 * Serializes versioned authoring data into an inert CSS comment. The percent
 * encoding keeps the comment delimiter out of untrusted timeline values.
 */
export function encodeMotionCodeMetadata(document: MotionCodeDocument): string {
  assertMotionCodeDocument(document);
  let json: string;
  try {
    json = JSON.stringify(document);
  } catch {
    throw new MotionSourceDocumentError(
      "unserializable-document",
      "Motion source metadata must be serializable as JSON.",
    );
  }

  if (typeof json !== "string") {
    throw new MotionSourceDocumentError(
      "unserializable-document",
      "Motion source metadata must be serializable as JSON.",
    );
  }

  const payload = encodePayload(json);
  return `/* ${MOTION_SOURCE_MARKER_NAME}:v${document.version}:${payload} */`;
}

/** Reads metadata without conflating a missing marker with an unreadable one. */
export function decodeMotionCodeMetadata(
  css: string,
): MotionCodeMetadataReadResult {
  const scan = scanMotionSourceMarkers(css);
  if (scan.error) return { status: "invalid", error: scan.error };
  if (scan.markers.length === 0) return { status: "absent" };
  if (scan.markers.length > 1) {
    return {
      status: "invalid",
      error: new MotionSourceDocumentError(
        "duplicate-marker",
        "CSS contains more than one Motion source marker.",
      ),
    };
  }

  try {
    return {
      status: "valid",
      document: decodeMarker(scan.markers[0].body),
    };
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionSourceDocumentError
          ? error
          : new MotionSourceDocumentError(
              "malformed-payload",
              "Motion source metadata could not be decoded.",
            ),
    };
  }
}

/**
 * Adds or replaces the single managed metadata comment while preserving all
 * other CSS text byte-for-byte. Invalid metadata is surfaced to the caller.
 */
export function withMotionCodeMetadata(
  css: string,
  document: MotionCodeDocument,
): string {
  const marker = encodeMotionCodeMetadata(document);
  const scan = scanMotionSourceMarkers(css);
  if (scan.error) throw scan.error;
  if (scan.markers.length > 1) {
    throw new MotionSourceDocumentError(
      "duplicate-marker",
      "CSS contains more than one Motion source marker.",
    );
  }

  const existing = scan.markers[0];
  if (existing) {
    const current = decodeMotionCodeMetadata(css);
    if (current.status === "invalid") throw current.error;
    return css.slice(0, existing.start) + marker + css.slice(existing.end);
  }

  if (css.length === 0) return marker;
  return `${css}${/[\t\n\f\r ]$/.test(css) ? "" : "\n"}${marker}`;
}

/** Reads editable Motion values from CSS while retaining data CSS cannot encode. */
export function reconcileMotionCodeDocument(
  css: string,
  stored: MotionCodeDocument,
): MotionCodeDocument {
  const root = postcss.parse(css);
  assertManagedMotionCssShape(root);
  const keyframeNames: string[] = [];
  const referencedMotionNames: string[] = [];
  const playbackModes = new Set<MotionPlaybackMode>();
  const cssEasingVariables = new Map<string, string>();

  root.walkAtRules((rule) => {
    if (!/^(?:-webkit-)?keyframes$/i.test(rule.name)) return;
    const name = rule.params.trim().split(/\s+/)[0] ?? "";
    if (name.startsWith("an-motion-")) keyframeNames.push(name);
  });

  root.walkRules((rule) => {
    const nodeIdMatch =
      /\[data-agent-native-node-id\s*=\s*(["'])([^"']+)\1\]/.exec(
        rule.selector,
      );
    const declarations = rule.nodes?.filter(
      (node): node is postcss.Declaration => node.type === "decl",
    );
    if (!declarations) return;

    if (rule.selector.trim() === ":root") {
      for (const declaration of declarations) {
        const variable = /^--an-motion-ease-([a-z0-9][a-z0-9-]{0,63})$/.exec(
          declaration.prop,
        );
        if (!variable) continue;
        const previous = cssEasingVariables.get(variable[1]!);
        if (previous !== undefined && previous !== declaration.value.trim()) {
          throw invalidMotionCss(
            `Motion easing variable "${variable[1]}" has conflicting CSS definitions.`,
          );
        }
        cssEasingVariables.set(variable[1]!, declaration.value.trim());
      }
    }

    if (!nodeIdMatch) return;
    const animationNames = declarations.find(
      (declaration) => declaration.prop.toLowerCase() === "animation-name",
    );
    const shorthand = declarations.find(
      (declaration) => declaration.prop.toLowerCase() === "animation",
    );
    if (
      shorthand &&
      shorthand.value.trim().toLowerCase() !== "none" &&
      !animationNames
    ) {
      throw invalidMotionCss(
        "Motion CSS animation shorthand cannot be mapped to timeline tracks. Use animation-name, duration, delay, and keyframes declarations.",
      );
    }
    if (!animationNames) return;

    const names = splitCssList(animationNames.value);
    const motionNames = names.filter((name) => name.startsWith("an-motion-"));
    if (
      names.some((name) => name !== "none" && !name.startsWith("an-motion-"))
    ) {
      throw invalidMotionCss(
        "Managed Motion CSS contains a custom animation name that cannot be mapped to a Motion layer. Keep timeline keyframes named with the an-motion- prefix.",
      );
    }
    if (motionNames.length === 0) return;
    const fillModes = declarationValues(declarations, "animation-fill-mode");
    if (
      fillModes.length === 0 ||
      fillModes.some((mode) => mode.toLowerCase() !== "both")
    ) {
      throw invalidMotionCss(
        "Managed Motion CSS supports animation-fill-mode: both only. Repair the CSS before editing it in Motion.",
      );
    }
    referencedMotionNames.push(...motionNames);

    const durations = declarationValues(declarations, "animation-duration");
    if (
      durations.length === 0 ||
      durations.some((value) => parseCssTime(value) === null)
    ) {
      throw invalidMotionCss(
        "Managed Motion CSS has an animation duration that cannot be read as a fixed millisecond or second value.",
      );
    }
    const delays = declarationValues(declarations, "animation-delay");
    if (delays.some((value) => parseCssTime(value) === null)) {
      throw invalidMotionCss(
        "Managed Motion CSS has an animation delay that cannot be read as a fixed millisecond or second value.",
      );
    }

    const iterations = declarationValues(
      declarations,
      "animation-iteration-count",
    );
    const directions = declarationValues(declarations, "animation-direction");
    for (let index = 0; index < names.length; index += 1) {
      const iteration = iterations[index] ?? iterations[0] ?? "1";
      const direction = directions[index] ?? directions[0] ?? "normal";
      if (!/^(?:1|1\.0+|infinite)$/i.test(iteration)) {
        throw invalidMotionCss(
          "Managed Motion CSS supports one iteration or infinite playback only.",
        );
      }
      if (!/^(?:normal|alternate)$/i.test(direction)) {
        throw invalidMotionCss(
          "Managed Motion CSS supports normal or alternate animation direction only.",
        );
      }
      playbackModes.add(
        iteration.toLowerCase() === "infinite"
          ? direction.toLowerCase() === "alternate"
            ? "ping-pong"
            : "loop"
          : "once",
      );
    }
  });

  const keyframeNameSet = [...keyframeNames].sort();
  const referencedNameSet = [...referencedMotionNames].sort();
  if (
    keyframeNameSet.length !== referencedNameSet.length ||
    keyframeNameSet.some((name, index) => name !== referencedNameSet[index])
  ) {
    throw invalidMotionCss(
      "Managed Motion CSS keyframes and animation-name declarations do not match. Repair the CSS before editing it in Motion.",
    );
  }
  if (playbackModes.size > 1) {
    throw invalidMotionCss(
      "Managed Motion CSS uses different playback modes for different tracks, which Motion cannot represent as one timeline.",
    );
  }

  let parsedTracks: MotionTrack[];
  try {
    parsedTracks = parse(css);
  } catch (error) {
    if (error instanceof MotionCssSourceParseError) {
      throw invalidMotionCss(error.message);
    }
    throw error;
  }
  if (parsedTracks.length !== keyframeNames.length) {
    throw invalidMotionCss(
      "Managed Motion CSS contains a keyframe block that cannot be mapped to one editable Motion track.",
    );
  }
  const cssDurations = animationDurationsByName(root);
  parsedTracks = parsedTracks.map((track, index) => {
    const name = keyframeNames[index];
    const durationMs = name ? cssDurations.get(name) : undefined;
    const storedTrack = stored.tracks.find(
      (candidate) =>
        candidate.targetNodeId === track.targetNodeId &&
        candidate.property === track.property,
    );
    if (
      durationMs === undefined ||
      !storedTrack ||
      (storedTrack.durationMs === undefined && durationMs === stored.durationMs)
    ) {
      return track;
    }
    return { ...track, durationMs };
  });
  if (
    parsedTracks.some(
      (track) =>
        track.keyframes.length === 0 ||
        track.keyframes.some((keyframe) => !keyframe.value.trim()),
    )
  ) {
    throw invalidMotionCss(
      "Managed Motion CSS contains a keyframe with no readable property value.",
    );
  }

  const timelineDuration = parseTimelineSpanMs(css);
  const easingVariables = [...cssEasingVariables.entries()].map(
    ([id, value]) => {
      const metadata = stored.easingVariables?.find(
        (variable) => variable.id === id,
      );
      return {
        ...(metadata ?? { id, name: id }),
        value,
      };
    },
  );
  try {
    assertValidMotionEasingVariables(easingVariables);
  } catch (error) {
    throw invalidMotionCss(
      error instanceof Error
        ? error.message
        : "Managed Motion CSS contains an invalid easing variable.",
    );
  }

  const nativeStyles: MotionNativeStyleInstance[] = [];
  const consumedTrackIndices = new Set<number>();
  for (const style of stored.nativeStyles ?? []) {
    let projection: MotionTrack[];
    try {
      projection = motionNativeStylesToTracks([style]);
    } catch (error) {
      throw invalidMotionCss(
        error instanceof Error
          ? error.message
          : "A stored Motion style cannot be projected onto editable tracks.",
      );
    }
    if (style.enabled === false || projection.length === 0) {
      nativeStyles.push(style);
      continue;
    }

    const exactMatches = projection.map((projected) =>
      matchingTrackIndices(parsedTracks, (track) =>
        motionTracksMatch(
          projected,
          track,
          timelineDuration,
          stored.defaultEase,
          easingVariables,
        ),
      ),
    );
    if (
      exactMatches.every((matches) => matches.length === 1) &&
      new Set(exactMatches.map(([index]) => index)).size ===
        projection.length &&
      exactMatches.every(([index]) => !consumedTrackIndices.has(index!))
    ) {
      exactMatches.forEach(([index]) => consumedTrackIndices.add(index!));
      nativeStyles.push(style);
      continue;
    }

    const propertyMatches = projection.map((projected) =>
      matchingTrackIndices(
        parsedTracks,
        (track) =>
          track.targetNodeId === projected.targetNodeId &&
          track.property === projected.property,
      ),
    );
    if (propertyMatches.every((matches) => matches.length === 0)) {
      const hasUnexpectedTargetTrack = parsedTracks.some(
        (track) =>
          track.targetNodeId === style.targetNodeId &&
          !stored.tracks.some(
            (storedTrack) =>
              storedTrack.enabled !== false &&
              storedTrack.keyframes.length > 0 &&
              storedTrack.targetNodeId === track.targetNodeId &&
              storedTrack.property === track.property,
          ),
      );
      if (hasUnexpectedTargetTrack) {
        throw invalidMotionCss(
          `The ${style.styleKey} source animation no longer maps to its existing target tracks. Repair its CSS before editing it in Motion.`,
        );
      }
      continue;
    }
    if (
      projection.length !== 1 ||
      propertyMatches[0]?.length !== 1 ||
      consumedTrackIndices.has(propertyMatches[0]![0]!)
    ) {
      throw invalidMotionCss(
        `The ${style.styleKey} source animation no longer has one unambiguous track. Repair its CSS before editing it in Motion.`,
      );
    }

    const trackIndex = propertyMatches[0]![0]!;
    const sourceTrack = parsedTracks[trackIndex]!;
    let updatedStyle: MotionNativeStyleInstance;
    try {
      switch (style.styleKey) {
        case "Position":
          updatedStyle = motionNativeStyleWithPositionTrack(style, sourceTrack);
          break;
        case "Path":
          updatedStyle = motionNativeStyleWithPathTrimTrack(style, sourceTrack);
          break;
        default:
          throw new Error(
            `Source edits to ${style.styleKey} are not yet representable in the Motion timeline.`,
          );
      }
    } catch (error) {
      throw invalidMotionCss(
        error instanceof Error
          ? error.message
          : `The ${style.styleKey} source animation cannot be represented in the Motion timeline.`,
      );
    }

    let updatedProjection: MotionTrack[];
    try {
      updatedProjection = motionNativeStylesToTracks([updatedStyle]);
    } catch (error) {
      throw invalidMotionCss(
        error instanceof Error
          ? error.message
          : `The edited ${style.styleKey} source animation cannot be represented in the Motion timeline.`,
      );
    }
    if (
      updatedProjection.length !== 1 ||
      !motionTracksMatch(
        updatedProjection[0]!,
        sourceTrack,
        timelineDuration,
        stored.defaultEase,
        easingVariables,
      )
    ) {
      throw invalidMotionCss(
        `The edited ${style.styleKey} source animation changes timing or values the Motion timeline cannot represent. Repair its CSS before editing it in Motion.`,
      );
    }
    consumedTrackIndices.add(trackIndex);
    nativeStyles.push(updatedStyle);
  }
  parsedTracks = parsedTracks.filter(
    (_track, index) => !consumedTrackIndices.has(index),
  );

  const disabledTracks = stored.tracks.filter(
    (track) => track.enabled === false,
  );
  const playbackMode = parsePlaybackMode(css);
  const document: MotionCodeDocument = {
    ...stored,
    durationMs: Math.max(stored.durationMs, timelineDuration ?? 0),
    ...((playbackMode ??
    (playbackModes.size === 1 ? [...playbackModes][0] : null))
      ? { playbackMode: playbackMode ?? [...playbackModes][0]! }
      : {}),
    tracks: [...parsedTracks, ...disabledTracks],
    nativeStyles,
    easingVariables,
  };
  try {
    assertMotionCodeDocument(document);
  } catch (error) {
    throw invalidMotionCss(
      error instanceof Error
        ? error.message
        : "Managed Motion CSS could not be represented as a Motion document.",
    );
  }
  return document;
}

function invalidMotionCss(message: string): MotionSourceDocumentError {
  return new MotionSourceDocumentError("invalid-document", message);
}

function assertManagedMotionCssShape(root: postcss.Root): void {
  const targetProperties = new Set([
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-fill-mode",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "offset-path",
    "offset-anchor",
    "offset-rotate",
    "translate",
  ]);
  const rejectUnmanagedCss = (): never => {
    throw invalidMotionCss(
      "Managed Motion CSS contains authored rules the timeline cannot represent. Move those rules outside the managed Motion style before editing it.",
    );
  };
  const nodeIdSelectorSource = String.raw`\[data-agent-native-node-id\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\]`;
  const isNodeIdSelector = (selector: string) =>
    new RegExp(String.raw`^\s*${nodeIdSelectorSource}\s*$`).test(selector);
  const isNodeIdSelectorList = (selector: string) =>
    new RegExp(
      String.raw`^\s*${nodeIdSelectorSource}(?:\s*,\s*${nodeIdSelectorSource})*\s*$`,
    ).test(selector);
  const assertDeclarations = (
    rule: postcss.Rule,
    allowedProperties: ReadonlySet<string> | null,
    validateDeclaration?: (declaration: postcss.Declaration) => boolean,
  ) => {
    const seenProperties = new Set<string>();
    for (const child of rule.nodes ?? []) {
      if (child.type !== "decl") return rejectUnmanagedCss();
      const property = child.prop.toLowerCase();
      if (
        (allowedProperties && !allowedProperties.has(property)) ||
        seenProperties.has(property) ||
        (validateDeclaration && !validateDeclaration(child))
      ) {
        return rejectUnmanagedCss();
      }
      seenProperties.add(property);
    }
  };
  const assertKeyframes = (rule: postcss.AtRule) => {
    const name = rule.params.trim();
    const match = /^an-motion-.+--(-?[a-zA-Z][a-zA-Z0-9-]*)$/.exec(name);
    if (!match) return rejectUnmanagedCss();
    const property = match[1]!.toLowerCase();
    const allowedProperties = new Set([
      "animation-timing-function",
      property,
      ...(property === "translate" ? ["offset-distance"] : []),
      ...(property === "path-trim"
        ? ["--an-motion-path-trim", "stroke-dasharray", "stroke-dashoffset"]
        : []),
    ]);

    for (const child of rule.nodes ?? []) {
      if (child.type !== "rule") return rejectUnmanagedCss();
      if (
        !/^(?:from|to|(?:\d+(?:\.\d*)?|\.\d+)%)$/.test(child.selector.trim())
      ) {
        return rejectUnmanagedCss();
      }
      let propertyCount = 0;
      assertDeclarations(child, allowedProperties, (declaration) => {
        if (declaration.important) return false;
        if (declaration.prop.toLowerCase() === "animation-timing-function") {
          return true;
        }
        propertyCount += 1;
        return true;
      });
      if (propertyCount !== (property === "path-trim" ? 3 : 1)) {
        rejectUnmanagedCss();
      }
    }
  };
  const assertReducedMotion = (rule: postcss.AtRule) => {
    if (
      rule.params.replace(/\s+/g, " ").trim().toLowerCase() !==
      "(prefers-reduced-motion: reduce)"
    ) {
      rejectUnmanagedCss();
    }
    for (const child of rule.nodes ?? []) {
      if (child.type === "comment" && child.text.trim() === "no animations") {
        continue;
      }
      if (child.type !== "rule") return rejectUnmanagedCss();
      if (!isNodeIdSelectorList(child.selector)) return rejectUnmanagedCss();
      let declarationCount = 0;
      assertDeclarations(child, new Set(["animation"]), (declaration) => {
        declarationCount += 1;
        return (
          declaration.value.trim().toLowerCase() === "none" &&
          declaration.important
        );
      });
      if (declarationCount !== 1) rejectUnmanagedCss();
    }
  };

  for (const node of root.nodes) {
    if (node.type === "comment") {
      const comment = node.text.trim();
      if (
        comment === "no animations" ||
        comment.startsWith(`${MOTION_SOURCE_MARKER_NAME}:v`)
      ) {
        continue;
      }
      rejectUnmanagedCss();
    }
    if (node.type === "rule") {
      if (node.selector.trim() === ":root") {
        assertDeclarations(node, null, (declaration) =>
          /^--an-motion-ease-[a-z0-9][a-z0-9-]{0,63}$/i.test(declaration.prop),
        );
      } else if (isNodeIdSelector(node.selector)) {
        assertDeclarations(node, targetProperties);
      } else {
        rejectUnmanagedCss();
      }
      continue;
    }
    if (node.type === "atrule") {
      const name = node.name.toLowerCase();
      if (name === "keyframes") {
        assertKeyframes(node);
      } else if (name === "media") {
        assertReducedMotion(node);
      } else {
        rejectUnmanagedCss();
      }
      continue;
    }
    rejectUnmanagedCss();
  }
}

function splitCssList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function declarationValues(
  declarations: postcss.Declaration[],
  property: string,
): string[] {
  const value = declarations.find(
    (declaration) => declaration.prop.toLowerCase() === property,
  )?.value;
  return value === undefined ? [] : splitCssList(value);
}

function animationDurationsByName(root: postcss.Root): Map<string, number> {
  const durationsByName = new Map<string, number>();
  root.walkRules((rule) => {
    const declarations = rule.nodes?.filter(
      (node): node is postcss.Declaration => node.type === "decl",
    );
    if (!declarations) return;
    const names = declarationValues(declarations, "animation-name");
    const durations = declarationValues(declarations, "animation-duration");
    names.forEach((name, index) => {
      const duration = parseCssTime(durations[index] ?? durations[0] ?? "");
      if (duration !== null) durationsByName.set(name, duration);
    });
  });
  return durationsByName;
}

function parseCssTime(value: string): number | null {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s)$/i.exec(value.trim());
  if (!match) return null;
  const time = Number(match[1]) * (match[2]!.toLowerCase() === "s" ? 1000 : 1);
  return Number.isFinite(time) && time >= 0 ? Math.round(time) : null;
}

function motionTracksMatch(
  expected: MotionTrack,
  actual: MotionTrack,
  timelineDurationMs: number | null,
  defaultEase: string,
  easingVariables: readonly MotionEasingVariable[],
): boolean {
  if (
    expected.targetNodeId !== actual.targetNodeId ||
    expected.property !== actual.property ||
    (expected.delayMs ?? 0) !== (actual.delayMs ?? 0) ||
    (expected.durationMs ?? timelineDurationMs) !==
      (actual.durationMs ?? timelineDurationMs) ||
    expected.keyframes.length !== actual.keyframes.length
  ) {
    return false;
  }

  return expected.keyframes.every((keyframe, index) => {
    const parsed = actual.keyframes[index];
    if (
      !parsed ||
      keyframe.t !== parsed.t ||
      keyframe.value !== parsed.value ||
      !motionPathsMatch(
        keyframe.motionPath,
        parsed.motionPath,
        keyframe.value,
        expected.keyframes[index + 1]?.value,
      )
    ) {
      return false;
    }
    const ease = keyframe.ease ?? defaultEase;
    const expectedEase = isMotionEaseVariableReference(ease)
      ? ease
      : motionEaseToCss(resolveMotionEase(ease, easingVariables));
    return (parsed.ease ?? "ease") === expectedEase;
  });
}

function matchingTrackIndices(
  tracks: readonly MotionTrack[],
  predicate: (track: MotionTrack) => boolean,
): number[] {
  return tracks.flatMap((track, index) => (predicate(track) ? [index] : []));
}

function motionPathsMatch(
  expected: MotionTrack["keyframes"][number]["motionPath"],
  actual: MotionTrack["keyframes"][number]["motionPath"],
  startValue: string,
  endValue: string | undefined,
): boolean {
  if (!expected || !actual) {
    const path = expected ?? actual;
    if (!path) return true;
    if (!endValue) return false;
    const start = parseMotionPosition(startValue);
    const end = parseMotionPosition(endValue);
    if (!start || !end) return false;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return (
      Math.hypot(path.control1.x - dx / 3, path.control1.y - dy / 3) <=
        0.0001 &&
      Math.hypot(path.control2.x + dx / 3, path.control2.y + dy / 3) <= 0.0001
    );
  }
  return (
    expected.version === actual.version &&
    expected.type === actual.type &&
    expected.control1.x === actual.control1.x &&
    expected.control1.y === actual.control1.y &&
    expected.control2.x === actual.control2.x &&
    expected.control2.y === actual.control2.y
  );
}

function encodePayload(json: string): string {
  // encodeURIComponent escapes slash; escaping its otherwise-safe asterisk
  // leaves a comment-safe alphabet with no possible `*/` sequence.
  return encodeURIComponent(json).replace(/\*/g, "%2A");
}

function decodeMarker(body: string): MotionCodeDocument {
  const marker = body.trim();
  const match = new RegExp(
    `^${MOTION_SOURCE_MARKER_NAME}:([^:]+):([\\s\\S]*)$`,
  ).exec(marker);
  if (!match) {
    throw new MotionSourceDocumentError(
      "malformed-marker",
      "Motion source marker has an invalid header.",
    );
  }

  const version = match[1];
  if (!/^v\d+$/.test(version)) {
    throw new MotionSourceDocumentError(
      "malformed-marker",
      `Motion source marker version "${version}" is malformed.`,
    );
  }
  const markerVersion = Number(version.slice(1));
  if (markerVersion > MOTION_CODE_METADATA_VERSION) {
    throw new MotionSourceDocumentError(
      "unsupported-version",
      `Motion code metadata version "${version}" is not supported.`,
    );
  }
  if (markerVersion < LEGACY_MOTION_CODE_METADATA_VERSION) {
    throw new MotionSourceDocumentError(
      "invalid-document",
      `Motion code metadata version "${version}" is not supported.`,
    );
  }

  let json: string;
  try {
    json = decodePayload(match[2]);
  } catch {
    throw new MotionSourceDocumentError(
      "malformed-payload",
      "Motion source marker contains invalid percent-encoded JSON.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MotionSourceDocumentError(
      "malformed-payload",
      "Motion source marker does not contain valid JSON.",
    );
  }

  if (!isRecord(parsed) || typeof parsed.version !== "number") {
    throw new MotionSourceDocumentError(
      "invalid-document",
      "Motion source document must include a numeric version.",
    );
  }
  if (parsed.version !== markerVersion) {
    throw new MotionSourceDocumentError(
      "invalid-document",
      `Motion code metadata version ${parsed.version} does not match marker version ${markerVersion}.`,
    );
  }

  let document: unknown = parsed;
  try {
    if (markerVersion < MOTION_CODE_METADATA_VERSION) {
      assertOnlyKeys(
        parsed,
        markerVersion === LEGACY_MOTION_CODE_METADATA_VERSION
          ? [
              "version",
              "durationMs",
              "defaultEase",
              "playbackMode",
              "tracks",
              "animationStyles",
            ]
          : [
              "version",
              "durationMs",
              "defaultEase",
              "playbackMode",
              "tracks",
              "animationStyles",
              "nativeStyles",
              "easingVariables",
            ],
      );
      document = { ...parsed, version: MOTION_CODE_METADATA_VERSION };
    }
    assertMotionCodeDocument(document);
  } catch (error) {
    throw new MotionSourceDocumentError(
      "invalid-document",
      error instanceof Error
        ? error.message
        : "Motion code metadata contains an invalid document.",
    );
  }

  return document as MotionCodeDocument;
}

function decodePayload(payload: string): string {
  if (!/^(?:[A-Za-z0-9_.!~'()\-]|%[0-9A-F]{2})*$/.test(payload)) {
    throw new Error("Invalid Motion source encoding alphabet.");
  }
  const decoded = decodeURIComponent(payload);
  if (encodePayload(decoded) !== payload) {
    throw new Error("Motion source encoding is not canonical.");
  }
  return decoded;
}

function scanMotionSourceMarkers(css: string): {
  markers: MarkerLocation[];
  error?: MotionSourceDocumentError;
} {
  const markers: MarkerLocation[] = [];
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== "/" || css[index + 1] !== "*") continue;

    const endStart = css.indexOf("*/", index + 2);
    const bodyEnd = endStart === -1 ? css.length : endStart;
    const body = css.slice(index + 2, bodyEnd);
    if (isMotionMarkerBody(body)) {
      if (endStart === -1) {
        return {
          markers,
          error: new MotionSourceDocumentError(
            "malformed-marker",
            "Motion source marker comment is not closed.",
          ),
        };
      }
      markers.push({ start: index, end: endStart + 2, body });
    }

    if (endStart === -1) break;
    index = endStart + 1;
  }

  return { markers };
}

function isMotionMarkerBody(body: string): boolean {
  const candidate = body.trimStart();
  if (!candidate.startsWith(MOTION_SOURCE_MARKER_NAME)) return false;
  const next = candidate[MOTION_SOURCE_MARKER_NAME.length];
  return next === undefined || next === ":" || /\s/.test(next);
}

function assertMotionCodeDocument(
  value: unknown,
): asserts value is MotionCodeDocument {
  if (!isRecord(value)) invalidDocument("must be an object");
  if (value.version !== MOTION_CODE_METADATA_VERSION) {
    invalidDocument(`version must be ${MOTION_CODE_METADATA_VERSION}`);
  }
  requirePositiveInteger(value.durationMs, "durationMs");
  if (value.durationMs > MOTION_TIMELINE_MAX_DURATION_MS) {
    invalidDocument("durationMs must be at most 120000");
  }
  let easingVariables: readonly MotionEasingVariable[] = [];
  if (value.easingVariables !== undefined) {
    try {
      assertValidMotionEasingVariables(value.easingVariables);
      easingVariables = value.easingVariables;
    } catch (error) {
      invalidDocument(
        error instanceof Error
          ? error.message
          : "easingVariables contains an invalid definition",
      );
    }
  }
  assertEaseReference(value.defaultEase, "defaultEase", easingVariables);
  if (value.playbackMode !== undefined && !isPlaybackMode(value.playbackMode)) {
    invalidDocument("playbackMode is invalid");
  }
  assertOnlyKeys(value, [
    "version",
    "durationMs",
    "defaultEase",
    "playbackMode",
    "tracks",
    "animationStyles",
    "nativeStyles",
    "easingVariables",
    "audioClips",
  ]);
  if (!Array.isArray(value.tracks)) invalidDocument("tracks must be an array");
  if (value.tracks.length > 64) {
    invalidDocument("tracks must contain 0 to 64 tracks");
  }
  if (value.animationStyles !== undefined) {
    assertMotionAnimationStyleDefinitions(
      value.animationStyles,
      easingVariables,
    );
  }
  if (value.nativeStyles !== undefined) {
    assertMotionNativeStyleInstances(value.nativeStyles);
    const nativeStyleEndMs = Math.ceil(
      Math.max(0, ...value.nativeStyles.map(motionNativeStyleEndTimeMs)),
    );
    if (nativeStyleEndMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument("nativeStyles exceed the 120000ms timeline limit");
    }
    if (value.durationMs < nativeStyleEndMs) {
      invalidDocument(
        "durationMs must cover every native style offset and duration",
      );
    }
    for (const [styleIndex, style] of value.nativeStyles.entries()) {
      const nativeEase = style.props.easing;
      if (
        typeof nativeEase === "string" &&
        (/^\s*var\s*\(/i.test(nativeEase) ||
          isMotionEaseVariableReference(nativeEase))
      ) {
        assertEaseReference(
          nativeEase,
          `nativeStyles[${styleIndex}].props.easing`,
          easingVariables,
        );
      }
    }
  }

  if (value.audioClips !== undefined) {
    assertMotionAudioClips(value.audioClips);
    const audioEndMs = motionAudioClipsEndTimeMs(value.audioClips);
    if (audioEndMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument("audioClips exceed the 120000ms timeline limit");
    }
    if (value.durationMs < audioEndMs) {
      invalidDocument("durationMs must cover every audio clip");
    }
  }

  for (const [trackIndex, track] of value.tracks.entries()) {
    if (!isRecord(track))
      invalidDocument(`tracks[${trackIndex}] must be an object`);
    assertOnlyKeys(track, [
      "targetNodeId",
      "property",
      "keyframes",
      "enabled",
      "delayMs",
      "durationMs",
      "timelinePlaybackMode",
    ]);
    requireString(track.targetNodeId, `tracks[${trackIndex}].targetNodeId`);
    if (track.targetNodeId.trim().length === 0) {
      invalidDocument(`tracks[${trackIndex}].targetNodeId must not be empty`);
    }
    requireString(track.property, `tracks[${trackIndex}].property`);
    if (!/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(track.property)) {
      invalidDocument(`tracks[${trackIndex}].property is not a CSS property`);
    }
    if (!Array.isArray(track.keyframes)) {
      invalidDocument(`tracks[${trackIndex}].keyframes must be an array`);
    }
    if (track.enabled !== undefined && typeof track.enabled !== "boolean") {
      invalidDocument(`tracks[${trackIndex}].enabled must be a boolean`);
    }
    if (track.keyframes.length < 1 || track.keyframes.length > 128) {
      invalidDocument(
        `tracks[${trackIndex}].keyframes must contain 1 to 128 keyframes`,
      );
    }
    if (track.delayMs !== undefined) {
      requireNonNegativeNumber(track.delayMs, `tracks[${trackIndex}].delayMs`);
      if (track.delayMs > MOTION_TIMELINE_MAX_DURATION_MS) {
        invalidDocument(`tracks[${trackIndex}].delayMs is too large`);
      }
    }
    if (track.durationMs !== undefined) {
      requirePositiveNumber(
        track.durationMs,
        `tracks[${trackIndex}].durationMs`,
      );
      if (track.durationMs > MOTION_TIMELINE_MAX_DURATION_MS) {
        invalidDocument(`tracks[${trackIndex}].durationMs is too large`);
      }
    }
    if (
      track.timelinePlaybackMode !== undefined &&
      !isPlaybackMode(track.timelinePlaybackMode)
    ) {
      invalidDocument(`tracks[${trackIndex}].timelinePlaybackMode is invalid`);
    }

    for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
      if (!isRecord(keyframe)) {
        invalidDocument(
          `tracks[${trackIndex}].keyframes[${keyframeIndex}] must be an object`,
        );
      }
      requireFiniteNumber(
        keyframe.t,
        `tracks[${trackIndex}].keyframes[${keyframeIndex}].t`,
      );
      if (keyframe.t < 0 || keyframe.t > 1) {
        invalidDocument(
          `tracks[${trackIndex}].keyframes[${keyframeIndex}].t must be in [0, 1]`,
        );
      }
      requireSafeCssToken(
        keyframe.value,
        `tracks[${trackIndex}].keyframes[${keyframeIndex}].value`,
      );
      if (keyframe.ease !== undefined) {
        assertEaseReference(
          keyframe.ease,
          `tracks[${trackIndex}].keyframes[${keyframeIndex}].ease`,
          easingVariables,
        );
      }
      if (keyframe.motionPath !== undefined) {
        if (track.property !== "translate") {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath is only valid for translate tracks`,
          );
        }
        if (keyframeIndex === track.keyframes.length - 1) {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath must belong to a keyframe with a following keyframe`,
          );
        }
        if (!isMotionPathSegmentV1(keyframe.motionPath)) {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath must be a finite version 1 cubic with bounded control offsets`,
          );
        }
        const nextKeyframe = track.keyframes[keyframeIndex + 1];
        if (
          !isRecord(nextKeyframe) ||
          typeof nextKeyframe.value !== "string" ||
          !parseMotionPosition(keyframe.value) ||
          !parseMotionPosition(nextKeyframe.value)
        ) {
          invalidDocument(
            `tracks[${trackIndex}].keyframes[${keyframeIndex}].motionPath requires a following finite 2D px Position keyframe`,
          );
        }
      }
      assertOnlyKeys(keyframe, ["t", "value", "ease", "motionPath"]);
    }
  }
  if (
    motionTimelineDurationForTracks(value.durationMs, value.tracks) !==
    value.durationMs
  ) {
    invalidDocument("durationMs must cover every track delay and duration");
  }
}

function assertMotionAudioClips(
  value: unknown,
): asserts value is MotionAudioClip[] {
  if (!Array.isArray(value)) invalidDocument("audioClips must be an array");
  if (value.length > 64) {
    invalidDocument("audioClips must contain 0 to 64 clips");
  }

  const ids = new Set<string>();
  for (const [clipIndex, clip] of value.entries()) {
    const path = `audioClips[${clipIndex}]`;
    if (!isRecord(clip)) invalidDocument(`${path} must be an object`);
    assertOnlyKeys(clip, [
      "id",
      "name",
      "sourceUrl",
      "timelineStartMs",
      "sourceTrimStartMs",
      "durationMs",
      "volume",
      "muted",
    ]);
    requireString(clip.id, `${path}.id`);
    if (
      clip.id.trim().length === 0 ||
      clip.id.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(clip.id)
    ) {
      invalidDocument(`${path}.id must be a non-empty identifier`);
    }
    if (ids.has(clip.id)) invalidDocument(`${path}.id must be unique`);
    ids.add(clip.id);

    if (clip.name !== undefined) {
      requireString(clip.name, `${path}.name`);
      if (
        clip.name.trim().length === 0 ||
        clip.name.length > 240 ||
        /[\u0000-\u001f\u007f]/.test(clip.name)
      ) {
        invalidDocument(
          `${path}.name must contain 1 to 240 printable characters`,
        );
      }
    }

    assertAudioSourceUrl(clip.sourceUrl, `${path}.sourceUrl`);
    requireNonNegativeNumber(clip.timelineStartMs, `${path}.timelineStartMs`);
    requireNonNegativeNumber(
      clip.sourceTrimStartMs,
      `${path}.sourceTrimStartMs`,
    );
    requirePositiveNumber(clip.durationMs, `${path}.durationMs`);
    if (clip.timelineStartMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument(
        `${path}.timelineStartMs exceeds the 120000ms timeline limit`,
      );
    }
    if (clip.durationMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      invalidDocument(`${path}.durationMs exceeds the 120000ms timeline limit`);
    }
    if (
      clip.timelineStartMs + clip.durationMs >
      MOTION_TIMELINE_MAX_DURATION_MS
    ) {
      invalidDocument(`${path} exceeds the 120000ms timeline limit`);
    }
    if (clip.sourceTrimStartMs + clip.durationMs > Number.MAX_SAFE_INTEGER) {
      invalidDocument(
        `${path}.sourceTrimStartMs and durationMs exceed safe precision`,
      );
    }
    requireFiniteNumber(clip.volume, `${path}.volume`);
    if (clip.volume < 0 || clip.volume > 1) {
      invalidDocument(`${path}.volume must be in [0, 1]`);
    }
    if (typeof clip.muted !== "boolean") {
      invalidDocument(`${path}.muted must be a boolean`);
    }
  }
}

function assertAudioSourceUrl(
  value: unknown,
  path: string,
): asserts value is string {
  requireString(value, path);
  if (
    value.length === 0 ||
    value.length > 4096 ||
    value !== value.trim() ||
    /[\\\u0000-\u0020\u007f]/.test(value) ||
    value.startsWith("//")
  ) {
    invalidDocument(`${path} must be a safe audio URL`);
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) {
    invalidDocument(`${path} must use HTTP(S) or a relative URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "https://motion-source.invalid/");
  } catch {
    invalidDocument(`${path} must be a valid audio URL`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    invalidDocument(`${path} must use HTTP(S) or a relative URL`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalidDocument(`unexpected field "${unexpected}"`);
}

function assertEaseReference(
  value: unknown,
  path: string,
  easingVariables: readonly MotionEasingVariable[],
): asserts value is string {
  requireSafeCssToken(value, path);
  try {
    resolveMotionEase(value, easingVariables);
  } catch (error) {
    invalidDocument(
      error instanceof Error
        ? `${path} ${error.message}`
        : `${path} is not a supported timing function`,
    );
  }
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") invalidDocument(`${path} must be a string`);
}

function requireFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalidDocument(`${path} must be a finite number`);
  }
}

function requirePositiveNumber(
  value: unknown,
  path: string,
): asserts value is number {
  requireFiniteNumber(value, path);
  if (value <= 0) invalidDocument(`${path} must be positive`);
}

function requireNonNegativeNumber(
  value: unknown,
  path: string,
): asserts value is number {
  requireFiniteNumber(value, path);
  if (value < 0) invalidDocument(`${path} must be non-negative`);
}

function requirePositiveInteger(
  value: unknown,
  path: string,
): asserts value is number {
  requirePositiveNumber(value, path);
  if (!Number.isInteger(value)) invalidDocument(`${path} must be an integer`);
}

function requireSafeCssToken(
  value: unknown,
  path: string,
): asserts value is string {
  requireString(value, path);
  if (
    value.trim().length === 0 ||
    /[;{}<>]|\/\*|\*\/|\burl\s*\(/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalidDocument(`${path} is not a safe CSS token`);
  }
}

function isPlaybackMode(
  value: unknown,
): value is "loop" | "once" | "ping-pong" {
  return value === "loop" || value === "once" || value === "ping-pong";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDocument(message: string): never {
  throw new TypeError(`Invalid Motion code metadata: ${message}.`);
}
