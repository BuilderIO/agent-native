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
const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "unset",
]);
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

  let hasImportedStylesheet = false;
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase() === "import") {
      hasImportedStylesheet = true;
    }
  });
  if (hasImportedStylesheet) {
    return unsupported(
      "CSS animations with unresolved @import stylesheets cannot be imported losslessly.",
    );
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
    for (const parsedTrack of parsedKeyframes.tracks) {
      tracks.push({
        targetNodeId: animation.targetNodeId,
        property: parsedTrack.property,
        durationMs: animation.durationMs,
        ...(animation.delayMs > 0 ? { delayMs: animation.delayMs } : {}),
        keyframes: parsedTrack.keyframes.map((keyframe, index, frames) => ({
          t: keyframe.t,
          value: keyframe.value,
          ...(index < frames.length - 1 && animation.ease !== DEFAULT_EASE
            ? { ease: animation.ease }
            : {}),
        })),
      });
    }
    usedKeyframeNames.add(animation.name);
  }

  const durationMs = motionTimelineDurationForTracks(0, tracks);
  const validation = validateTracks(tracks, durationMs);
  if (validation) return unsupported(validation);
  if (
    hasConflictingCssTransitions(
      root,
      tracks,
      resolveTarget,
      reducedMotionOverrides,
    )
  ) {
    return unsupported(
      "CSS transitions overlap a Motion target property and cannot be synchronized with the Motion timeline.",
    );
  }

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

function isTransitionProperty(property: string): boolean {
  const normalized = decodeMotionCssIdentifier(property).toLowerCase();
  return (
    normalized === "transition" ||
    normalized.startsWith("transition-") ||
    /^-(?:webkit|moz|ms|o)-transition(?:-|$)/.test(normalized)
  );
}

function normalizedTransitionProperty(property: string): string {
  return decodeMotionCssIdentifier(property)
    .toLowerCase()
    .replace(/^-(?:webkit|moz|ms|o)-/, "");
}

function isTransitionTimingToken(token: string): boolean {
  return (
    /^(?:\d+(?:\.\d*)?|\.\d+)(?:ms|s)?$/i.test(token) ||
    /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|allow-discrete|normal)$/i.test(
      token,
    )
  );
}

function hasConflictingCssTransitions(
  root: postcss.Root,
  tracks: readonly MotionTrack[],
  resolveTarget: MotionAuthoredCssTargetResolver,
  reducedMotionOverrides: ReadonlySet<postcss.Declaration>,
): boolean {
  const propertiesByTarget = new Map<string, Set<string>>();
  for (const track of tracks) {
    const properties = propertiesByTarget.get(track.targetNodeId) ?? new Set();
    properties.add(track.property.toLowerCase());
    propertiesByTarget.set(track.targetNodeId, properties);
  }
  let conflict = false;
  root.walkRules((rule) => {
    if (conflict || isInsideKeyframes(rule)) return;
    const declarations = (rule.nodes ?? []).filter(
      (node): node is postcss.Declaration =>
        node.type === "decl" &&
        isTransitionProperty(node.prop) &&
        !reducedMotionOverrides.has(node),
    );
    if (declarations.length === 0) return;

    for (const candidate of splitCssSelectorList(rule.selector)) {
      const selector = transitionTargetSelector(candidate);
      if (selector === "*") {
        conflict = [...propertiesByTarget.values()].some((properties) =>
          transitionDeclarationsConflict(declarations, properties),
        );
        if (conflict) return;
        continue;
      }
      for (const targetNodeId of resolveTransitionTargets(
        candidate,
        selector,
        resolveTarget,
      )) {
        if (targetNodeId === "*") {
          conflict = [...propertiesByTarget.values()].some((properties) =>
            transitionDeclarationsConflict(declarations, properties),
          );
          if (conflict) return;
          continue;
        }
        const targetProperties = propertiesByTarget.get(targetNodeId);
        if (
          targetProperties &&
          transitionDeclarationsConflict(declarations, targetProperties)
        ) {
          conflict = true;
          return;
        }
      }
    }
  });
  return conflict;
}

function resolveTransitionTargets(
  selectorText: string,
  simpleSelector: string | null,
  resolveTarget: MotionAuthoredCssTargetResolver,
): string[] {
  if (
    /(?:^|[^\\]):{2}[_a-zA-Z]|:(?:before|after|first-line|first-letter)(?:$|[^-_a-zA-Z0-9])/i.test(
      selectorText,
    )
  ) {
    return [];
  }
  const selectors = simpleSelector
    ? [simpleSelector]
    : selectorCompoundAtoms(lastSelectorCompound(selectorText));
  if (selectors.length === 0) return ["*"];
  const targetNodeIds = new Set<string>();
  for (const selector of selectors) {
    if (selector === "*") return ["*"];
    try {
      const resolution = resolveTarget(selector);
      if (!resolution || typeof resolution !== "object") return ["*"];
      if (resolution.status === "resolved") {
        if (
          typeof resolution.targetNodeId !== "string" ||
          resolution.targetNodeId.trim().length === 0
        ) {
          return ["*"];
        }
        targetNodeIds.add(resolution.targetNodeId);
      } else {
        return ["*"];
      }
    } catch {
      return ["*"];
    }
  }
  return [...targetNodeIds];
}

function lastSelectorCompound(selector: string): string {
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\\") {
      index += 1;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets = Math.max(0, brackets - 1);
    } else if (
      parentheses === 0 &&
      brackets === 0 &&
      (/\s/.test(character) || ">+~".includes(character))
    ) {
      start = index + 1;
    }
  }
  return selector.slice(start).trim();
}

function selectorCompoundAtoms(compound: string): string[] {
  const atoms: string[] = [];
  let index = 0;
  while (index < compound.length) {
    const character = compound[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") {
      const start = index;
      let quote: "'" | '"' | null = null;
      index += 1;
      while (index < compound.length) {
        const current = compound[index]!;
        if (quote) {
          if (current === "\\") index += 1;
          else if (current === quote) quote = null;
        } else if (current === "\\") {
          index += 1;
        } else if (current === "'" || current === '"') {
          quote = current;
        } else if (current === "]") {
          index += 1;
          break;
        }
        index += 1;
      }
      atoms.push(compound.slice(start, index));
      continue;
    }
    if (character === ":") {
      index += compound[index + 1] === ":" ? 2 : 1;
      while (/[_a-zA-Z0-9-]/.test(compound[index] ?? "")) index += 1;
      if (compound[index] === "(") {
        let depth = 0;
        do {
          const current = compound[index]!;
          if (current === "\\") index += 1;
          else if (current === "(") depth += 1;
          else if (current === ")") depth -= 1;
          index += 1;
        } while (index < compound.length && depth > 0);
      }
      continue;
    }
    if (character === "#" || character === ".") {
      const start = index++;
      while (/[_a-zA-Z0-9-]/.test(compound[index] ?? "")) index += 1;
      if (index > start + 1) atoms.push(compound.slice(start, index));
      continue;
    }
    if (character === "*" && index === 0) {
      atoms.push("*");
      index += 1;
      continue;
    }
    if (index === 0 && /[_a-zA-Z]/.test(character)) {
      const start = index++;
      while (/[_a-zA-Z0-9-]/.test(compound[index] ?? "")) index += 1;
      atoms.push(compound.slice(start, index));
      continue;
    }
    index += 1;
  }
  return atoms;
}

function transitionTargetSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (trimmed === "*") return trimmed;
  if (
    /(?:^|[^\\])::[_a-zA-Z]/.test(trimmed) ||
    /:(?:before|after|first-line|first-letter)(?:$|[^-_a-zA-Z0-9])/i.test(
      trimmed,
    )
  ) {
    return null;
  }
  if (isStaticSimpleSelector(trimmed)) return trimmed;
  const match = /^(.*?)(?::[_a-zA-Z][-_a-zA-Z0-9]*(?:\([^()]*\))?)+$/.exec(
    trimmed,
  );
  const base = match?.[1]?.trim();
  if (!base || (base !== "*" && !isStaticSimpleSelector(base))) return null;
  return base;
}

function splitCssSelectorList(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\\") {
      index += 1;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets = Math.max(0, brackets - 1);
    } else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(value.slice(start).trim());
  return selectors.filter(Boolean);
}

function transitionDeclarationsConflict(
  declarations: readonly postcss.Declaration[],
  animatedProperties: ReadonlySet<string>,
): boolean {
  let effectiveProperties: string[] | null = null;
  let effectiveImportant = false;
  let propertyListMayBeInherited = false;
  let effectiveDurations: Array<number | null> | null = null;
  let durationsImportant = false;
  let hasTransitionBehavior = false;
  for (const declaration of declarations) {
    const property = normalizedTransitionProperty(declaration.prop);
    if (property === "transition") {
      hasTransitionBehavior = true;
      if (
        effectiveProperties === null ||
        declaration.important ||
        !effectiveImportant
      ) {
        effectiveProperties = transitionPropertyList(declaration.value, true);
        effectiveImportant = declaration.important;
        propertyListMayBeInherited = hasInheritedTransitionPropertyList(
          declaration.value,
        );
      }
      if (
        effectiveDurations === null ||
        declaration.important ||
        !durationsImportant
      ) {
        effectiveDurations = parseTransitionShorthandDurations(
          declaration.value,
        );
        durationsImportant = declaration.important;
      }
    } else if (property === "transition-property") {
      hasTransitionBehavior = true;
      if (
        effectiveProperties === null ||
        declaration.important ||
        !effectiveImportant
      ) {
        effectiveProperties = transitionPropertyList(declaration.value, false);
        effectiveImportant = declaration.important;
        propertyListMayBeInherited = hasInheritedTransitionPropertyList(
          declaration.value,
        );
      }
    } else if (property === "transition-duration") {
      hasTransitionBehavior = true;
      if (
        effectiveDurations === null ||
        declaration.important ||
        !durationsImportant
      ) {
        effectiveDurations = parseTransitionDurationList(declaration.value);
        durationsImportant = declaration.important;
      }
    } else if (property.startsWith("transition-")) {
      hasTransitionBehavior = true;
    }
  }
  if (!hasTransitionBehavior) return false;
  const properties = effectiveProperties ?? ["*"];
  const durations = effectiveDurations ?? [0];
  if (
    propertyListMayBeInherited &&
    durations.some((duration) => duration !== 0)
  ) {
    return true;
  }
  for (const animatedProperty of animatedProperties) {
    let matchingDuration: number | null | undefined;
    for (const [index, property] of properties.entries()) {
      if (property === "none") continue;
      if (property !== "*" && property !== animatedProperty) continue;
      matchingDuration = durations[index % durations.length] ?? null;
    }
    if (matchingDuration === undefined) continue;
    if (matchingDuration !== 0) return true;
  }
  return false;
}

function hasInheritedTransitionPropertyList(value: string): boolean {
  return /^(?:inherit|revert|revert-layer)$/i.test(value.trim());
}

function transitionPropertyList(value: string, shorthand: boolean): string[] {
  const values = splitCssValueList(value);
  if (!shorthand) {
    return values.map((part) => {
      const property = normalizedTransitionProperty(part.trim());
      if (property === "none") return "none";
      if (property === "all") return "*";
      if (CSS_WIDE_KEYWORDS.has(property)) return "*";
      return CSS_IDENTIFIER.test(property) || property.startsWith("--")
        ? property
        : "*";
    });
  }

  return values.map((part) => {
    const withoutFunctions = part.replace(
      /[_a-zA-Z-][-_a-zA-Z0-9]*\([^()]*\)/g,
      " ",
    );
    const identifiers = withoutFunctions.trim().split(/\s+/).filter(Boolean);
    const candidates = identifiers
      .map(normalizedTransitionProperty)
      .filter(
        (identifier) =>
          !isTransitionTimingToken(identifier) &&
          (CSS_IDENTIFIER.test(identifier) || identifier.startsWith("--")),
      );
    if (candidates.length === 1) {
      if (candidates[0] === "none") return "none";
      if (CSS_WIDE_KEYWORDS.has(candidates[0]!)) return "*";
      return candidates[0] === "all" ? "*" : candidates[0]!;
    }
    return candidates.length === 0 && /\bnone\b/i.test(part) ? "none" : "*";
  });
}

function parseTransitionDurationList(value: string): Array<number | null> {
  const normalized = value.trim().toLowerCase();
  if (normalized === "initial" || normalized === "unset") return [0];
  if (CSS_WIDE_KEYWORDS.has(normalized)) return [null];
  return splitCssValueList(value).map(parseTransitionDurationMs);
}

function parseTransitionShorthandDurations(
  value: string,
): Array<number | null> {
  const normalized = value.trim().toLowerCase();
  if (normalized === "initial" || normalized === "unset") return [0];
  if (CSS_WIDE_KEYWORDS.has(normalized)) return [null];

  return splitCssValueList(value).map((part) => {
    const withoutEasingFunctions = part.replace(
      /(?:cubic-bezier|steps|linear)\s*\([^)]*\)/gi,
      " ",
    );
    if (/[_a-zA-Z-][-_a-zA-Z0-9]*\s*\(/.test(withoutEasingFunctions)) {
      return null;
    }

    const tokens = withoutEasingFunctions.trim().split(/\s+/);
    const times: string[] = [];
    for (const token of tokens) {
      if (/^[+-]?(?:\d|\.)/.test(token)) {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:ms|s)$/i.test(token)) {
          return null;
        }
        times.push(token);
      }
    }
    if (times.length > 2) return null;
    if (times.length === 0) return 0;
    return parseTransitionDurationMs(times[0]!);
  });
}

function parseTransitionDurationMs(value: string): number | null {
  const match = /^\+?((?:\d+(?:\.\d*)?|\.\d+))(ms|s)$/i.exec(value.trim());
  if (!match) return null;
  const durationMs =
    Number(match[1]) * (match[2]!.toLowerCase() === "s" ? 1000 : 1);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

function splitCssValueList(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
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
        node.type === "decl" &&
        (isAnimationProperty(node.prop) || isTransitionProperty(node.prop)),
    );
    const animationDeclarations = declarations.filter((declaration) =>
      isAnimationProperty(declaration.prop),
    );
    const durations = animationDeclarations.filter(
      (declaration) =>
        decodeMotionCssIdentifier(declaration.prop).toLowerCase() ===
        "animation-duration",
    );
    const iterations = animationDeclarations.filter(
      (declaration) =>
        decodeMotionCssIdentifier(declaration.prop).toLowerCase() ===
        "animation-iteration-count",
    );
    const transitionDurations = declarations.filter(
      (declaration) =>
        decodeMotionCssIdentifier(declaration.prop).toLowerCase() ===
        "transition-duration",
    );
    if (
      animationDeclarations.length !== 2 ||
      durations.length !== 1 ||
      iterations.length !== 1 ||
      transitionDurations.length > 1 ||
      declarations.length !== 2 + transitionDurations.length ||
      durations[0]!.important !== true ||
      !isReducedMotionDuration(durations[0]!.value) ||
      iterations[0]!.important !== true ||
      iterations[0]!.value.trim() !== "1" ||
      (transitionDurations.length === 1 &&
        (!transitionDurations[0]!.important ||
          !isReducedMotionDuration(transitionDurations[0]!.value)))
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

function isInsideKeyframes(node: postcss.Node): boolean {
  for (
    let parent: postcss.Node | undefined =
      node.type === "decl" ? node.parent : node;
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
  const framesByProperty = new Map<string, ParsedKeyframe[]>();
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
      declarations.length === 0 ||
      (child.nodes ?? []).some(
        (node) => node.type !== "decl" && node.type !== "comment",
      )
    ) {
      return unsupportedKeyframes(
        "Each keyframe stop must declare one or more static properties.",
      );
    }
    const seenProperties = new Set<string>();
    for (const declaration of declarations) {
      const property = declaration.prop.toLowerCase();
      if (seenProperties.has(property)) {
        return unsupportedKeyframes(
          `Keyframe property "${declaration.prop}" is declared more than once at one stop.`,
        );
      }
      seenProperties.add(property);
      if (declaration.important || !SUPPORTED_PROPERTIES.has(property)) {
        return unsupportedKeyframes(
          `Keyframe property "${declaration.prop}" is not supported for lossless import.`,
        );
      }

      const value = declaration.value.trim();
      if (
        value.length === 0 ||
        /\b(?:var|env|attr|anchor|anchor-size)\s*\(/i.test(value)
      ) {
        return unsupportedKeyframes(
          "Runtime CSS values such as var() are unsupported.",
        );
      }
      const frames = framesByProperty.get(property) ?? [];
      frames.push({ t: stop, value });
      framesByProperty.set(property, frames);
    }
  }

  const tracks: Array<{ property: string; keyframes: ParsedKeyframe[] }> = [];
  for (const [property, keyframes] of framesByProperty) {
    keyframes.sort((a, b) => a.t - b.t);
    if (
      keyframes.length < 2 ||
      keyframes[0]!.t !== 0 ||
      keyframes[keyframes.length - 1]!.t !== 1
    ) {
      return unsupportedKeyframes(
        `Keyframes for "${property}" must include both 0% and 100% endpoints.`,
      );
    }
    tracks.push({ property, keyframes });
  }
  if (tracks.length === 0) {
    return unsupportedKeyframes("Keyframes must contain static properties.");
  }
  return { status: "valid", tracks };
}

type KeyframesParseResult =
  | {
      status: "valid";
      tracks: Array<{ property: string; keyframes: ParsedKeyframe[] }>;
    }
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
