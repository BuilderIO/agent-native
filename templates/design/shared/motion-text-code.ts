import { parse } from "parse5";

import {
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
} from "./motion-compiler";
import { isValidMotionEase } from "./motion-easing";
import type { MotionPlaybackMode } from "./motion-timeline";

export const MOTION_TEXT_SOURCE_VERSION = 2 as const;
export const MOTION_TEXT_SOURCE_VERSION_PROVENANCE: unique symbol = Symbol(
  "motion-text-source-version-provenance",
);
export const MOTION_TEXT_SOURCE_ATTRIBUTE =
  "data-agent-native-motion-text-source";
export const MOTION_TEXT_RUNTIME_ATTRIBUTE =
  "data-agent-native-motion-text-runtime";

export const MOTION_TEXT_UNITS = [
  "character",
  "word",
  "line",
  "paragraph",
] as const;
export const MOTION_TEXT_ORDERS = [
  "left-to-right",
  "right-to-left",
  "center-out",
  "random",
  "top-to-bottom",
  "bottom-to-top",
] as const;
export const MOTION_TEXT_PROPERTIES = [
  "opacity",
  "translate",
  "scale",
  "rotate",
  "filter",
] as const;

export type MotionTextUnit = (typeof MOTION_TEXT_UNITS)[number];
export type MotionTextDirection = "forward" | "reverse";
export type MotionTextAnimationDirection = "in" | "out";
export type MotionTextOrder = (typeof MOTION_TEXT_ORDERS)[number];
export type MotionTextProperty = (typeof MOTION_TEXT_PROPERTIES)[number];

export interface MotionTextKeyframe {
  t: number;
  value: string;
  ease?: string;
}

export interface MotionTextAnimation {
  targetNodeId: string;
  unit: MotionTextUnit;
  direction: MotionTextDirection;
  staggerMs: number;
  animationDirection?: MotionTextAnimationDirection;
  order?: MotionTextOrder;
  overlapPercent?: number;
  ignoreSpaces?: boolean;
  /** Crops the target element to its own box while any of its tracks sets this. */
  clipContent?: boolean;
  /** Pivot of each unit as a percentage of its own box; both are set together. */
  originX?: number;
  originY?: number;
  delayMs?: number;
  property: MotionTextProperty;
  durationMs: number;
  keyframes: MotionTextKeyframe[];
}

export interface MotionTextDocument {
  version: 1 | typeof MOTION_TEXT_SOURCE_VERSION;
  [MOTION_TEXT_SOURCE_VERSION_PROVENANCE]?:
    | 1
    | typeof MOTION_TEXT_SOURCE_VERSION;
  animations: MotionTextAnimation[];
}

export type MotionTextSourceErrorCode =
  | "malformed-document"
  | "unsupported-version"
  | "malformed-json"
  | "invalid-document"
  | "duplicate-marker"
  | "malformed-marker"
  | "target-missing"
  | "target-ambiguous"
  | "unsupported-target";

export class MotionTextSourceError extends Error {
  constructor(
    readonly code: MotionTextSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MotionTextSourceError";
  }
}

export type MotionTextReadResult =
  | { status: "absent" }
  | { status: "valid"; document: MotionTextDocument }
  | { status: "invalid"; error: MotionTextSourceError };

const MAX_TEXT_ANIMATIONS = 64;
const MAX_TEXT_KEYFRAMES = 128;
const MAX_TEXT_DURATION_MS = 120_000;
export const MAX_MOTION_TEXT_STAGGER_MS = MAX_TEXT_DURATION_MS;
const MAX_RUNTIME_UNITS = 512;
const PARAGRAPH_TAGS = new Set([
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
]);
const INLINE_TEXT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);
const TEXT_PROPERTY_ALLOWLIST = new Set<MotionTextProperty>(
  MOTION_TEXT_PROPERTIES,
);
type MotionTextSegmenter = new (
  locales: string | string[] | undefined,
  options: { granularity: "word" | "grapheme" },
) => {
  segment(value: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

function motionTextSegmenter(): MotionTextSegmenter | undefined {
  return (Intl as unknown as { Segmenter?: MotionTextSegmenter }).Segmenter;
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
  sourceCodeLocation?: {
    startOffset?: number;
    endOffset?: number;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
  };
};

interface ManagedScript {
  node: HtmlNode;
  start: number;
  end: number;
}

function sourceError(code: MotionTextSourceErrorCode, message: string): never {
  throw new MotionTextSourceError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  const allowed = new Set(keys);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) {
    sourceError(
      "invalid-document",
      `${field} contains unsupported field "${extra}".`,
    );
  }
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    sourceError("invalid-document", `${field} must be a finite number.`);
  }
  return value;
}

function originPercent(value: unknown, field: string): number {
  const percent = finiteNumber(value, field);
  if (percent < 0 || percent > 100) {
    sourceError("invalid-document", `${field} must be between 0 and 100.`);
  }
  return percent;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    sourceError("invalid-document", `${field} must be a non-empty string.`);
  }
  return value;
}

function normalizeMotionTextDocument(value: unknown): MotionTextDocument {
  if (!isRecord(value)) {
    sourceError("invalid-document", "Motion text source must be an object.");
  }
  const sourceVersion = value.version;
  if (sourceVersion !== 1 && sourceVersion !== MOTION_TEXT_SOURCE_VERSION) {
    sourceError(
      value.version === undefined || typeof value.version !== "number"
        ? "malformed-document"
        : "unsupported-version",
      `Motion text source version must be 1 or ${MOTION_TEXT_SOURCE_VERSION}.`,
    );
  }
  assertOnlyKeys(value, ["version", "animations"], "Motion text source");
  if (
    !Array.isArray(value.animations) ||
    value.animations.length < 1 ||
    value.animations.length > MAX_TEXT_ANIMATIONS
  ) {
    sourceError(
      "invalid-document",
      `Motion text source must contain 1 to ${MAX_TEXT_ANIMATIONS} animations.`,
    );
  }

  const targetTracks = new Map<
    string,
    {
      unit: MotionTextUnit;
      direction: MotionTextDirection;
      staggerMs: number;
      animationDirection: MotionTextAnimationDirection;
      order: MotionTextOrder;
      overlapPercent?: number;
      ignoreSpaces: boolean;
      properties: Set<MotionTextProperty>;
    }
  >();
  const animations = value.animations.map((raw, animationIndex) => {
    const field = `animations[${animationIndex}]`;
    if (!isRecord(raw)) {
      sourceError("invalid-document", `${field} must be an object.`);
    }
    assertOnlyKeys(
      raw,
      sourceVersion === 1
        ? [
            "targetNodeId",
            "unit",
            "direction",
            "staggerMs",
            "delayMs",
            "property",
            "durationMs",
            "keyframes",
          ]
        : [
            "targetNodeId",
            "unit",
            "direction",
            "staggerMs",
            "animationDirection",
            "order",
            "overlapPercent",
            "ignoreSpaces",
            "clipContent",
            "originX",
            "originY",
            "delayMs",
            "property",
            "durationMs",
            "keyframes",
          ],
      field,
    );

    const targetNodeId = requiredString(
      raw.targetNodeId,
      `${field}.targetNodeId`,
    );
    if (!MOTION_TEXT_UNITS.includes(raw.unit as MotionTextUnit)) {
      sourceError(
        "invalid-document",
        `${field}.unit must be character, word, line, or paragraph.`,
      );
    }
    if (raw.direction !== "forward" && raw.direction !== "reverse") {
      sourceError(
        "invalid-document",
        `${field}.direction must be forward or reverse.`,
      );
    }
    if (!TEXT_PROPERTY_ALLOWLIST.has(raw.property as MotionTextProperty)) {
      sourceError(
        "invalid-document",
        `${field}.property must be opacity, translate, scale, or rotate.`,
      );
    }

    const unit = raw.unit as MotionTextUnit;
    const direction = raw.direction as MotionTextDirection;
    const animationDirection: MotionTextAnimationDirection =
      raw.animationDirection === undefined
        ? "in"
        : (raw.animationDirection as MotionTextAnimationDirection);
    if (animationDirection !== "in" && animationDirection !== "out") {
      sourceError(
        "invalid-document",
        `${field}.animationDirection must be in or out.`,
      );
    }
    const order =
      raw.order === undefined
        ? direction === "reverse"
          ? "right-to-left"
          : "left-to-right"
        : raw.order;
    if (!MOTION_TEXT_ORDERS.includes(order as MotionTextOrder)) {
      sourceError("invalid-document", `${field}.order is not supported.`);
    }
    if (
      (order === "top-to-bottom" || order === "bottom-to-top") &&
      unit !== "line" &&
      unit !== "paragraph"
    ) {
      sourceError(
        "invalid-document",
        `${field}.order requires line or paragraph units for vertical ordering.`,
      );
    }
    const overlapPercent =
      raw.overlapPercent === undefined
        ? undefined
        : finiteNumber(raw.overlapPercent, `${field}.overlapPercent`);
    if (
      overlapPercent !== undefined &&
      (overlapPercent < 0 || overlapPercent > 100)
    ) {
      sourceError(
        "invalid-document",
        `${field}.overlapPercent must be between 0 and 100.`,
      );
    }
    const ignoreSpaces =
      raw.ignoreSpaces === undefined ? true : raw.ignoreSpaces;
    if (typeof ignoreSpaces !== "boolean") {
      sourceError(
        "invalid-document",
        `${field}.ignoreSpaces must be a boolean.`,
      );
    }
    const clipContent = raw.clipContent === undefined ? false : raw.clipContent;
    if (typeof clipContent !== "boolean") {
      sourceError(
        "invalid-document",
        `${field}.clipContent must be a boolean.`,
      );
    }
    const origin =
      raw.originX === undefined && raw.originY === undefined
        ? undefined
        : {
            originX: originPercent(raw.originX ?? 50, `${field}.originX`),
            originY: originPercent(raw.originY ?? 50, `${field}.originY`),
          };
    const property = raw.property as MotionTextProperty;
    const durationMs = finiteNumber(raw.durationMs, `${field}.durationMs`);
    if (durationMs <= 0 || durationMs > MAX_TEXT_DURATION_MS) {
      sourceError(
        "invalid-document",
        `${field}.durationMs must be between 1 and ${MAX_TEXT_DURATION_MS}.`,
      );
    }
    const staggerMs = finiteNumber(raw.staggerMs, `${field}.staggerMs`);
    const maxStaggerMs = MAX_MOTION_TEXT_STAGGER_MS;
    if (staggerMs < 0 || staggerMs > maxStaggerMs) {
      sourceError(
        "invalid-document",
        `${field}.staggerMs must be between 0 and ${maxStaggerMs}.`,
      );
    }
    const targetTrack = targetTracks.get(targetNodeId);
    if (targetTrack) {
      if (
        targetTrack.unit !== unit ||
        targetTrack.direction !== direction ||
        (overlapPercent === undefined && targetTrack.staggerMs !== staggerMs) ||
        targetTrack.animationDirection !== animationDirection ||
        targetTrack.order !== order ||
        targetTrack.overlapPercent !== overlapPercent ||
        (unit === "character" && targetTrack.ignoreSpaces !== ignoreSpaces)
      ) {
        sourceError(
          "invalid-document",
          `Text animations for node "${targetNodeId}" must use the same unit, direction, and timing settings.`,
        );
      }
      if (targetTrack.properties.has(property)) {
        sourceError(
          "invalid-document",
          `Text animation property "${property}" is duplicated for node "${targetNodeId}".`,
        );
      }
      targetTrack.properties.add(property);
    } else {
      targetTracks.set(targetNodeId, {
        unit,
        direction,
        staggerMs,
        animationDirection,
        order: order as MotionTextOrder,
        overlapPercent,
        ignoreSpaces,
        properties: new Set([property]),
      });
    }
    const delayMs =
      raw.delayMs === undefined
        ? 0
        : finiteNumber(raw.delayMs, `${field}.delayMs`);
    if (delayMs < 0 || delayMs > 120_000) {
      sourceError(
        "invalid-document",
        `${field}.delayMs must be between 0 and 120000.`,
      );
    }
    if (
      !Array.isArray(raw.keyframes) ||
      raw.keyframes.length < 2 ||
      raw.keyframes.length > MAX_TEXT_KEYFRAMES
    ) {
      sourceError(
        "invalid-document",
        `${field}.keyframes must contain 2 to ${MAX_TEXT_KEYFRAMES} frames.`,
      );
    }
    let previousT = -1;
    const keyframes = raw.keyframes.map((rawKeyframe, keyframeIndex) => {
      const keyframeField = `${field}.keyframes[${keyframeIndex}]`;
      if (!isRecord(rawKeyframe)) {
        sourceError("invalid-document", `${keyframeField} must be an object.`);
      }
      assertOnlyKeys(rawKeyframe, ["t", "value", "ease"], keyframeField);
      const t = finiteNumber(rawKeyframe.t, `${keyframeField}.t`);
      if (t < 0 || t > 1 || t <= previousT) {
        sourceError(
          "invalid-document",
          `${keyframeField}.t must be strictly increasing in [0, 1].`,
        );
      }
      previousT = t;

      const frameValue = requiredString(
        rawKeyframe.value,
        `${keyframeField}.value`,
      );
      assertSafeMotionCssToken(frameValue, `${keyframeField}.value`);

      const ease =
        rawKeyframe.ease === undefined
          ? undefined
          : requiredString(rawKeyframe.ease, `${keyframeField}.ease`);
      if (ease !== undefined) {
        if (!isValidMotionEase(ease)) {
          sourceError(
            "invalid-document",
            `${keyframeField}.ease must be a supported Motion easing.`,
          );
        }
        assertSafeMotionCssToken(ease, `${keyframeField}.ease`);
      }
      return {
        t,
        value: frameValue,
        ...(ease !== undefined ? { ease } : {}),
      };
    });
    if (keyframes[0]?.t !== 0 || keyframes[keyframes.length - 1]?.t !== 1) {
      sourceError(
        "invalid-document",
        `${field}.keyframes must start at 0 and end at 1.`,
      );
    }

    assertSafeMotionCssProperty(property, `${field}.property`);

    return {
      targetNodeId,
      unit,
      direction,
      staggerMs,
      animationDirection,
      order: order as MotionTextOrder,
      ...(overlapPercent !== undefined ? { overlapPercent } : {}),
      ignoreSpaces,
      ...(clipContent ? { clipContent } : {}),
      ...origin,
      delayMs,
      property,
      durationMs,
      keyframes,
    };
  });

  const document: MotionTextDocument = {
    version: MOTION_TEXT_SOURCE_VERSION,
    animations,
  };
  // Keep decode provenance available without emitting it in normalized source.
  Object.defineProperty(document, MOTION_TEXT_SOURCE_VERSION_PROVENANCE, {
    value: sourceVersion,
    enumerable: false,
  });
  return document;
}

export function encodeMotionTextDocument(document: MotionTextDocument): string {
  return JSON.stringify(normalizeMotionTextDocument(document));
}

export function decodeMotionTextDocument(json: string): MotionTextReadResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return {
      status: "invalid",
      error: new MotionTextSourceError(
        "malformed-json",
        "Motion text source is not valid JSON.",
      ),
    };
  }
  try {
    return { status: "valid", document: normalizeMotionTextDocument(value) };
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionTextSourceError
          ? error
          : new MotionTextSourceError(
              "invalid-document",
              error instanceof Error
                ? error.message
                : "Motion text source could not be validated.",
            ),
    };
  }
}

function walkHtmlNodes(root: HtmlNode): HtmlNode[] {
  const nodes: HtmlNode[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    nodes.push(node);
    pending.push(...(node.childNodes ?? []).reverse());
  }
  return nodes;
}

function attrValue(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textContent).join("");
}

type MotionTextWordChunk = {
  value: string;
  word: boolean;
  start: number;
  end: number;
};

type MotionTextWordRange = { start: number; end: number };

function motionTextWordRanges(value: string): MotionTextWordRange[] {
  const Segmenter = motionTextSegmenter();
  const chunks: MotionTextWordChunk[] = [];
  let offset = 0;
  const segments = Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: "word" }).segment(value),
        (part) => ({ value: part.segment, word: Boolean(part.isWordLike) }),
      )
    : (value.match(/\s+|[^\s]+/gu) ?? []).map((part) => ({
        value: part,
        word: !/^\s+$/u.test(part),
      }));
  for (const segment of segments) {
    const start = offset;
    offset += segment.value.length;
    chunks.push({ ...segment, start, end: offset });
  }
  let remainingWords = chunks.reduce(
    (count, chunk) => count + Number(chunk.word),
    0,
  );
  const ranges: MotionTextWordRange[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (/^\s+$/u.test(chunk.value)) {
      continue;
    }
    if (chunk.word) {
      remainingWords -= 1;
      ranges.push({ start: chunk.start, end: chunk.end });
      continue;
    }
    const previous = ranges[ranges.length - 1];
    if (previous?.end === chunk.start) {
      previous.end = chunk.end;
      continue;
    }
    if (remainingWords > 0) {
      const start = chunk.start;
      let end = chunk.end;
      while (
        index + 1 < chunks.length &&
        !chunks[index + 1]!.word &&
        !/^\s+$/u.test(chunks[index + 1]!.value)
      ) {
        end = chunks[++index]!.end;
      }
      ranges.push({ start, end });
    }
  }
  return ranges;
}

function wordUnitCount(value: string): number {
  return motionTextWordRanges(value).length;
}

function textNodeValues(node: HtmlNode): string[] {
  if (node.nodeName === "#text") return [node.value ?? ""];
  return (node.childNodes ?? []).flatMap(textNodeValues);
}

function lineTextFragmentCount(target: HtmlNode): number {
  const leaves = textNodeValues(target);
  const ranges = motionTextWordRanges(leaves.join(""));
  let rangeIndex = 0;
  let textOffset = 0;
  let count = 0;

  for (const value of leaves) {
    const leafStart = textOffset;
    const leafEnd = leafStart + value.length;
    textOffset = leafEnd;
    while (rangeIndex < ranges.length && ranges[rangeIndex]!.end <= leafStart) {
      rangeIndex += 1;
    }
    for (
      let index = rangeIndex;
      index < ranges.length && ranges[index]!.start < leafEnd;
      index += 1
    ) {
      const start = Math.max(leafStart, ranges[index]!.start);
      const end = Math.min(leafEnd, ranges[index]!.end);
      if (
        end > start &&
        !/^\s+$/u.test(value.slice(start - leafStart, end - leafStart))
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function staticTextUnitCount(
  target: HtmlNode,
  animation: MotionTextAnimation,
): number | null {
  if (animation.unit === "line") {
    const maximumLineCount = lineTextFragmentCount(target);
    if (maximumLineCount === 0) {
      sourceError(
        "unsupported-target",
        `Motion text target "${animation.targetNodeId}" has no animatable text units.`,
      );
    }
    if (maximumLineCount > MAX_RUNTIME_UNITS) {
      sourceError(
        "unsupported-target",
        `Motion text target "${animation.targetNodeId}" exceeds the ${MAX_RUNTIME_UNITS}-unit runtime limit.`,
      );
    }
    // Each emitted word fragment can occupy a distinct rendered line.
    return maximumLineCount;
  }
  if (animation.unit === "paragraph") {
    if (PARAGRAPH_TAGS.has(target.tagName ?? "")) return 1;
    const children = (target.childNodes ?? []).filter(
      (node) => node.tagName !== undefined,
    );
    return children.length > 0 &&
      children.every((node) => PARAGRAPH_TAGS.has(node.tagName!))
      ? children.length
      : 1;
  }

  const value = textContent(target);
  if (animation.unit === "word") return wordUnitCount(value);
  const Segmenter = motionTextSegmenter();
  const characters = Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: "grapheme" }).segment(value),
        (part) => part.segment,
      )
    : Array.from(value);
  return animation.ignoreSpaces === false
    ? characters.length
    : characters.filter((character) => !/^\s+$/u.test(character)).length;
}

function assertSupportedStaticTextSpan(
  target: HtmlNode,
  animation: MotionTextAnimation,
): void {
  const unitCount = staticTextUnitCount(target, animation);
  if (unitCount === null) return;
  if (unitCount === 0) {
    sourceError(
      "unsupported-target",
      `Motion text target "${animation.targetNodeId}" has no animatable text units.`,
    );
  }
  if (unitCount > MAX_RUNTIME_UNITS) {
    sourceError(
      "unsupported-target",
      `Motion text target "${animation.targetNodeId}" exceeds the ${MAX_RUNTIME_UNITS}-unit runtime limit.`,
    );
  }
  const overlap = animation.overlapPercent;
  const unitDuration =
    overlap === undefined
      ? animation.durationMs
      : animation.durationMs / (1 + (unitCount - 1) * (1 - overlap / 100));
  const staggerMs =
    overlap === undefined
      ? animation.staggerMs
      : unitDuration * (1 - overlap / 100);
  const animationSpanMs =
    (animation.delayMs ?? 0) + (unitCount - 1) * staggerMs + unitDuration;
  if (
    !Number.isFinite(animationSpanMs) ||
    animationSpanMs > MAX_TEXT_DURATION_MS
  ) {
    const unitCountDescription =
      animation.unit === "line" ? `at most ${unitCount}` : String(unitCount);
    sourceError(
      "unsupported-target",
      `Motion text target "${animation.targetNodeId}" resolves to ${unitCountDescription} ${animation.unit} units whose animation span exceeds the ${MAX_TEXT_DURATION_MS}ms runtime limit.`,
    );
  }
}

function parseHtml(html: string): {
  root: HtmlNode;
  nodes: HtmlNode[];
} {
  const root = parse(html, {
    sourceCodeLocationInfo: true,
  }) as unknown as HtmlNode;
  return { root, nodes: walkHtmlNodes(root) };
}

function isManagedScript(node: HtmlNode, name: string): boolean {
  return node.tagName === "script" && attrValue(node, name) !== undefined;
}

function managedScriptRange(node: HtmlNode): ManagedScript {
  const location = node.sourceCodeLocation;
  if (
    !location ||
    location.startOffset === undefined ||
    location.endOffset === undefined
  ) {
    return sourceError(
      "malformed-marker",
      "A managed Motion text script has no complete source range.",
    );
  }
  return { node, start: location.startOffset, end: location.endOffset };
}

function parseManagedScripts(html: string): {
  sourceScripts: ManagedScript[];
  runtimeScripts: ManagedScript[];
  parsedNodes: HtmlNode[];
} {
  const { nodes } = parseHtml(html);
  return {
    sourceScripts: nodes
      .filter((node) => isManagedScript(node, MOTION_TEXT_SOURCE_ATTRIBUTE))
      .map(managedScriptRange),
    runtimeScripts: nodes
      .filter((node) => isManagedScript(node, MOTION_TEXT_RUNTIME_ATTRIBUTE))
      .map(managedScriptRange),
    parsedNodes: nodes,
  };
}

function readScriptText(node: HtmlNode): string {
  return (node.childNodes ?? [])
    .filter((child) => child.nodeName === "#text")
    .map((child) => child.value ?? "")
    .join("");
}

export function readMotionTextDocument(html: string): MotionTextReadResult {
  let scripts: ReturnType<typeof parseManagedScripts>;
  try {
    scripts = parseManagedScripts(html);
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionTextSourceError
          ? error
          : new MotionTextSourceError(
              "malformed-marker",
              error instanceof Error
                ? error.message
                : "Motion text markers could not be read.",
            ),
    };
  }

  if (scripts.sourceScripts.length > 1 || scripts.runtimeScripts.length > 1) {
    return {
      status: "invalid",
      error: new MotionTextSourceError(
        "duplicate-marker",
        "HTML contains duplicate managed Motion text scripts.",
      ),
    };
  }
  if (scripts.sourceScripts.length === 0) {
    return scripts.runtimeScripts.length === 0
      ? { status: "absent" }
      : {
          status: "invalid",
          error: new MotionTextSourceError(
            "malformed-marker",
            "Motion text runtime exists without its versioned source document.",
          ),
        };
  }

  const sourceScript = scripts.sourceScripts[0]!.node;
  const sourceMarkerVersion = attrValue(
    sourceScript,
    MOTION_TEXT_SOURCE_ATTRIBUTE,
  );
  const supportedSourceVersions = new Set([
    "v1",
    `v${MOTION_TEXT_SOURCE_VERSION}`,
  ]);
  if (!supportedSourceVersions.has(sourceMarkerVersion ?? "")) {
    return {
      status: "invalid",
      error: new MotionTextSourceError(
        /^v\d+$/.test(sourceMarkerVersion ?? "")
          ? "unsupported-version"
          : "malformed-marker",
        `Motion text source marker version "${sourceMarkerVersion ?? ""}" is not supported.`,
      ),
    };
  }
  const runtimeScript = scripts.runtimeScripts[0]?.node;
  if (
    runtimeScript &&
    attrValue(runtimeScript, MOTION_TEXT_RUNTIME_ATTRIBUTE) !==
      sourceMarkerVersion
  ) {
    const runtimeMarkerVersion = attrValue(
      runtimeScript,
      MOTION_TEXT_RUNTIME_ATTRIBUTE,
    );
    return {
      status: "invalid",
      error: new MotionTextSourceError(
        /^v\d+$/.test(runtimeMarkerVersion ?? "")
          ? "unsupported-version"
          : "malformed-marker",
        `Motion text runtime marker version "${runtimeMarkerVersion ?? ""}" is not supported.`,
      ),
    };
  }
  if (attrValue(sourceScript, "type")?.toLowerCase() !== "application/json") {
    return {
      status: "invalid",
      error: new MotionTextSourceError(
        "malformed-marker",
        "Motion text source must use an application/json script element.",
      ),
    };
  }
  const decoded = decodeMotionTextDocument(readScriptText(sourceScript));
  if (decoded.status !== "valid") return decoded;
  try {
    assertSupportedMotionTextTargets(html, decoded.document);
    return decoded;
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionTextSourceError
          ? error
          : new MotionTextSourceError(
              "invalid-document",
              error instanceof Error
                ? error.message
                : "Motion text targets could not be validated.",
            ),
    };
  }
}

function hasDynamicTextBindings(target: HtmlNode): boolean {
  const stack = [target];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.attrs?.some(({ name }) => /^(?:x-|:|@|v-text|v-html)/i.test(name))
    ) {
      return true;
    }
    if (/\{\{[\s\S]*?\}\}/.test(node.value ?? "")) return true;
    stack.push(...(node.childNodes ?? []));
  }
  for (
    let ancestor = target.parentNode;
    ancestor;
    ancestor = ancestor.parentNode
  ) {
    if (
      ancestor.tagName === "template" ||
      ancestor.attrs?.some(({ name }) =>
        /^(?:x-if|x-for|v-if|v-for)$/i.test(name),
      )
    ) {
      return true;
    }
  }
  return false;
}

function hasStaticInlineTextContent(target: HtmlNode): boolean {
  if (target.tagName === undefined || textContent(target).trim().length === 0) {
    return false;
  }
  const pending = [...(target.childNodes ?? [])];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.nodeName === "#text" || node.nodeName === "#comment") continue;
    if (
      !node.tagName ||
      !INLINE_TEXT_TAGS.has(node.tagName) ||
      attrValue(node, "id") !== undefined ||
      attrValue(node, "data-agent-native-node-id") !== undefined
    ) {
      return false;
    }
    pending.push(...(node.childNodes ?? []));
  }
  return true;
}

function assertSupportedMotionTextTargets(
  html: string,
  document: MotionTextDocument,
): void {
  const { nodes } = parseHtml(html);
  const elements = nodes.filter((node) => node.tagName !== undefined);
  for (const animation of document.animations) {
    const targets = elements.filter(
      (node) =>
        attrValue(node, "data-agent-native-node-id") === animation.targetNodeId,
    );
    if (targets.length === 0) {
      sourceError(
        "target-missing",
        `Motion text target "${animation.targetNodeId}" is not present in this HTML file.`,
      );
    }
    if (targets.length > 1) {
      sourceError(
        "target-ambiguous",
        `Motion text target "${animation.targetNodeId}" appears more than once in this HTML file.`,
      );
    }
    const target = targets[0]!;
    if (hasDynamicTextBindings(target)) {
      sourceError(
        "unsupported-target",
        `Motion text target "${animation.targetNodeId}" has dynamic text or structural bindings; only static inline HTML text is supported.`,
      );
    }
    if (animation.unit === "paragraph") {
      const childElements = (target.childNodes ?? []).filter(
        (node) => node.tagName !== undefined,
      );
      const hasParagraphChildren =
        childElements.length > 0 &&
        childElements.every((node) => PARAGRAPH_TAGS.has(node.tagName!));
      if (
        !PARAGRAPH_TAGS.has(target.tagName!) &&
        !hasParagraphChildren &&
        !hasStaticInlineTextContent(target)
      ) {
        sourceError(
          "unsupported-target",
          `Paragraph Text animation requires a paragraph element, direct paragraph children, or a plain text element.`,
        );
      }
      assertSupportedStaticTextSpan(target, animation);
      continue;
    }
    if (!hasStaticInlineTextContent(target)) {
      sourceError(
        "unsupported-target",
        `Character, word, and line Text animations require static text with supported inline formatting; block, dynamic, and identity-bearing descendants are not supported.`,
      );
    }
    assertSupportedStaticTextSpan(target, animation);
  }
}

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * This is emitted as source JavaScript rather than serialized with Function#toString,
 * so a build tool or server runtime cannot change the generated program.
 */
export const MOTION_TEXT_RUNTIME_SOURCE = String.raw`(function (source) {
  var animations = source.animations;
  var playbackMode = source.playbackMode;
  if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!document || typeof document.querySelectorAll !== "function") throw new Error("Motion text runtime requires a document.");
  var previewBridge = typeof window !== "undefined" && window.__designMotionPreviewBridge === true;
  var previewAnimations = [];
  var allTargets = Array.prototype.slice.call(document.querySelectorAll("[data-agent-native-node-id]"));
  var paragraphTags = { blockquote: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true, li: true, p: true };
  function textTokens(value, kind, ignoreSpaces) {
    var Segmenter = typeof Intl !== "undefined" ? Intl.Segmenter : null;
    if (kind === "character") {
      var characters = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value), function (part) { return part.segment; }) : Array.from(value);
      return characters.map(function (part) { return { value: part, animated: !ignoreSpaces || !/^\s+$/u.test(part) }; });
    }
    var chunks;
    if (Segmenter) {
      chunks = Array.from(new Segmenter(undefined, { granularity: "word" }).segment(value), function (part) { return { value: part.segment, word: !!part.isWordLike }; });
    } else {
      chunks = (value.match(/\s+|[^\s]+/gu) || []).map(function (part) { return { value: part, word: !/^\s+$/u.test(part) }; });
    }
    var tokens = [];
    for (var index = 0; index < chunks.length; index += 1) {
      var chunk = chunks[index];
      if (/^\s+$/u.test(chunk.value)) {
        tokens.push({ value: chunk.value, animated: !ignoreSpaces });
      } else if (chunk.word) {
        tokens.push({ value: chunk.value, animated: true });
      } else if (
        tokens.length &&
        tokens[tokens.length - 1].animated &&
        !/^\s+$/u.test(tokens[tokens.length - 1].value)
      ) {
        tokens[tokens.length - 1].value += chunk.value;
      } else {
        var nextWord = chunks.slice(index + 1).findIndex(function (candidate) { return candidate.word; });
        if (nextWord >= 0) {
          var punctuation = chunk.value;
          while (index + 1 < chunks.length && !chunks[index + 1].word && !/^\s+$/u.test(chunks[index + 1].value)) punctuation += chunks[++index].value;
          tokens.push({ value: punctuation, animated: true });
        } else {
          tokens.push({ value: chunk.value, animated: false });
        }
      }
    }
    return tokens;
  }
  function descendantTextNodes(target) {
    var nodes = [];
    function visit(node) {
      if (node.nodeName === "#text") { nodes.push(node); return; }
      Array.prototype.slice.call(node.childNodes || []).forEach(visit);
    }
    visit(target);
    return nodes;
  }
  function nodeText(node) {
    return typeof node.nodeValue === "string" ? node.nodeValue : (node.value || "");
  }
  function splitTextTarget(target, kind, ignoreSpaces) {
    var leaves = descendantTextNodes(target);
    var value = leaves.map(nodeText).join("");
    var tokens = textTokens(value, kind === "line" ? "word" : kind, ignoreSpaces);
    var units = [];
    var sourceOffset = 0;
    tokens.forEach(function (token) {
      var start = sourceOffset;
      var end = start + token.value.length;
      sourceOffset = end;
      if (token.animated) units.push({ start: start, end: end, index: units.length, fragments: [] });
    });
    if (units.length === 0) throw new Error("Motion text target has no animatable text units.");
    if (units.length > ${MAX_RUNTIME_UNITS}) throw new Error("Motion text target exceeds the ${MAX_RUNTIME_UNITS}-unit runtime limit.");

    var leafOffset = 0;
    leaves.forEach(function (leaf) {
      var text = nodeText(leaf);
      var leafStart = leafOffset;
      var leafEnd = leafStart + text.length;
      leafOffset = leafEnd;
      if (!text.length) return;

      var fragment = document.createDocumentFragment();
      var cursor = 0;
      var pendingWhitespaceText = "";
      var pendingWhitespaceUnits = [];
      function flushPendingWhitespace() {
        if (!pendingWhitespaceText) return;
        fragment.appendChild(document.createTextNode(pendingWhitespaceText));
        // Keep collapsible whitespace in-flow while giving each unit a transformable box.
        pendingWhitespaceUnits.forEach(function (unit) {
          var whitespaceBox = document.createElement("span");
          whitespaceBox.setAttribute("data-agent-native-motion-text-unit", String(unit.index));
          whitespaceBox.setAttribute("aria-hidden", "true");
          whitespaceBox.style.position = "absolute";
          whitespaceBox.style.display = "block";
          whitespaceBox.style.width = "0";
          whitespaceBox.style.height = "0";
          whitespaceBox.style.overflow = "hidden";
          fragment.appendChild(whitespaceBox);
          unit.fragments.push(whitespaceBox);
        });
        pendingWhitespaceText = "";
        pendingWhitespaceUnits = [];
      }
      tokens.forEach(function (token) {
        var tokenStart = cursor;
        var tokenEnd = tokenStart + token.value.length;
        cursor = tokenEnd;
        var start = Math.max(leafStart, tokenStart);
        var end = Math.min(leafEnd, tokenEnd);
        if (start >= end) return;
        var part = text.slice(start - leafStart, end - leafStart);
        if (!token.animated) {
          flushPendingWhitespace();
          fragment.appendChild(document.createTextNode(part));
          return;
        }
        var unitIndex = units.findIndex(function (unit) { return unit.start === tokenStart; });
        var unit = units[unitIndex];
        if (/^\s+$/u.test(part)) {
          pendingWhitespaceText += part;
          pendingWhitespaceUnits.push(unit);
          return;
        }
        flushPendingWhitespace();
        var span = document.createElement("span");
        span.setAttribute("data-agent-native-motion-text-unit", String(unit.index));
        span.style.display = "inline-block";
        span.appendChild(document.createTextNode(part));
        fragment.appendChild(span);
        unit.fragments.push(span);
      });
      flushPendingWhitespace();
      if (leaf.parentNode) leaf.parentNode.replaceChild(fragment, leaf);
    });
    return units;
  }
  function paragraphUnits(target) {
    var tag = String(target.tagName || "").toLowerCase();
    if (paragraphTags[tag]) return [target];
    var children = Array.prototype.slice.call(target.children || []);
    if (children.length && children.every(function (child) { return paragraphTags[String(child.tagName || "").toLowerCase()]; })) return children;
    return [target];
  }
  function lineGroups(units) {
    var tops = [];
    return units.map(function (unit, index) {
      var top = unit.getBoundingClientRect().top;
      var found = tops.findIndex(function (existing) { return Math.abs(existing - top) < 0.5; });
      if (found < 0) { tops.push(top); found = tops.length - 1; }
      return { unit: unit, index: found };
    });
  }
  function textOrderRanks(count, order, seed) {
    var indexes = Array.from({ length: count }, function (_, index) { return index; });
    if (order === "right-to-left" || order === "bottom-to-top") indexes.reverse();
    else if (order === "center-out") indexes.sort(function (left, right) {
      var center = (count - 1) / 2;
      return Math.abs(left - center) - Math.abs(right - center) || left - right;
    });
    else if (order === "random") {
      var state = 2166136261;
      var seedValue = String(seed);
      for (var seedIndex = 0; seedIndex < seedValue.length; seedIndex += 1) {
        state = Math.imul(state ^ seedValue.charCodeAt(seedIndex), 16777619);
      }
      for (var shuffleIndex = indexes.length - 1; shuffleIndex > 0; shuffleIndex -= 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        var swapIndex = state % (shuffleIndex + 1);
        var current = indexes[shuffleIndex];
        indexes[shuffleIndex] = indexes[swapIndex];
        indexes[swapIndex] = current;
      }
    }
    var ranks = [];
    indexes.forEach(function (index, rank) { ranks[index] = rank; });
    return ranks;
  }
  function springSample(bounce, settle, x) {
    if (x <= 0) return 0;
    var u = x / settle;
    if (u >= 1) return 1;
    var zeta = Math.min(1, Math.max(0.02, 1 - bounce));
    var omega = Math.log(1 / 0.001) / zeta;
    if (zeta >= 1) return 1 - Math.exp(-omega * u) * (1 + omega * u);
    var omegaD = omega * Math.sqrt(1 - zeta * zeta);
    var decay = Math.exp(-zeta * omega * u);
    return 1 - decay * (Math.cos(omegaD * u) + ((zeta * omega) / omegaD) * Math.sin(omegaD * u));
  }
  function springToLinear(bounce, settle) {
    var sampleCount = 16 + Math.round(bounce * 34);
    var stops = [];
    for (var index = 0; index <= sampleCount; index += 1) {
      var value = index === sampleCount ? 1 : springSample(bounce, settle, index / sampleCount);
      stops.push((Math.round(value * 10000) / 10000).toString());
    }
    return "linear(" + stops.join(", ") + ")";
  }
  function motionEaseForWebAnimations(ease, element) {
    var resolved = ease;
    var reference = /^var\(--an-motion-ease-([a-z0-9][a-z0-9-]{0,63})\)$/.exec(String(ease));
    if (reference) {
      var property = "--an-motion-ease-" + reference[1];
      resolved = window.getComputedStyle(element).getPropertyValue(property).trim();
      if (!resolved || /^var\(/i.test(resolved)) throw new Error("Motion easing variable " + property + " is not defined or does not resolve to a concrete easing.");
    }
    var normalized = String(resolved).trim();
    if (normalized.toLowerCase() === "spring") return springToLinear(0.25, 1);
    var spring = /^spring\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:,\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*)?\)$/i.exec(normalized);
    if (/^spring/i.test(normalized) && !spring) throw new Error("Motion text easing is not supported: " + normalized);
    if (spring) return springToLinear(Number(spring[1]), Number(spring[2] || 1));
    return resolved;
  }
  var targetGroups = [];
  animations.forEach(function (animation) {
    var group = targetGroups.find(function (candidate) { return candidate.targetNodeId === animation.targetNodeId; });
    if (!group) { group = { targetNodeId: animation.targetNodeId, animations: [] }; targetGroups.push(group); }
    group.animations.push(animation);
  });
  targetGroups.forEach(function (targetGroup) {
    var animation = targetGroup.animations[0];
    var matches = allTargets.filter(function (candidate) { return candidate.getAttribute("data-agent-native-node-id") === targetGroup.targetNodeId; });
    if (matches.length !== 1) throw new Error("Motion text target " + targetGroup.targetNodeId + " resolved to " + matches.length + " elements.");
    var target = matches[0];
    var entries;
    if (animation.unit === "paragraph") {
      entries = paragraphUnits(target).map(function (unit, index) { return { unit: unit, index: index }; });
    } else {
      var ignoreSpaces = animation.unit === "character"
        ? animation.ignoreSpaces !== false
        : true;
      var units = splitTextTarget(target, animation.unit, ignoreSpaces);
      var fragments = units.reduce(function (all, unit) { return all.concat(unit.fragments); }, []);
      entries = animation.unit === "line"
        ? lineGroups(fragments)
        : fragments.map(function (unit) { return { unit: unit, index: Number(unit.getAttribute("data-agent-native-motion-text-unit")) }; });
    }
    // Each run is its own script, so the crop owner is kept on the element. Only the current owner may lift the crop.
    var cropOwner = target.__anMotionCrop;
    if (targetGroup.animations.some(function (track) { return track.clipContent === true; })) {
      var owner = { original: cropOwner ? cropOwner.original : (target.style.clipPath || "") };
      target.__anMotionCrop = owner;
      target.style.clipPath = "inset(0)";
      // The editor preview rewrites the units in place instead of reloading, so lift the crop once they are gone.
      // A paragraph target is its own unit, so it never counts as contained and any rewrite of its content lifts the crop.
      if (typeof MutationObserver === "function") {
        new MutationObserver(function (records, observer) {
          if (target.__anMotionCrop !== owner) { observer.disconnect(); return; }
          if (entries.some(function (entry) { return entry.unit !== target && target.contains(entry.unit); })) return;
          target.style.clipPath = owner.original;
          delete target.__anMotionCrop;
          observer.disconnect();
        }).observe(target, { childList: true, subtree: true });
      }
    } else if (cropOwner) {
      target.style.clipPath = cropOwner.original;
      delete target.__anMotionCrop;
    }
    var groupCount = entries.reduce(function (count, entry) { return Math.max(count, entry.index + 1); }, 0);
    if (groupCount > ${MAX_RUNTIME_UNITS}) throw new Error("Motion text target exceeds the ${MAX_RUNTIME_UNITS}-unit runtime limit.");
    var order = animation.order || (animation.direction === "reverse" ? "right-to-left" : "left-to-right");
    var orderRanks = textOrderRanks(groupCount, order, targetGroup.targetNodeId + "|" + target.textContent);
    targetGroup.animations.forEach(function (track) {
      var unitDuration = track.durationMs;
      var staggerMs = track.staggerMs;
      if (typeof track.overlapPercent === "number") {
        var overlap = Math.max(0, Math.min(100, track.overlapPercent)) / 100;
        unitDuration = track.durationMs / (1 + Math.max(0, groupCount - 1) * (1 - overlap));
        staggerMs = unitDuration * (1 - overlap);
      }
      var animationSpanMs = track.delayMs + Math.max(0, groupCount - 1) * staggerMs + unitDuration;
      if (entries.length && (!Number.isFinite(animationSpanMs) || animationSpanMs > 120000)) throw new Error("Motion text animation span exceeds the 120000ms runtime limit.");
      entries.forEach(function (entry) {
        if (typeof entry.unit.animate !== "function") throw new Error("Motion text requires the Web Animations API.");
        if (typeof track.originX === "number") entry.unit.style.transformOrigin = track.originX + "% " + track.originY + "%";
        var delayIndex = orderRanks[entry.index] === undefined ? entry.index : orderRanks[entry.index];
        var animateOut = track.animationDirection === "out";
        var keyframes = (animateOut ? track.keyframes.slice().reverse() : track.keyframes).map(function (keyframe, keyframeIndex) {
          var easingKeyframe = animateOut && keyframeIndex < track.keyframes.length - 1
            ? track.keyframes[track.keyframes.length - 2 - keyframeIndex]
            : keyframe;
          var frame = {
            offset: animateOut ? 1 - keyframe.t : keyframe.t,
            easing: motionEaseForWebAnimations(easingKeyframe.ease || "ease", entry.unit)
          };
          frame[track.property] = keyframe.value;
          return frame;
        });
        var delay = track.delayMs + delayIndex * staggerMs;
        var options = { duration: unitDuration, delay: delay, fill: "both" };
        var pingPong = !previewBridge && playbackMode === "ping-pong";
        if (pingPong) options.direction = "alternate";
        if (!previewBridge && playbackMode !== "once") {
          options.iterations = Infinity;
        }
        var runningAnimation = entry.unit.animate(keyframes, options);
        if (previewBridge) {
          runningAnimation.pause();
          runningAnimation.currentTime = 0;
          previewAnimations.push({ animation: runningAnimation, delay: delay, duration: unitDuration });
        }
      });
    });
  });
  var previewSpanDurationMs = previewAnimations.reduce(function (duration, entry) {
    return Math.max(duration, entry.delay + entry.duration);
  }, 0);
  function reportPreviewSpanDuration() {
    if (previewBridge && window.parent && typeof window.parent.postMessage === "function") {
      window.parent.postMessage({ type: "motion-preview-span", key: "html", durationMs: previewSpanDurationMs }, "*");
    }
  }
  if (previewBridge && typeof window.addEventListener === "function") {
    window.addEventListener("message", function (event) {
      if (event.source !== window.parent || !event.data || typeof event.data.type !== "string") return;
      if (event.data.type === "motion-preview-duration-request") {
        reportPreviewSpanDuration();
        return;
      }
      if (event.data.type === "motion-preview") {
        var t = Number(event.data.t);
        var timelineDuration = Number(event.data.durationMs);
        if (!Number.isFinite(t) || !Number.isFinite(timelineDuration) || timelineDuration <= 0) return;
        if (previewSpanDurationMs > timelineDuration) reportPreviewSpanDuration();
        var timelineTime = Math.max(0, Math.min(1, t)) * timelineDuration;
        previewAnimations.forEach(function (entry) {
          entry.animation.currentTime = Math.max(0, Math.min(entry.delay + entry.duration, timelineTime));
        });
      } else if (event.data.type === "motion-preview-clear") {
        previewAnimations.forEach(function (entry) { entry.animation.currentTime = 0; });
      }
    });
  }
})(__MOTION_TEXT_SOURCE__);`;

export interface CompiledMotionTextRuntime {
  document: MotionTextDocument;
  sourceMarkup: string;
  runtimeMarkup: string;
}

export function compileMotionTextRuntime(
  document: MotionTextDocument,
  playbackMode: MotionPlaybackMode = "once",
): CompiledMotionTextRuntime {
  const normalized = normalizeMotionTextDocument(document);
  const source = { animations: normalized.animations, playbackMode };
  const json = scriptSafeJson(normalized);
  const runtimeSource = MOTION_TEXT_RUNTIME_SOURCE.replace(
    "__MOTION_TEXT_SOURCE__",
    () => scriptSafeJson(source),
  );
  if (runtimeSource === MOTION_TEXT_RUNTIME_SOURCE) {
    sourceError("malformed-marker", "Motion text runtime template is invalid.");
  }
  return {
    document: normalized,
    sourceMarkup: `<script type="application/json" ${MOTION_TEXT_SOURCE_ATTRIBUTE}="v${MOTION_TEXT_SOURCE_VERSION}">${json}</script>`,
    runtimeMarkup: `<script ${MOTION_TEXT_RUNTIME_ATTRIBUTE}="v${MOTION_TEXT_SOURCE_VERSION}">${runtimeSource}</script>`,
  };
}

function applyManagedScriptEdits(
  html: string,
  edits: Array<{ start: number; end: number; replacement: string }>,
): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (content, edit) =>
        `${content.slice(0, edit.start)}${edit.replacement}${content.slice(edit.end)}`,
      html,
    );
}

function bodyEndTagOffset(nodes: HtmlNode[]): number | null {
  const body = nodes.find((node) => node.tagName === "body");
  return body?.sourceCodeLocation?.endTag?.startOffset ?? null;
}

/**
 * Stores a versioned JSON source record and a deterministic Web Animations API
 * runtime in managed script tags. The current safe authoring boundary is
 * static inline HTML; JSX/React and dynamic template bindings are refused.
 */
export function injectMotionTextRuntime(
  html: string,
  document: MotionTextDocument,
  playbackMode: MotionPlaybackMode = "once",
): string {
  const normalized = normalizeMotionTextDocument(document);
  assertSupportedMotionTextTargets(html, normalized);

  const existingRead = readMotionTextDocument(html);
  if (existingRead.status === "invalid") throw existingRead.error;
  const parsed = parseManagedScripts(html);
  if (parsed.sourceScripts.length > 1 || parsed.runtimeScripts.length > 1) {
    sourceError(
      "duplicate-marker",
      "HTML contains duplicate managed Motion text scripts.",
    );
  }

  const compiled = compileMotionTextRuntime(normalized, playbackMode);
  const existing = [...parsed.sourceScripts, ...parsed.runtimeScripts].sort(
    (left, right) => left.start - right.start,
  );

  if (existing.length > 0) {
    const edits = existing.map((script, index) => ({
      start: script.start,
      end: script.end,
      replacement:
        index === 0
          ? `${compiled.sourceMarkup}\n${compiled.runtimeMarkup}`
          : "",
    }));
    return applyManagedScriptEdits(html, edits);
  }

  const insertion = bodyEndTagOffset(parsed.parsedNodes) ?? html.length;
  return `${html.slice(0, insertion)}${compiled.sourceMarkup}\n${compiled.runtimeMarkup}${html.slice(insertion)}`;
}

/** Removes the managed text source and runtime scripts, preserving all HTML around them. */
export function removeMotionTextRuntime(html: string): string {
  const existingRead = readMotionTextDocument(html);
  if (existingRead.status === "invalid") throw existingRead.error;
  if (existingRead.status === "absent") return html;

  const parsed = parseManagedScripts(html);
  const [source] = parsed.sourceScripts;
  const [runtime] = parsed.runtimeScripts;
  if (
    source &&
    runtime &&
    source.end <= runtime.start &&
    html.slice(source.end, runtime.start) === "\n"
  ) {
    return applyManagedScriptEdits(html, [
      { start: source.start, end: runtime.end, replacement: "" },
    ]);
  }

  return applyManagedScriptEdits(
    html,
    [...parsed.sourceScripts, ...parsed.runtimeScripts].map(
      ({ start, end }) => ({ start, end, replacement: "" }),
    ),
  );
}
