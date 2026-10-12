import { parse } from "parse5";

import {
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
} from "./motion-compiler";
import { isValidMotionEase } from "./motion-easing";
import type { MotionPlaybackMode } from "./motion-timeline";

export const MOTION_TEXT_SOURCE_VERSION = 1 as const;
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
export const MOTION_TEXT_PROPERTIES = [
  "opacity",
  "translate",
  "scale",
  "rotate",
  "filter",
] as const;

export type MotionTextUnit = (typeof MOTION_TEXT_UNITS)[number];
export type MotionTextDirection = "forward" | "reverse";
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
  delayMs?: number;
  property: MotionTextProperty;
  durationMs: number;
  keyframes: MotionTextKeyframe[];
}

export interface MotionTextDocument {
  version: typeof MOTION_TEXT_SOURCE_VERSION;
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
const MAX_TEXT_STAGGER_MS = 5_000;
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
  if (value.version !== MOTION_TEXT_SOURCE_VERSION) {
    sourceError(
      value.version === undefined || typeof value.version !== "number"
        ? "malformed-document"
        : "unsupported-version",
      `Motion text source version must be ${MOTION_TEXT_SOURCE_VERSION}.`,
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
      [
        "targetNodeId",
        "unit",
        "direction",
        "staggerMs",
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
    const property = raw.property as MotionTextProperty;
    const staggerMs = finiteNumber(raw.staggerMs, `${field}.staggerMs`);
    if (staggerMs < 0 || staggerMs > MAX_TEXT_STAGGER_MS) {
      sourceError(
        "invalid-document",
        `${field}.staggerMs must be between 0 and ${MAX_TEXT_STAGGER_MS}.`,
      );
    }
    const targetTrack = targetTracks.get(targetNodeId);
    if (targetTrack) {
      if (
        targetTrack.unit !== unit ||
        targetTrack.direction !== direction ||
        targetTrack.staggerMs !== staggerMs
      ) {
        sourceError(
          "invalid-document",
          `Text animations for node "${targetNodeId}" must use the same unit, direction, and stagger.`,
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
    const durationMs = finiteNumber(raw.durationMs, `${field}.durationMs`);
    if (durationMs <= 0 || durationMs > MAX_TEXT_DURATION_MS) {
      sourceError(
        "invalid-document",
        `${field}.durationMs must be between 1 and ${MAX_TEXT_DURATION_MS}.`,
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
      delayMs,
      property,
      durationMs,
      keyframes,
    };
  });

  return { version: MOTION_TEXT_SOURCE_VERSION, animations };
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
  if (sourceMarkerVersion !== `v${MOTION_TEXT_SOURCE_VERSION}`) {
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
      `v${MOTION_TEXT_SOURCE_VERSION}`
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
      continue;
    }
    if (!hasStaticInlineTextContent(target)) {
      sourceError(
        "unsupported-target",
        `Character, word, and line Text animations require static text with supported inline formatting; block, dynamic, and identity-bearing descendants are not supported.`,
      );
    }
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
  function textTokens(value, kind) {
    var Segmenter = typeof Intl !== "undefined" ? Intl.Segmenter : null;
    if (kind === "character") {
      var characters = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value), function (part) { return part.segment; }) : Array.from(value);
      return characters.map(function (part) { return { value: part, animated: !/^\s+$/u.test(part) }; });
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
        tokens.push({ value: chunk.value, animated: false });
      } else if (chunk.word) {
        tokens.push({ value: chunk.value, animated: true });
      } else if (tokens.length && tokens[tokens.length - 1].animated) {
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
  function splitTextTarget(target, kind) {
    var leaves = descendantTextNodes(target);
    var value = leaves.map(nodeText).join("");
    var tokens = textTokens(value, kind === "line" ? "word" : kind);
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
      tokens.forEach(function (token) {
        var tokenStart = cursor;
        var tokenEnd = tokenStart + token.value.length;
        cursor = tokenEnd;
        var start = Math.max(leafStart, tokenStart);
        var end = Math.min(leafEnd, tokenEnd);
        if (start >= end) return;
        var part = text.slice(start - leafStart, end - leafStart);
        if (!token.animated) {
          fragment.appendChild(document.createTextNode(part));
          return;
        }
        var unitIndex = units.findIndex(function (unit) { return unit.start === tokenStart; });
        var unit = units[unitIndex];
        var span = document.createElement("span");
        span.setAttribute("data-agent-native-motion-text-unit", String(unit.index));
        span.style.display = "inline-block";
        span.appendChild(document.createTextNode(part));
        fragment.appendChild(span);
        unit.fragments.push(span);
      });
      if (leaf.parentNode) leaf.parentNode.replaceChild(fragment, leaf);
    });
    return units;
  }
  function paragraphUnits(target) {
    var tag = String(target.tagName || "").toLowerCase();
    if (paragraphTags[tag]) return [target];
    var children = Array.prototype.slice.call(target.children || []);
    if (children.length && children.every(function (child) { return paragraphTags[String(child.tagName || "").toLowerCase()]; })) return children;
    if (children.length) throw new Error("Paragraph Text animation found unsupported nested elements.");
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
      var units = splitTextTarget(target, animation.unit);
      var fragments = units.reduce(function (all, unit) { return all.concat(unit.fragments); }, []);
      entries = animation.unit === "line"
        ? lineGroups(fragments)
        : fragments.map(function (unit) { return { unit: unit, index: Number(unit.getAttribute("data-agent-native-motion-text-unit")) }; });
    }
    var groupCount = entries.reduce(function (count, entry) { return Math.max(count, entry.index + 1); }, 0);
    if ((groupCount - 1) * animation.staggerMs > 120000) throw new Error("Motion text stagger exceeds the 120000ms runtime limit.");
    targetGroup.animations.forEach(function (track) {
      entries.forEach(function (entry) {
        if (typeof entry.unit.animate !== "function") throw new Error("Motion text requires the Web Animations API.");
        var delayIndex = track.direction === "reverse" ? groupCount - 1 - entry.index : entry.index;
        var keyframes = track.keyframes.map(function (keyframe) {
          var frame = { offset: keyframe.t, easing: motionEaseForWebAnimations(keyframe.ease || "ease", entry.unit) };
          frame[track.property] = keyframe.value;
          return frame;
        });
        var delay = track.delayMs + delayIndex * track.staggerMs;
        var options = { duration: track.durationMs, delay: delay, fill: "both" };
        if (!previewBridge && playbackMode !== "once") {
          options.iterations = Infinity;
          if (playbackMode === "ping-pong") options.direction = "alternate";
        }
        var runningAnimation = entry.unit.animate(keyframes, options);
        if (previewBridge) {
          runningAnimation.pause();
          runningAnimation.currentTime = 0;
          previewAnimations.push({ animation: runningAnimation, delay: delay, duration: track.durationMs });
        }
      });
    });
  });
  if (previewBridge && typeof window.addEventListener === "function") {
    window.addEventListener("message", function (event) {
      if (event.source !== window.parent || !event.data || typeof event.data.type !== "string") return;
      if (event.data.type === "motion-preview") {
        var t = Number(event.data.t);
        var timelineDuration = Number(event.data.durationMs);
        if (!Number.isFinite(t) || !Number.isFinite(timelineDuration) || timelineDuration <= 0) return;
        var timelineTime = Math.max(0, Math.min(1, t)) * timelineDuration;
        previewAnimations.forEach(function (entry) {
          entry.animation.currentTime = Math.max(0, Math.min(entry.duration, timelineTime - entry.delay));
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
