import postcss from "postcss";

import {
  MOTION_CODE_METADATA_VERSION,
  decodeMotionCodeMetadata,
  motionCodeDocumentFromTimeline,
  type MotionCodeDocument,
} from "./motion-code";
import { compile, parse } from "./motion-compiler";
import {
  isMotionEaseVariableReference,
  isValidMotionEase,
} from "./motion-easing";
import { motionNativeStylesToTracks } from "./motion-native-style-runtime";
import {
  getMotionTrackTiming,
  motionTimelineDurationForTracks,
  MOTION_TIMELINE_MAX_DURATION_MS,
  readTimelinePlaybackMode,
} from "./motion-timeline";
import type {
  MotionEase,
  MotionTimeline,
  MotionTrack,
} from "./motion-timeline";

export type MotionAuthoredCssTargetResolution =
  | { status: "resolved"; targetNodeId: string }
  | { status: "unresolved" }
  | { status: "ambiguous" }
  | { status: "unsupported"; reason: string };

export type MotionAuthoredCssTargetResolver = (
  selector: string,
) => MotionAuthoredCssTargetResolution;

export type MotionAuthoredCssSimpleSelector =
  | { kind: "type"; name: string }
  | { kind: "id"; value: string }
  | { kind: "class"; value: string }
  | { kind: "attribute"; name: string; value?: string };

export interface MotionAuthoredCssSourceRange {
  /** Half-open UTF-16 offsets into the original CSS string. */
  start: number;
  end: number;
  kind: "selector-rule" | "animation-declaration";
}

export type MotionAuthoredCssImportResult =
  | { status: "absent"; definedKeyframeNames: string[] }
  | { status: "unsupported"; reason: string }
  | {
      status: "valid";
      tracks: MotionTrack[];
      durationMs: number;
      defaultEase: MotionEase;
      keyframeNames: string[];
      definedKeyframeNames: string[];
      rangesToRemove: MotionAuthoredCssSourceRange[];
    };

interface ParsedKeyframe {
  t: number;
  value: string;
}

interface ParsedAnimation {
  selector: string;
  targetNodeId: string;
  name: string;
  durationMs: number;
  delayMs: number;
  ease: MotionEase;
  declarations: postcss.Declaration[];
}

const DEFAULT_EASE: MotionEase = "ease";
const ANIMATION_DECLARATIONS = new Set([
  "animation-name",
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-direction",
  "animation-play-state",
  "animation-composition",
]);

const SUPPORTED_PROPERTIES = new Set([
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "color",
  "background-color",
  "border-radius",
  "border-color",
  "border-width",
  "box-shadow",
]);

const CSS_IDENTIFIER = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const RESERVED_ANIMATION_NAMES = new Set([
  "default",
  "inherit",
  "initial",
  "none",
  "revert",
  "revert-layer",
  "unset",
]);

/**
 * Imports a deliberately small subset of ordinary CSS animations. A valid
 * result is all-or-nothing and includes ranges that remove adopted animation
 * declarations while preserving global keyframe definitions in the source.
 */
export function importAuthoredCssAnimations(
  css: string,
  resolveTarget: MotionAuthoredCssTargetResolver,
): MotionAuthoredCssImportResult {
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return unsupported("CSS could not be parsed safely.");
  }

  if (decodeMotionCodeMetadata(css).status !== "absent") {
    return unsupported("CSS already contains Motion source metadata.");
  }

  const definedKeyframeNames: string[] = [];
  root.walkAtRules((atRule) => {
    if (isKeyframesRule(atRule.name)) {
      const name = atRule.params.trim();
      if (name) definedKeyframeNames.push(name);
    }
  });

  const reducedMotionOverrides = findReducedMotionOverrideDeclarations(root);
  const animationDeclarations: postcss.Declaration[] = [];
  root.walkDecls((declaration) => {
    if (
      !isInsideKeyframes(declaration) &&
      isAnimationProperty(declaration.prop) &&
      !reducedMotionOverrides.has(declaration)
    ) {
      animationDeclarations.push(declaration);
    }
  });
  if (animationDeclarations.length === 0) {
    return { status: "absent", definedKeyframeNames };
  }

  const declarationsByRule = new Map<postcss.Rule, postcss.Declaration[]>();
  for (const declaration of animationDeclarations) {
    const rule = declaration.parent;
    if (
      !rule ||
      rule.type !== "rule" ||
      rule.parent !== root ||
      !rule.nodes?.every(
        (node) => node.type === "decl" || node.type === "comment",
      )
    ) {
      return unsupported(
        "Animation declarations inside nested or conditional rules are unsupported.",
      );
    }
    const declarations = declarationsByRule.get(rule) ?? [];
    declarations.push(declaration);
    declarationsByRule.set(rule, declarations);
  }

  const animations: ParsedAnimation[] = [];
  const targetNodeIds = new Set<string>();
  for (const [rule, declarations] of declarationsByRule) {
    const selector = rule.selector.trim();
    if (!isStaticSimpleSelector(selector)) {
      return unsupported(
        "Each animation rule must use one static simple selector.",
      );
    }

    let resolution: MotionAuthoredCssTargetResolution;
    try {
      resolution = resolveTarget(selector);
    } catch {
      return unsupported(`The selector "${selector}" could not be resolved.`);
    }
    if (!resolution || typeof resolution !== "object") {
      return unsupported(`The selector "${selector}" has an invalid target.`);
    }
    if (resolution.status === "unresolved") {
      return unsupported(`The selector "${selector}" has no static target.`);
    }
    if (resolution.status === "ambiguous") {
      return unsupported(
        `The selector "${selector}" has multiple static targets.`,
      );
    }
    if (resolution.status === "unsupported") {
      return unsupported(resolution.reason);
    }
    if (
      resolution.status !== "resolved" ||
      typeof resolution.targetNodeId !== "string" ||
      resolution.targetNodeId.trim().length === 0
    ) {
      return unsupported(`The selector "${selector}" has an invalid target.`);
    }
    if (targetNodeIds.has(resolution.targetNodeId)) {
      return unsupported(
        "A static target has more than one animation rule; cascade resolution is unsupported.",
      );
    }
    targetNodeIds.add(resolution.targetNodeId);

    const values = new Map<string, string>();
    const seen = new Set<string>();
    for (const declaration of declarations) {
      const property = decodeMotionCssIdentifier(
        declaration.prop,
      ).toLowerCase();
      if (!ANIMATION_DECLARATIONS.has(property)) {
        return unsupported(
          `The animation property "${declaration.prop}" is unsupported.`,
        );
      }
      if (seen.has(property)) {
        return unsupported(
          `The animation property "${property}" is declared more than once.`,
        );
      }
      if (declaration.important) {
        return unsupported("Important animation declarations are unsupported.");
      }
      seen.add(property);
      values.set(property, declaration.value.trim());
    }

    const name = values.get("animation-name");
    if (
      !name ||
      !CSS_IDENTIFIER.test(name) ||
      RESERVED_ANIMATION_NAMES.has(name.toLowerCase())
    ) {
      return unsupported(
        "Each target must have exactly one static animation-name.",
      );
    }

    const durationValue = values.get("animation-duration");
    const durationMs = durationValue ? parseFixedTimeMs(durationValue) : null;
    if (durationMs === null || durationMs <= 0) {
      return unsupported(
        "Each animation needs one positive fixed duration in milliseconds or seconds.",
      );
    }
    const delayValue = values.get("animation-delay") ?? "0s";
    const delayMs = parseFixedTimeMs(delayValue);
    if (delayMs === null) {
      return unsupported(
        "Animation delay must be one non-negative fixed time value.",
      );
    }
    if (durationMs + delayMs > MOTION_TIMELINE_MAX_DURATION_MS) {
      return unsupported("Animation duration and delay exceed 120000ms.");
    }

    if (values.get("animation-fill-mode")?.toLowerCase() !== "both") {
      return unsupported("Each animation must use animation-fill-mode: both.");
    }
    if (
      !isDefaultOrValue(values, "animation-iteration-count", "1") ||
      !isDefaultOrValue(values, "animation-direction", "normal") ||
      !isDefaultOrValue(values, "animation-play-state", "running") ||
      !isDefaultOrValue(values, "animation-composition", "replace")
    ) {
      return unsupported(
        "Animations must use one iteration, normal direction, running state, and replace composition.",
      );
    }

    const ease = values.get("animation-timing-function") ?? DEFAULT_EASE;
    if (!isSupportedCssEase(ease)) {
      return unsupported(
        "Animation timing function is not supported by Motion.",
      );
    }

    animations.push({
      selector,
      targetNodeId: resolution.targetNodeId,
      name,
      durationMs,
      delayMs,
      ease: ease as MotionEase,
      declarations,
    });
  }

  const keyframesByName = new Map<string, postcss.AtRule[]>();
  const unsupportedKeyframes: postcss.AtRule[] = [];
  root.walkAtRules((atRule) => {
    if (!isKeyframesRule(atRule.name)) return;
    if (atRule.name.toLowerCase() !== "keyframes" || atRule.parent !== root) {
      unsupportedKeyframes.push(atRule);
      return;
    }
    const name = atRule.params.trim();
    if (
      !CSS_IDENTIFIER.test(name) ||
      RESERVED_ANIMATION_NAMES.has(name.toLowerCase())
    ) {
      unsupportedKeyframes.push(atRule);
      return;
    }
    const matching = keyframesByName.get(name) ?? [];
    matching.push(atRule);
    keyframesByName.set(name, matching);
  });
  if (unsupportedKeyframes.length > 0) {
    return unsupported(
      "Only top-level standard @keyframes rules are supported.",
    );
  }

  const usedKeyframeNames = new Set<string>();
  const tracks: MotionTrack[] = [];
  for (const animation of animations) {
    const matches = keyframesByName.get(animation.name) ?? [];
    if (matches.length !== 1) {
      return unsupported(
        matches.length === 0
          ? `Animation "${animation.name}" has no matching @keyframes rule.`
          : `Animation "${animation.name}" has duplicate @keyframes rules.`,
      );
    }
    const keyframesRule = matches[0]!;
    const parsedKeyframes = parseKeyframes(keyframesRule);
    if (parsedKeyframes.status !== "valid") return parsedKeyframes;
    const keyframeTrack: MotionTrack = {
      targetNodeId: animation.targetNodeId,
      property: parsedKeyframes.property,
      durationMs: animation.durationMs,
      ...(animation.delayMs > 0 ? { delayMs: animation.delayMs } : {}),
      keyframes: parsedKeyframes.keyframes.map((keyframe, index, frames) => ({
        t: keyframe.t,
        value: keyframe.value,
        ...(index < frames.length - 1 && animation.ease !== DEFAULT_EASE
          ? { ease: animation.ease }
          : {}),
      })),
    };
    tracks.push(keyframeTrack);
    usedKeyframeNames.add(animation.name);
  }

  const durationMs = motionTimelineDurationForTracks(0, tracks);
  const validation = validateTracks(tracks, durationMs);
  if (validation) return unsupported(validation);

  const rangesToRemove: MotionAuthoredCssSourceRange[] = [];
  for (const [rule, declarations] of declarationsByRule) {
    const canRemoveRule = rule.nodes?.every(
      (node) => node.type === "decl" && declarations.includes(node),
    );
    if (canRemoveRule) {
      const range = sourceRange(rule);
      if (!range) {
        return unsupported(
          "An authored animation rule has no exact source range.",
        );
      }
      rangesToRemove.push({ ...range, kind: "selector-rule" });
      continue;
    }
    for (const declaration of declarations) {
      const range = sourceRange(declaration);
      if (!range) {
        return unsupported(
          "An animation declaration has no exact source range.",
        );
      }
      rangesToRemove.push({ ...range, kind: "animation-declaration" });
    }
  }
  rangesToRemove.sort((a, b) => a.start - b.start);

  return {
    status: "valid",
    tracks,
    durationMs,
    defaultEase: DEFAULT_EASE,
    keyframeNames: [...usedKeyframeNames],
    definedKeyframeNames,
    rangesToRemove,
  };
}

/** Merges imported tracks only when the single-timeline model can preserve them. */
export function mergeAuthoredCssMotionDocument(
  existing: MotionCodeDocument | null,
  imported: Pick<
    Extract<MotionAuthoredCssImportResult, { status: "valid" }>,
    "tracks" | "durationMs" | "defaultEase"
  >,
): MotionCodeDocument {
  const importedTracks = imported.tracks.map((track) => ({
    ...track,
    keyframes: track.keyframes.map((keyframe) => ({
      ...keyframe,
      ease: keyframe.ease ?? imported.defaultEase,
    })),
  }));
  const existingTracks = [
    ...(existing?.tracks ?? []),
    ...motionNativeStylesToTracks(existing?.nativeStyles ?? []),
  ];
  const trackKeys = new Set(
    existingTracks.map(
      (track) => `${track.targetNodeId}\u0000${track.property}`,
    ),
  );
  for (const track of importedTracks) {
    const key = `${track.targetNodeId}\u0000${track.property}`;
    if (trackKeys.has(key)) {
      throw new Error(
        `Authored CSS duplicates the ${track.property} Motion track on target "${track.targetNodeId}".`,
      );
    }
    trackKeys.add(key);
  }
  const playbackMode = existing
    ? (existing.playbackMode ?? readTimelinePlaybackMode(existing.tracks))
    : null;
  if (playbackMode && playbackMode !== "once") {
    throw new Error(
      "Authored CSS uses one-pass animations that cannot share a looping Motion timeline.",
    );
  }

  const tracks = [...(existing?.tracks ?? []), ...importedTracks];
  if (tracks.length > 64) {
    throw new Error("Imported CSS exceeds Motion's 64-track limit.");
  }
  return {
    ...(existing ?? {
      version: MOTION_CODE_METADATA_VERSION,
      defaultEase: imported.defaultEase,
    }),
    durationMs: motionTimelineDurationForTracks(
      Math.max(existing?.durationMs ?? 0, imported.durationMs),
      tracks,
    ),
    tracks,
  };
}

/** Removes exact PostCSS ranges while keeping surrounding source text intact. */
export function removeAuthoredCssSourceRanges(
  css: string,
  ranges: readonly MotionAuthoredCssSourceRange[],
): string {
  const expanded = ranges.map((range) =>
    expandSourceRangeToOwnLine(
      css,
      range,
      range.kind === "animation-declaration",
    ),
  );
  const ordered = [...expanded].sort((left, right) => left.start - right.start);
  for (let index = 0; index < ordered.length; index += 1) {
    const range = ordered[index]!;
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end > css.length ||
      range.start >= range.end ||
      (index > 0 && ordered[index - 1]!.end > range.start)
    ) {
      throw new Error(
        "Authored CSS removal ranges are invalid or overlapping.",
      );
    }
  }
  let result = css;
  for (const range of [...ordered].reverse()) {
    result = `${result.slice(0, range.start)}${result.slice(range.end)}`;
  }
  return result;
}

function expandSourceRangeToOwnLine(
  source: string,
  range: MotionAuthoredCssSourceRange,
  requireWholeLine = false,
): MotionAuthoredCssSourceRange {
  const lineStart = source.lastIndexOf("\n", range.start - 1) + 1;
  const lineEnd = source.indexOf("\n", range.end);
  const startOnOwnLine = /^[\t \r\f]*$/.test(
    source.slice(lineStart, range.start),
  );
  const endOnOwnLine =
    lineEnd !== -1 && /^[\t \r\f]*$/.test(source.slice(range.end, lineEnd));
  if (requireWholeLine && (!startOnOwnLine || !endOnOwnLine)) return range;
  return {
    ...range,
    start: startOnOwnLine ? lineStart : range.start,
    end: endOnOwnLine ? lineEnd + 1 : range.end,
  };
}

function unsupported(reason: string): MotionAuthoredCssImportResult {
  return { status: "unsupported", reason };
}

function isAnimationProperty(property: string): boolean {
  const normalized = decodeMotionCssIdentifier(property).toLowerCase();
  return (
    normalized === "animation" ||
    normalized.startsWith("animation-") ||
    /^-[a-z]+-animation(?:-|$)/.test(normalized)
  );
}

function findReducedMotionOverrideDeclarations(
  root: postcss.Root,
): Set<postcss.Declaration> {
  const overrides = new Set<postcss.Declaration>();
  root.walkRules((rule) => {
    const media = rule.parent;
    if (
      !media ||
      media.type !== "atrule" ||
      media.name.toLowerCase() !== "media" ||
      media.parent !== root ||
      media.params.replace(/\s+/g, "").toLowerCase() !==
        "(prefers-reduced-motion:reduce)" ||
      rule.selector.replace(/\s+/g, "").toLowerCase() !==
        "*,*::before,*::after" ||
      !rule.nodes?.every(
        (node) => node.type === "decl" || node.type === "comment",
      )
    ) {
      return;
    }

    const declarations = rule.nodes.filter(
      (node): node is postcss.Declaration =>
        node.type === "decl" && isAnimationProperty(node.prop),
    );
    const durations = declarations.filter(
      (declaration) =>
        decodeMotionCssIdentifier(declaration.prop).toLowerCase() ===
        "animation-duration",
    );
    const iterations = declarations.filter(
      (declaration) =>
        decodeMotionCssIdentifier(declaration.prop).toLowerCase() ===
        "animation-iteration-count",
    );
    if (
      declarations.length !== 2 ||
      durations.length !== 1 ||
      iterations.length !== 1 ||
      durations[0]!.important !== true ||
      !isReducedMotionDuration(durations[0]!.value) ||
      iterations[0]!.important !== true ||
      iterations[0]!.value.trim() !== "1"
    ) {
      return;
    }

    for (const declaration of declarations) overrides.add(declaration);
  });
  return overrides;
}

function isReducedMotionDuration(value: string): boolean {
  const match = /^(\d+(?:\.\d*)?|\.\d+)(ms|s)$/i.exec(value.trim());
  if (!match) return false;
  const durationMs =
    Number(match[1]) * (match[2]!.toLowerCase() === "s" ? 1000 : 1);
  return Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 1;
}

function isInsideKeyframes(declaration: postcss.Declaration): boolean {
  for (
    let parent: postcss.Node | undefined = declaration.parent;
    parent;
    parent = parent.parent ?? undefined
  ) {
    if (
      parent.type === "atrule" &&
      isKeyframesRule((parent as postcss.AtRule).name)
    ) {
      return true;
    }
  }
  return false;
}

export function decodeMotionCssIdentifier(value: string): string {
  return value.replace(
    /\\(?:([a-f\d]{1,6})(?:\r\n|[\t\n\f\r ])?|([\r\n\f])|([^\r\n\f]))/gi,
    (
      _match,
      hex: string | undefined,
      newline: string | undefined,
      char: string | undefined,
    ) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        if (
          codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return "\ufffd";
        }
        return String.fromCodePoint(codePoint);
      }
      return newline ? "" : (char ?? "");
    },
  );
}

function isKeyframesRule(name: string): boolean {
  return /(?:^|-)[a-z]*keyframes$/i.test(name);
}

function isStaticSimpleSelector(selector: string): boolean {
  return parseMotionAuthoredCssSimpleSelector(selector) !== null;
}

export function parseMotionAuthoredCssSimpleSelector(
  selector: string,
): MotionAuthoredCssSimpleSelector | null {
  if (/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(selector)) {
    return { kind: "type", name: selector.toLowerCase() };
  }
  if (/^#-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(selector)) {
    return { kind: "id", value: selector.slice(1) };
  }
  if (/^\.-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(selector)) {
    return { kind: "class", value: selector.slice(1) };
  }
  const match =
    /^\[\s*([_a-zA-Z][_a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"\\]*)"|'([^'\\]*)'|([_a-zA-Z][_a-zA-Z0-9-]*)))?\s*\]$/.exec(
      selector,
    );
  if (!match) return null;
  const value = match[2] ?? match[3] ?? match[4];
  return {
    kind: "attribute",
    name: match[1]!.toLowerCase(),
    ...(value !== undefined ? { value } : {}),
  };
}

function isDefaultOrValue(
  values: Map<string, string>,
  property: string,
  expected: string,
): boolean {
  const value = values.get(property);
  return value === undefined || value.toLowerCase() === expected;
}

function parseFixedTimeMs(value: string): number | null {
  const match = /^(\d+(?:\.\d*)?|\.\d+)(ms|s)$/i.exec(value.trim());
  if (!match) return null;
  const raw = Number(match[1]);
  const milliseconds = raw * (match[2]!.toLowerCase() === "s" ? 1000 : 1);
  if (
    !Number.isFinite(milliseconds) ||
    Math.abs(milliseconds - Math.round(milliseconds)) > 1e-8 ||
    milliseconds < 0 ||
    milliseconds > MOTION_TIMELINE_MAX_DURATION_MS
  ) {
    return null;
  }
  return Math.round(milliseconds);
}

function isSupportedCssEase(value: string): boolean {
  const normalized = value.trim();
  return (
    !/^spring(?:\s*\(|\s*$)/i.test(normalized) &&
    !isMotionEaseVariableReference(normalized) &&
    isValidMotionEase(normalized)
  );
}

function parseKeyframes(atRule: postcss.AtRule): KeyframesParseResult {
  const frames: ParsedKeyframe[] = [];
  let property: string | null = null;
  const seenTimes = new Set<number>();

  for (const child of atRule.nodes ?? []) {
    if (child.type === "comment") continue;
    if (child.type !== "rule") {
      return unsupportedKeyframes(
        "Keyframes may contain only static stop rules.",
      );
    }
    const stop = parseKeyframeSelector(child.selector);
    if (stop === null) {
      return unsupportedKeyframes(
        "Keyframe stops must be unique numeric percentages from 0% to 100%, or from/to.",
      );
    }
    if (seenTimes.has(stop)) {
      return unsupportedKeyframes("Keyframe stop percentages must be unique.");
    }
    seenTimes.add(stop);

    const declarations = (child.nodes ?? []).filter(
      (node): node is postcss.Declaration => node.type === "decl",
    );
    if (
      declarations.length !== 1 ||
      (child.nodes ?? []).some(
        (node) => node.type !== "decl" && node.type !== "comment",
      )
    ) {
      return unsupportedKeyframes(
        "Each keyframe stop must declare exactly one static property.",
      );
    }
    const declaration = declarations[0]!;
    const currentProperty = declaration.prop.toLowerCase();
    if (
      declaration.important ||
      !SUPPORTED_PROPERTIES.has(currentProperty) ||
      (property !== null && property !== currentProperty)
    ) {
      return unsupportedKeyframes(
        `Keyframe property "${declaration.prop}" is not supported for lossless import.`,
      );
    }
    property = currentProperty;

    const value = declaration.value.trim();
    if (
      value.length === 0 ||
      /\b(?:var|env|attr|anchor|anchor-size)\s*\(/i.test(value)
    ) {
      return unsupportedKeyframes(
        "Runtime CSS values such as var() are unsupported.",
      );
    }
    frames.push({ t: stop, value });
  }

  frames.sort((a, b) => a.t - b.t);
  if (
    frames.length < 2 ||
    frames[0]!.t !== 0 ||
    frames[frames.length - 1]!.t !== 1
  ) {
    return unsupportedKeyframes(
      "Keyframes must include both 0% and 100% endpoints.",
    );
  }
  return { status: "valid", property: property!, keyframes: frames };
}

type KeyframesParseResult =
  | { status: "valid"; property: string; keyframes: ParsedKeyframe[] }
  | { status: "unsupported"; reason: string };

function unsupportedKeyframes(
  reason: string,
): Extract<KeyframesParseResult, { status: "unsupported" }> {
  return { status: "unsupported", reason };
}

function parseKeyframeSelector(selector: string): number | null {
  const value = selector.trim();
  if (/^from$/i.test(value)) return 0;
  if (/^to$/i.test(value)) return 1;
  const match = /^(\d+(?:\.\d*)?|\.\d+)%$/.exec(value);
  if (!match) return null;
  const percent = Number(match[1]);
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-8
  ) {
    return null;
  }
  return percent / 100;
}

function sourceRange(
  node: postcss.Node,
): { start: number; end: number } | null {
  const start = node.source?.start?.offset;
  const end = node.source?.end?.offset;
  return Number.isInteger(start) && Number.isInteger(end) && start! < end!
    ? { start: start!, end: end! }
    : null;
}

function validateTracks(
  tracks: MotionTrack[],
  durationMs: number,
): string | null {
  const timeline: MotionTimeline = {
    id: "authored-css-import",
    designId: "authored-css-import",
    sourceRef: null,
    filePath: null,
    tracks,
    durationMs,
    defaultEase: DEFAULT_EASE,
    compiledHash: null,
    createdAt: "",
    updatedAt: "",
  };

  try {
    motionCodeDocumentFromTimeline(timeline);
    const parsedTracks = parse(compile(timeline).css);
    if (!tracksRoundTrip(tracks, parsedTracks, durationMs)) {
      return "Imported keyframes cannot be represented by the Motion compiler and parser.";
    }
  } catch (error) {
    return error instanceof Error
      ? `Imported animation is not a valid Motion track: ${error.message}`
      : "Imported animation is not a valid Motion track.";
  }
  return null;
}

function tracksRoundTrip(
  expectedTracks: MotionTrack[],
  actualTracks: MotionTrack[],
  durationMs: number,
): boolean {
  if (expectedTracks.length !== actualTracks.length) return false;
  return expectedTracks.every((expected) => {
    const actual = actualTracks.find(
      (track) =>
        track.targetNodeId === expected.targetNodeId &&
        track.property === expected.property,
    );
    if (!actual || expected.keyframes.length !== actual.keyframes.length) {
      return false;
    }
    const expectedTiming = getMotionTrackTiming(expected, durationMs);
    const actualTiming = getMotionTrackTiming(actual, durationMs);
    if (
      expectedTiming.startMs !== actualTiming.startMs ||
      expectedTiming.durationMs !== actualTiming.durationMs
    ) {
      return false;
    }
    return expected.keyframes.every((keyframe, index) => {
      const parsed = actual.keyframes[index];
      if (
        !parsed ||
        keyframe.t !== parsed.t ||
        keyframe.value !== parsed.value
      ) {
        return false;
      }
      return (
        index === expected.keyframes.length - 1 ||
        (parsed.ease ?? DEFAULT_EASE) === (keyframe.ease ?? DEFAULT_EASE)
      );
    });
  });
}
