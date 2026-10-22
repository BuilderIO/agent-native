import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "@agent-native/core/shared/motion-source-node-id";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parse, type ParserError } from "parse5";
import postcss from "postcss";

import {
  decodeMotionCssIdentifier,
  importAuthoredCssAnimations,
  mergeAuthoredCssMotionDocument,
  parseMotionAuthoredCssSimpleSelector,
  removeAuthoredCssSourceRanges,
  type MotionAuthoredCssSourceRange,
  type MotionAuthoredCssSimpleSelector,
  type MotionAuthoredCssTargetResolution,
} from "./motion-authored-css-import";
import {
  compileMotionCode,
  decodeMotionCodeMetadata,
  reconcileMotionCodeDocument,
  type MotionAudioClip,
  type MotionCodeDocument,
} from "./motion-code";
import type { MotionEasingVariable } from "./motion-easing";
import {
  applyMotionPathTrimSource,
  MotionPathTrimSourceError,
  restoreMotionPathTrimSource,
} from "./motion-path-trim-source";
import {
  decodeMotionTextDocument,
  injectMotionTextRuntime,
  MOTION_TEXT_RUNTIME_SOURCE,
  MOTION_TEXT_RUNTIME_ATTRIBUTE,
  MOTION_TEXT_SOURCE_ATTRIBUTE,
  MOTION_TEXT_SOURCE_VERSION,
  MOTION_TEXT_SOURCE_VERSION_PROVENANCE,
  readMotionTextDocument,
  removeMotionTextRuntime,
  type MotionTextDocument,
} from "./motion-text-code";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  parseMotionPlaybackMode,
  readTimelinePlaybackMode,
  type MotionPlaybackMode,
  type MotionTimeline,
} from "./motion-timeline";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const MANAGED_STYLE_ATTRIBUTE = "data-agent-native-motion";
const SAFE_NODE_ID = /^[A-Za-z0-9_-]{1,512}$/;
const MOTION_TEXT_V1_RUNTIME_SHA256 =
  "ba4c65a0893f8c551897d6ede05f9a2167d70832a7c8050b152859fb1828addb";

const FATAL_HTML_PARSE_ERRORS = new Set([
  "control-character-in-input-stream",
  "duplicate-attribute",
  "eof-before-tag-name",
  "eof-in-element-that-can-contain-only-text",
  "eof-in-script-html-comment-like-text",
  "eof-in-tag",
  "surrogate-in-input-stream",
  "unexpected-null-character",
]);

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  parentNode?: HtmlNode;
  childNodes?: HtmlNode[];
  content?: HtmlNode;
  insideTemplate?: boolean;
  sourceCodeLocation?: {
    startOffset?: number;
    endOffset?: number;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
  };
};

export type MotionHtmlSourceErrorCode =
  | "stale-source"
  | "stale-preview"
  | "malformed-source"
  | "ambiguous-managed-style"
  | "invalid-managed-style"
  | "unsupported-authored-motion"
  | "unresolved-stylesheet"
  | "invalid-motion-text"
  | "invalid-path-trim"
  | "unsupported-motion-document"
  | "invalid-motion-document"
  | "missing-node"
  | "ambiguous-node"
  | "unsupported-target";

export class MotionHtmlSourceError extends Error {
  constructor(
    readonly code: MotionHtmlSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MotionHtmlSourceError";
  }
}

/** The prepared source hash binds a write to the HTML preview that was edited. */
export interface MotionHtmlPreviewIdentitySnapshot {
  sourceHash: string;
}

export interface ApplyMotionHtmlSourceEditArgs {
  /** Current source read from the connected .html entry file. */
  currentSource: string;
  /** Exact source snapshot used when the Motion edit was prepared. */
  expectedSource: string;
  /** DOM identity snapshot from the preview of that exact source version. */
  preview: MotionHtmlPreviewIdentitySnapshot;
  /** Project-relative HTML path used to derive generated preview node IDs. */
  sourceFilePath?: string;
  timeline: MotionTimeline;
  textDocument?: MotionTextDocument | null;
  easingVariables?: readonly MotionEasingVariable[];
  audioClips?: readonly MotionAudioClip[];
}

export interface MotionHtmlSourceEdit {
  source: string;
  css: string;
  hash: string;
  targetNodeIds: string[];
}

export interface MotionHtmlPreviewSource {
  source: string;
  targetNodeIds: string[];
  sourceHash: string;
}

export interface MotionHtmlSourceRemoval {
  source: string;
  changed: boolean;
}

export type MotionHtmlSourceReadResult =
  | { status: "absent" }
  | {
      status: "valid";
      css: string;
      document: MotionCodeDocument | null;
      textDocument: MotionTextDocument | null;
      playbackMode: MotionPlaybackMode;
      targetNodeIds: string[];
    }
  | { status: "invalid"; error: MotionHtmlSourceError };

export type MotionHtmlSourceWriteCapability =
  | { status: "supported"; targetNodeIds: string[] }
  | {
      status: "unsupported";
      targetNodeIds: string[];
      code: MotionHtmlSourceErrorCode;
      reason: string;
    };

interface ParsedHtml {
  nodes: HtmlNode[];
}

function sourceError(code: MotionHtmlSourceErrorCode, message: string): never {
  throw new MotionHtmlSourceError(code, message);
}

function parseHtml(source: string): ParsedHtml {
  const parseErrors: ParserError[] = [];
  const document = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error),
  }) as unknown as HtmlNode;
  const fatalError = parseErrors.find((error) =>
    FATAL_HTML_PARSE_ERRORS.has(error.code),
  );
  if (fatalError) {
    sourceError(
      "malformed-source",
      `HTML source has a structural parse error (${fatalError.code}).`,
    );
  }

  const nodes: HtmlNode[] = [];
  const pending: Array<{
    node: HtmlNode;
    insideTemplate: boolean;
    parent?: HtmlNode;
  }> = [{ node: document, insideTemplate: false }];
  while (pending.length > 0) {
    const { node, insideTemplate, parent } = pending.pop()!;
    if (parent) node.parentNode = parent;
    node.insideTemplate = insideTemplate;
    nodes.push(node);
    pending.push(
      ...(node.childNodes ?? [])
        .reverse()
        .map((child) => ({ node: child, insideTemplate, parent: node })),
    );
    if (node.tagName === "template" && node.content) {
      pending.push({ node: node.content, insideTemplate: true, parent: node });
    }
  }
  return { nodes };
}

function attributes(
  node: HtmlNode,
  name: string,
): Array<{ name: string; value: string }> {
  return (node.attrs ?? []).filter((attribute) => attribute.name === name);
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textContent).join("");
}

function assertSourceRanges(
  source: string,
  node: HtmlNode,
): {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
} {
  const location = node.sourceCodeLocation;
  const start = location?.startOffset;
  const end = location?.endOffset;
  const contentStart = location?.startTag?.endOffset;
  const contentEnd = location?.endTag?.startOffset;
  if (
    start === undefined ||
    end === undefined ||
    contentStart === undefined ||
    contentEnd === undefined ||
    start < 0 ||
    contentStart < start ||
    contentEnd < contentStart ||
    end < contentEnd ||
    end > source.length
  ) {
    sourceError(
      "malformed-source",
      "A managed Motion style element has incomplete HTML source ranges.",
    );
  }
  return { start, end, contentStart, contentEnd };
}

function findManagedStyle(
  source: string,
  nodes: HtmlNode[],
): {
  node: HtmlNode;
  css: string;
  range: ReturnType<typeof assertSourceRanges>;
} | null {
  const marked = nodes.filter(
    (node) => attributes(node, MANAGED_STYLE_ATTRIBUTE).length > 0,
  );
  if (marked.some((node) => node.tagName !== "style")) {
    sourceError(
      "invalid-managed-style",
      `The ${MANAGED_STYLE_ATTRIBUTE} marker must be on a style element.`,
    );
  }
  if (marked.some((node) => node.insideTemplate)) {
    sourceError(
      "invalid-managed-style",
      "Managed Motion style elements cannot live inside an HTML template.",
    );
  }
  if (marked.length > 1) {
    sourceError(
      "ambiguous-managed-style",
      "HTML contains more than one managed Motion style element.",
    );
  }
  const node = marked[0];
  if (!node) return null;
  const range = assertSourceRanges(source, node);
  return { node, css: textContent(node), range };
}

function motionTextError(error: Error): MotionHtmlSourceError {
  return new MotionHtmlSourceError("invalid-motion-text", error.message);
}

function readMotionText(source: string): MotionTextDocument | null {
  const read = readMotionTextDocument(source);
  if (read.status === "invalid") throw motionTextError(read.error);
  return read.status === "valid" ? read.document : null;
}

function assertMotionTextOutsideTemplates(nodes: HtmlNode[]): void {
  if (
    nodes.some(
      (node) =>
        node.insideTemplate &&
        node.tagName === "script" &&
        (attributes(node, MOTION_TEXT_SOURCE_ATTRIBUTE).length > 0 ||
          attributes(node, MOTION_TEXT_RUNTIME_ATTRIBUTE).length > 0),
    )
  ) {
    sourceError(
      "invalid-motion-text",
      "Managed Motion Text scripts cannot live inside an HTML template.",
    );
  }
}

function targetsFromDocuments(
  document: MotionCodeDocument | null,
  textDocument: MotionTextDocument | null,
): string[] {
  return [
    ...new Set([
      ...(document?.tracks.map((track) => track.targetNodeId) ?? []),
      ...(document?.nativeStyles?.map((style) => style.targetNodeId) ?? []),
      ...(textDocument?.animations.map((animation) => animation.targetNodeId) ??
        []),
    ]),
  ];
}

function pathTrimTargetsFromDocument(
  document: MotionCodeDocument | null,
): string[] {
  if (!document) return [];
  return [
    ...new Set([
      ...document.tracks
        .filter((track) => track.property === "path-trim")
        .map((track) => track.targetNodeId),
      ...(document.nativeStyles ?? [])
        .filter((style) => style.enabled !== false && style.styleKey === "Path")
        .map((style) => style.targetNodeId),
    ]),
  ];
}

function pathTrimTargetsFromTimeline(timeline: MotionTimeline): string[] {
  return [
    ...new Set([
      ...timeline.tracks
        .filter((track) => track.property === "path-trim")
        .map((track) => track.targetNodeId),
      ...(timeline.nativeStyles ?? [])
        .filter((style) => style.enabled !== false && style.styleKey === "Path")
        .map((style) => style.targetNodeId),
    ]),
  ];
}

function applyPathTrimTargets(source: string, targetNodeIds: string[]): string {
  try {
    return applyMotionPathTrimSource(source, targetNodeIds, "html");
  } catch (error) {
    if (error instanceof MotionPathTrimSourceError) {
      sourceError("invalid-path-trim", error.message);
    }
    throw error;
  }
}

function restorePathTrimTargets(source: string): string {
  try {
    return restoreMotionPathTrimSource(source, "html");
  } catch (error) {
    if (error instanceof MotionPathTrimSourceError) {
      sourceError("invalid-path-trim", error.message);
    }
    throw error;
  }
}

function assertSafeTargetId(targetNodeId: string): void {
  if (!SAFE_NODE_ID.test(targetNodeId)) {
    sourceError(
      "unsupported-target",
      `Motion target ID "${targetNodeId}" is not a safe static HTML node ID.`,
    );
  }
}

function isRuntimeStyleMutationHandler(name: string, value = ""): boolean {
  const normalized = name.toLowerCase();
  return (
    ((normalized === "x-data" || normalized === "v-scope") &&
      !isStaticRuntimeScopeData(value)) ||
    normalized === "x-init" ||
    normalized.startsWith("x-init.") ||
    normalized === "x-effect" ||
    normalized.startsWith("x-effect.") ||
    normalized === "x-on" ||
    normalized.startsWith("x-on:") ||
    normalized === "v-on" ||
    normalized.startsWith("v-on:") ||
    normalized.startsWith("@")
  );
}

function hasPotentialRuntimeMutationHandler(
  attrs: readonly { name: string; value: string }[] | undefined,
): boolean {
  return (attrs ?? []).some(
    ({ name, value }) =>
      isRuntimeStyleMutationHandler(name, value) ||
      isNativeInlineEventHandler(name),
  );
}

function isRuntimeStyleMutationScope(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "x-data" || normalized === "v-scope";
}

function isStaticRuntimeScopeData(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized === "{}") return true;
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return false;

  const entries = splitStaticObjectProperties(normalized.slice(1, -1).trim());
  return (
    entries !== null &&
    entries.every((entry) => {
      const match =
        /^(?:[A-Za-z_$][\w$]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*(.+)$/s.exec(
          entry,
        );
      return match !== null && isStaticRuntimeScopeValue(match[1]!.trim());
    })
  );
}

function splitStaticObjectProperties(value: string): string[] | null {
  if (!value) return [];
  const properties: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ",") {
      properties.push(value.slice(start, index).trim());
      start = index + 1;
    } else if ("{}[]()".includes(character)) {
      return null;
    }
  }

  if (quote || escaped) return null;
  properties.push(value.slice(start).trim());
  return properties.every(Boolean) ? properties : null;
}

function isStaticRuntimeScopeValue(value: string): boolean {
  return /^(?:true|false|null|undefined|-?(?:\d+(?:\.\d*)?|\.\d+)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(
    value,
  );
}

function findRuntimeStyleMutationAttribute(target: HtmlNode):
  | {
      attribute: { name: string; value: string };
      location: "target" | "ancestor" | "runtime-scope";
    }
  | undefined {
  const ancestors = [target];
  let current = target.parentNode;
  let outermostScopeIndex = -1;
  while (current) {
    ancestors.push(current);
    if (current.attrs?.some(({ name }) => isRuntimeStyleMutationScope(name))) {
      outermostScopeIndex = ancestors.length - 1;
    }
    current = current.parentNode;
  }

  for (let index = 0; index < ancestors.length; index++) {
    const node = ancestors[index]!;
    const attribute = node.attrs?.find(({ name, value }) =>
      isRuntimeStyleMutationHandler(name, value),
    );
    if (attribute) {
      return {
        attribute,
        location: index === 0 ? "target" : "ancestor",
      };
    }
  }

  if (outermostScopeIndex >= 0) {
    const scope = ancestors[outermostScopeIndex]!;
    const attribute = findRuntimeStyleMutationInScope(scope);
    if (attribute) return { attribute, location: "runtime-scope" };
  }

  return undefined;
}

const EXECUTABLE_SCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

function isExecutableScript(node: HtmlNode): boolean {
  const type = attributes(node, "type")[0]?.value.trim().toLowerCase();
  if (!type || type === "module") return true;
  return EXECUTABLE_SCRIPT_TYPES.has(type.split(";", 1)[0]!.trim());
}

function isManagedMotionTextRuntime(source: string, node: HtmlNode): boolean {
  const marker = attributes(node, MOTION_TEXT_RUNTIME_ATTRIBUTE);
  if (
    marker.length !== 1 ||
    node.attrs?.length !== 1 ||
    !["v1", `v${MOTION_TEXT_SOURCE_VERSION}`].includes(marker[0]?.value ?? "")
  ) {
    return false;
  }

  const textRead = readMotionTextDocument(source);
  if (textRead.status !== "valid") return false;
  const sourceMarker = parseHtml(source)
    .nodes.filter((candidate) => candidate.tagName === "script")
    .flatMap((candidate) =>
      attributes(candidate, MOTION_TEXT_SOURCE_ATTRIBUTE),
    );
  if (sourceMarker.length !== 1) return false;
  const sourceVersion =
    textRead.document[MOTION_TEXT_SOURCE_VERSION_PROVENANCE] ??
    MOTION_TEXT_SOURCE_VERSION;
  const expectedMarker = `v${sourceVersion}`;
  if (
    marker[0]?.value !== expectedMarker ||
    sourceMarker[0]?.value !== expectedMarker
  ) {
    return false;
  }

  const runtime = extractManagedMotionTextRuntime(textContent(node).trim());
  if (
    !runtime ||
    !runtimeAnimationsMatch(runtime.payload, textRead.document, sourceVersion)
  ) {
    return false;
  }

  if (sourceVersion === 1) {
    return (
      bytesToHex(sha256(new TextEncoder().encode(runtime.template))) ===
      MOTION_TEXT_V1_RUNTIME_SHA256
    );
  }
  return runtime.template === MOTION_TEXT_RUNTIME_SOURCE;
}

interface ManagedMotionTextRuntimePayload {
  animations: unknown[];
  playbackMode: MotionPlaybackMode;
}

function extractManagedMotionTextRuntime(
  source: string,
): { template: string; payload: ManagedMotionTextRuntimePayload } | null {
  if (!source.endsWith(");")) return null;

  let markerIndex = source.lastIndexOf("})(", source.length - 3);
  while (markerIndex >= 0) {
    const payloadSource = source.slice(markerIndex + 3, -2);
    let payload: unknown;
    try {
      payload = JSON.parse(payloadSource);
    } catch {
      markerIndex = source.lastIndexOf("})(", markerIndex - 1);
      continue;
    }
    if (isManagedMotionTextRuntimePayload(payload)) {
      return {
        template: `${source.slice(0, markerIndex + 3)}__MOTION_TEXT_SOURCE__);`,
        payload: {
          animations: payload.animations,
          playbackMode: payload.playbackMode,
        },
      };
    }
    markerIndex = source.lastIndexOf("})(", markerIndex - 1);
  }
  return null;
}

function isManagedMotionTextRuntimePayload(
  value: unknown,
): value is ManagedMotionTextRuntimePayload {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { animations?: unknown }).animations) &&
    parseMotionPlaybackMode(
      (value as { playbackMode?: unknown }).playbackMode,
    ) !== null
  );
}

function runtimeAnimationsMatch(
  payload: ManagedMotionTextRuntimePayload,
  document: MotionTextDocument,
  sourceVersion: 1 | typeof MOTION_TEXT_SOURCE_VERSION,
): boolean {
  if (sourceVersion === MOTION_TEXT_SOURCE_VERSION) {
    return (
      JSON.stringify(payload.animations) === JSON.stringify(document.animations)
    );
  }

  const legacyAnimations = document.animations.map((animation) => ({
    targetNodeId: animation.targetNodeId,
    unit: animation.unit,
    direction: animation.direction,
    staggerMs: animation.staggerMs,
    delayMs: animation.delayMs,
    property: animation.property,
    durationMs: animation.durationMs,
    keyframes: animation.keyframes,
  }));
  return (
    JSON.stringify(payload.animations) === JSON.stringify(legacyAnimations)
  );
}

function assertExecutableScriptsSafe(
  source: string,
  nodes: readonly HtmlNode[],
  targetNodeIds: readonly string[],
  generatedIds: Map<number | undefined, string>,
): void {
  for (const node of nodes) {
    if (node.insideTemplate) continue;

    const targetMutatingHandler = node.attrs?.find(
      ({ name, value }) =>
        isEventHandlerAttribute(name) &&
        handlerMayMutateMotionTarget(
          value,
          node,
          nodes,
          targetNodeIds,
          generatedIds,
        ),
    );
    if (targetMutatingHandler) {
      sourceError(
        "unsupported-target",
        `HTML Motion targets cannot be synchronized safely while an inline ${targetMutatingHandler.name} handler may mutate a Motion target.`,
      );
    }

    if (node.tagName !== "script") continue;
    if (
      !isExecutableScript(node) &&
      !hasPotentialRuntimeMutationHandler(node.attrs)
    ) {
      continue;
    }
    if (
      !hasPotentialRuntimeMutationHandler(node.attrs) &&
      isManagedMotionTextRuntime(source, node)
    ) {
      continue;
    }
    sourceError(
      "unsupported-target",
      "HTML Motion targets cannot be synchronized safely while an executable script may change their class or style.",
    );
  }
}

function isRuntimeEventHandler(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "x-on" ||
    normalized.startsWith("x-on:") ||
    normalized === "v-on" ||
    normalized.startsWith("v-on:") ||
    normalized.startsWith("@")
  );
}

function isEventHandlerAttribute(name: string): boolean {
  return isRuntimeEventHandler(name) || isNativeInlineEventHandler(name);
}

function isNativeInlineEventHandler(name: string): boolean {
  return /^on[a-z]/i.test(name);
}

function handlerMayMutateMotionTarget(
  value: string,
  handlerNode: HtmlNode,
  nodes: readonly HtmlNode[],
  targetNodeIds: readonly string[],
  generatedIds: Map<number | undefined, string>,
): boolean {
  if (targetNodeIds.length > 0 && mayInjectRuntimeStylesheet(value)) {
    return true;
  }
  if (mayMutateThroughDomTraversal(value)) return true;

  const targetIds = new Set(targetNodeIds);
  const directTargetMutation =
    DIRECT_ELEMENT_MUTATION.test(value) || handlerTargetAliasMayMutate(value);
  if (
    directTargetMutation &&
    isMotionTargetNode(handlerNode, targetIds, generatedIds)
  ) {
    return true;
  }
  if (
    (DIRECT_EVENT_TARGET_MUTATION.test(value) ||
      eventTargetAliasMayMutate(value)) &&
    containsMotionTarget(handlerNode, nodes, targetIds, generatedIds)
  ) {
    return true;
  }
  if (
    handlerElementSelectorMayMutateMotionTarget(
      value,
      handlerNode,
      nodes,
      targetIds,
      generatedIds,
    )
  ) {
    return true;
  }
  return handlerSelectsAndMutatesMotionTarget(
    value,
    nodes,
    targetIds,
    generatedIds,
  );
}

function handlerElementSelectorMayMutateMotionTarget(
  value: string,
  handlerNode: HtmlNode,
  nodes: readonly HtmlNode[],
  targetIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  const selectorNames = String.raw`querySelector(?:All)?`;
  const scope = String.raw`(?:this|\$el|(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))`;
  const selectorCall = new RegExp(
    String.raw`\b${scope}\s*(?:\.\s*(${selectorNames})|\[\s*["'](${selectorNames})["']\s*\])\s*\(`,
    "gi",
  );
  const hasMutation =
    /(?:\.style(?:\s*(?:\.|\[)|\s*=)|\.classList\b|\.className\b|\.setAttribute\s*\(|\.removeAttribute\s*\(|\.animate\s*\(|\[\s*["'](?:style|classList|className|setAttribute|removeAttribute|animate)["']\s*\])/i.test(
      value,
    );
  if (!hasMutation) return false;

  const aliases = assignedAliases(
    value,
    /^(?:this|\$el|(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))/i,
  );
  const escapedAliases = [...aliases]
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (escapedAliases) {
    const aliasSelectorCall = new RegExp(
      String.raw`\b(?:${escapedAliases})\s*(?:\.\s*(${selectorNames})|\[\s*["'](${selectorNames})["']\s*\])\s*\(`,
      "gi",
    );
    if (aliasSelectorCall.test(value)) {
      return containsMotionTarget(handlerNode, nodes, targetIds, generatedIds);
    }
  }

  if (!selectorCall.test(value)) return false;
  return containsMotionTarget(handlerNode, nodes, targetIds, generatedIds);
}

const MUTATION_MEMBER_ACCESS = String.raw`(?:\?\.|\.)\s*(?:style\b|classList\b|className\b|setAttribute\s*\(|removeAttribute\s*\(|animate\s*\()|\[\s*["'](?:style|classList|className|setAttribute|removeAttribute|animate)["']\s*\]`;

const DIRECT_ELEMENT_MUTATION = new RegExp(
  String.raw`(?:\bthis\b|\b(?:event|e)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\])|\$el|\$event\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))\s*(?:${MUTATION_MEMBER_ACCESS})`,
  "i",
);

const DIRECT_EVENT_TARGET_MUTATION = new RegExp(
  String.raw`(?:\b(?:event|e|\$event)\s*(?:\.\s*target|\[\s*["']target["']\s*\]))\s*(?:${MUTATION_MEMBER_ACCESS})`,
  "i",
);

function mayInjectRuntimeStylesheet(value: string): boolean {
  if (
    /\b(?:adoptedStyleSheets|CSSStyleSheet|styleSheets|cssRules|insertRule|addRule|replaceSync)\b/i.test(
      value,
    )
  ) {
    return true;
  }

  const createElementCalls = /\bcreateElement(?:NS)?\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = createElementCalls.exec(value)) !== null) {
    const argument = match[1]?.trim() ?? "";
    const tag = /^(['"])([^'"]+)\1$/.exec(argument)?.[2]?.toLowerCase();
    if (!tag || tag === "style" || tag === "link") return true;
  }

  return /(?:innerHTML|insertAdjacentHTML)\s*(?:\+=|=|\()\s*[^;]*(?:<\s*style\b|<\s*link\b)/i.test(
    value,
  );
}

function mayMutateThroughDomTraversal(value: string): boolean {
  const traversesDom =
    /(?:\.\s*(?:parentElement|parentNode|children|childNodes|firstElementChild|lastElementChild|firstChild|lastChild|nextElementSibling|previousElementSibling|nextSibling|previousSibling|closest|matches)\b|\[\s*["'](?:parentElement|parentNode|children|childNodes|firstElementChild|lastElementChild|firstChild|lastChild|nextElementSibling|previousElementSibling|nextSibling|previousSibling|closest|matches)["']\s*\])/i.test(
      value,
    );
  const mutatesElement =
    /(?:\.\s*(?:style|classList|className)\b|\[\s*["'](?:style|classList|className)["']\s*\]|\.\s*(?:setAttribute|removeAttribute|animate)\s*\(|\[\s*["'](?:setAttribute|removeAttribute|animate)["']\s*\]\s*\()/i.test(
      value,
    );
  return traversesDom && mutatesElement;
}

function assignedAliases(
  source: string,
  initialExpression: RegExp,
): Set<string> {
  const aliases = new Set<string>();
  const assignments =
    /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([^;,\n]+)/g;
  let match: RegExpExecArray | null;
  let changed = true;
  while (changed) {
    changed = false;
    assignments.lastIndex = 0;
    while ((match = assignments.exec(source)) !== null) {
      const name = match[1]!;
      const expression = match[2]!.trim().replace(/^\(|\)$/g, "");
      const sourceAlias = /^([A-Za-z_$][\w$]*)\b/.exec(expression)?.[1];
      if (
        !aliases.has(name) &&
        (initialExpression.test(expression) ||
          (sourceAlias !== undefined && aliases.has(sourceAlias)))
      ) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

function identifierMutationSink(identifier: string): RegExp {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\s*(?:${MUTATION_MEMBER_ACCESS})`, "i");
}

function identifierMayFeedMutationSink(
  source: string,
  identifier: string,
): boolean {
  const aliases = identifierAliases(source, identifier);
  return aliases.some((alias) => {
    if (elementMutationSinkForIdentifier(alias).test(source)) return true;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `\\b${escaped}(?:\\s*(?:\\?\\.|\\.)\\s*[A-Za-z_$][\\w$]*|\\s*\\[\\s*["'][^"']+["']\\s*\\]){1,8}\\s*(?:${MUTATION_MEMBER_ACCESS})`,
      "i",
    ).test(source);
  });
}

function handlerTargetAliasMayMutate(value: string): boolean {
  const targetExpression =
    /^(?:this|\$el|(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))/i;
  const aliases = assignedAliases(value, targetExpression);
  return [...aliases].some((alias) =>
    identifierMutationSink(alias).test(value),
  );
}

function eventTargetAliasMayMutate(value: string): boolean {
  const targetExpression =
    /^(?:event|e|\$event)\s*(?:\.\s*target|\[\s*["']target["']\s*\])/i;
  const aliases = assignedAliases(value, targetExpression);
  return [...aliases].some((alias) =>
    identifierMutationSink(alias).test(value),
  );
}

function containsMotionTarget(
  node: HtmlNode,
  nodes: readonly HtmlNode[],
  targetNodeIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  return nodes.some((candidate) => {
    if (!isMotionTargetNode(candidate, targetNodeIds, generatedIds))
      return false;
    let current = candidate.parentNode;
    while (current) {
      if (current === node) return true;
      current = current.parentNode;
    }
    return false;
  });
}

function isMotionTargetNode(
  node: HtmlNode,
  targetNodeIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  const targetAttrs = attributes(node, NODE_ID_ATTRIBUTE);
  if (targetAttrs.some(({ value }) => targetNodeIds.has(value))) return true;
  const generatedId = generatedIds.get(
    node.sourceCodeLocation?.startTag?.startOffset,
  );
  return generatedId !== undefined && targetNodeIds.has(generatedId);
}

function handlerSelectsAndMutatesMotionTarget(
  value: string,
  nodes: readonly HtmlNode[],
  targetIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  const usesDocumentSelector =
    /\b(?:document|window|globalThis|self)\b/i.test(value) &&
    /\b(?:querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|Name|TagName))\b/i.test(
      value,
    );
  const mutatesElement =
    /(?:\.style(?:\s*(?:\.|\[)|\s*=)|\.classList\b|\.className\b|\.setAttribute\s*\(|\.removeAttribute\s*\(|\.animate\s*\(|\[\s*["'](?:style|classList|className|setAttribute|removeAttribute|animate)["']\s*\])/i.test(
      value,
    );
  if (!usesDocumentSelector || !mutatesElement) return false;

  const selectorCalls =
    /\b(?:document|window|globalThis|self)\s*(?:\.\s*document|\[\s*["']document["']\s*\])?\s*(?:\.\s*(querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|Name|TagName))|\[\s*["'](querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|Name|TagName))["']\s*\])\s*\(/gi;
  let foundSelectorCall = false;
  let match: RegExpExecArray | null;

  while ((match = selectorCalls.exec(value)) !== null) {
    foundSelectorCall = true;
    const openParenIndex = selectorCalls.lastIndex - 1;
    const method = match[1] ?? match[2]!;
    const callEndIndex = findSelectorCallEnd(value, openParenIndex);
    if (callEndIndex === null) return true;
    if (
      !selectorCallFeedsMutationSink(value, match.index, callEndIndex, method)
    ) {
      selectorCalls.lastIndex = callEndIndex;
      continue;
    }

    const selectorArgument = readStaticSelectorArgument(
      value.slice(openParenIndex + 1, callEndIndex - 1),
    );
    if (!selectorArgument) return true;

    const selector = selectorForDocumentCall(method, selectorArgument);
    if (!selector) return true;

    const traversal = selectorCallTraversal(
      value,
      match.index,
      callEndIndex,
      method,
    );
    if (
      selectorMayTargetMotionNode(
        selector,
        nodes,
        targetIds,
        generatedIds,
        traversal,
      )
    ) {
      return true;
    }
  }

  return !foundSelectorCall;
}

function findSelectorCallEnd(
  source: string,
  openParenIndex: number,
): number | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = openParenIndex; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth++;
    } else if (character === ")" && --depth === 0) {
      return index + 1;
    }
  }

  return null;
}

function readStaticSelectorArgument(source: string): string | null {
  const argument = source.trim();
  const quote = argument[0];
  if (
    (quote !== "'" && quote !== '"') ||
    argument[argument.length - 1] !== quote
  ) {
    return null;
  }
  const value = argument.slice(1, -1);
  return value.includes("\\") || value.includes(quote) ? null : value;
}

function selectorCallFeedsMutationSink(
  source: string,
  callStartIndex: number,
  callEndIndex: number,
  method: string,
): boolean {
  const afterCall = source.slice(callEndIndex);
  if (SELECTED_ELEMENT_MUTATION_SINK.test(afterCall)) return true;

  if (method.toLowerCase() === "queryselectorall") {
    const callback =
      /^\s*\.\s*(?:forEach|map|filter|some|every)\s*\(\s*(?:async\s+)?(?:\(\s*([\w$]+)\s*\)|([\w$]+))\s*=>/i.exec(
        afterCall,
      );
    const callbackParameter = callback?.[1] ?? callback?.[2];
    if (
      callbackParameter &&
      elementMutationSinkForIdentifier(callbackParameter).test(afterCall)
    ) {
      return true;
    }
  }

  const assignment =
    /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*$/.exec(
      source.slice(0, callStartIndex),
    );
  if (assignment) {
    return identifierMayFeedMutationSink(afterCall, assignment[1]!);
  }

  const remainingExpression = afterCall.trimStart();
  if (!remainingExpression || /^[;),&|?]/.test(remainingExpression))
    return false;
  return true;
}

const SELECTED_ELEMENT_MUTATION_SINK = new RegExp(
  `^\\s*(?:\\[\\s*\\d+\\s*\\]\\s*)?(?:${MUTATION_MEMBER_ACCESS})`,
  "i",
);

function elementMutationSinkForIdentifier(identifier: string): RegExp {
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b${escapedIdentifier}\\s*(?:${MUTATION_MEMBER_ACCESS})`,
    "i",
  );
}

function identifierAliases(source: string, initial: string): string[] {
  const aliases = new Set([initial]);
  const assignments =
    /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\b/g;
  let changed = true;
  while (changed) {
    changed = false;
    assignments.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = assignments.exec(source)) !== null) {
      if (!aliases.has(match[2]!) || aliases.has(match[1]!)) continue;
      aliases.add(match[1]!);
      changed = true;
    }
  }
  return [...aliases];
}

function selectorCallTraversal(
  source: string,
  callStartIndex: number,
  callEndIndex: number,
  method: string,
): { steps: string[]; unsupported: boolean } | null {
  if (method.toLowerCase() === "queryselectorall") return null;

  const afterCall = source.slice(callEndIndex);
  if (
    /(?:\.\s*(?:parentElement|parentNode|children|childNodes|firstElementChild|lastElementChild|firstChild|lastChild|closest|matches|querySelector(?:All)?)\b|\[\s*["'](?:parentElement|parentNode|children|childNodes|firstElementChild|lastElementChild|firstChild|lastChild|closest|matches|querySelector(?:All)?)["']\s*\])/i.test(
      afterCall,
    )
  ) {
    return { steps: [], unsupported: true };
  }
  const parseSteps = (suffix: string) => {
    const access =
      /\s*(?:\?\.|\.)\s*(nextElementSibling|previousElementSibling)\b|\s*\[\s*["'](nextElementSibling|previousElementSibling)["']\s*\]/iy;
    const steps: string[] = [];
    let offset = 0;
    while (true) {
      access.lastIndex = offset;
      const match = access.exec(suffix);
      if (!match) break;
      steps.push((match[1] ?? match[2]!).toLowerCase());
      offset = access.lastIndex;
    }
    if (steps.length > 0) {
      return SELECTED_ELEMENT_MUTATION_SINK.test(suffix.slice(offset))
        ? { steps, unsupported: false }
        : null;
    }
    return null;
  };

  const direct = parseSteps(afterCall);
  if (direct) return direct;

  const assignment =
    /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*$/.exec(
      source.slice(0, callStartIndex),
    );
  const receiver = assignment?.[1];
  if (!receiver) {
    return /^\s*(?:\?\.|\.)[A-Za-z_$]/.test(afterCall) &&
      !SELECTED_ELEMENT_MUTATION_SINK.test(afterCall)
      ? { steps: [], unsupported: true }
      : null;
  }
  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const traversal = new RegExp(
    `\\b${escaped}((?:(?:\\?\\.|\\.)\\s*(?:nextElementSibling|previousElementSibling)\\b|\\[\\s*["'](?:nextElementSibling|previousElementSibling)["']\\s*\\]))+`,
    "i",
  );
  const match = traversal.exec(afterCall);
  if (!match) {
    const intermediate = new RegExp(
      `\\b${escaped}(?:\\s*(?:\\?\\.|\\.)\\s*|\\s*\\[\\s*["'][^"']+["']\\s*\\])([A-Za-z_$][\\w$]*)[^;]*(?:${MUTATION_MEMBER_ACCESS})`,
      "i",
    ).exec(afterCall);
    return intermediate &&
      !/^(?:style|classList|className|setAttribute|removeAttribute|animate)$/i.test(
        intermediate[1]!,
      )
      ? { steps: [], unsupported: true }
      : null;
  }

  const steps: string[] = [];
  const access =
    /(?:\?\.|\.)\s*(nextElementSibling|previousElementSibling)\b|\[\s*["'](nextElementSibling|previousElementSibling)["']\s*\]/gi;
  let accessMatch: RegExpExecArray | null;
  while ((accessMatch = access.exec(match[1]!)) !== null) {
    steps.push((accessMatch[1] ?? accessMatch[2]!).toLowerCase());
  }
  const suffix = afterCall.slice(match.index + match[0].length);
  if (SELECTED_ELEMENT_MUTATION_SINK.test(suffix)) {
    return { steps, unsupported: false };
  }
  const assignedTraversal =
    /^\s*;?\s*(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=/.exec(suffix);
  if (
    assignedTraversal &&
    identifierMayFeedMutationSink(suffix, assignedTraversal[1]!)
  ) {
    return { steps, unsupported: false };
  }
  return { steps, unsupported: true };
}

function selectorForDocumentCall(
  method: string,
  argument: string,
): string | null {
  switch (method.toLowerCase()) {
    case "queryselector":
    case "queryselectorall":
      return argument;
    case "getelementbyid":
      return `#${argument}`;
    case "getelementsbyclassname":
      return `.${argument}`;
    case "getelementsbyname":
      return `[name="${argument}"]`;
    case "getelementsbytagname":
      return argument;
    default:
      return null;
  }
}

function selectorMayTargetMotionNode(
  selector: string,
  nodes: readonly HtmlNode[],
  targetNodeIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
  traversal: { steps: string[]; unsupported: boolean } | null = null,
): boolean {
  const parsed = parseMotionAuthoredCssSimpleSelector(selector);
  if (!parsed) return true;
  const selectorAttribute =
    parsed.kind === "id"
      ? "id"
      : parsed.kind === "class"
        ? "class"
        : parsed.kind === "attribute"
          ? parsed.name
          : null;

  const motionTargets = nodes.filter((node) =>
    isMotionTargetNode(node, targetNodeIds, generatedIds),
  );
  if (traversal?.unsupported) return motionTargets.length > 0;

  if (
    motionTargets.some((node) =>
      (node.attrs ?? []).some(({ name }) =>
        isDynamicHtmlAttribute(name, selectorAttribute),
      ),
    )
  ) {
    return true;
  }

  let candidates = nodes.filter(
    (node) => node.tagName && matchesHtmlSelector(node, parsed),
  );
  for (const step of traversal?.steps ?? []) {
    candidates = candidates.flatMap((node) => {
      const parent = node.parentNode;
      const siblings = (parent?.childNodes ?? []).filter(
        (sibling) => sibling.tagName !== undefined,
      );
      const index = siblings.indexOf(node);
      const nextIndex = index + (step === "nextelementsibling" ? 1 : -1);
      const sibling = siblings[nextIndex];
      return sibling ? [sibling] : [];
    });
  }

  return motionTargets.some((target) => candidates.includes(target));
}

function findRuntimeStyleMutationInScope(
  scope: HtmlNode,
): { name: string; value: string } | undefined {
  const pending = [...(scope.childNodes ?? [])];
  if (scope.content) pending.push(scope.content);

  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.insideTemplate || node.tagName === "template") continue;

    const attribute = node.attrs?.find(({ name, value }) =>
      isRuntimeStyleMutationHandler(name, value),
    );
    if (attribute) return attribute;

    pending.push(...(node.childNodes ?? []));
    if (node.content) pending.push(node.content);
  }

  return undefined;
}

function assertSafeSourceFilePath(sourceFilePath: string): string {
  const normalized = sourceFilePath.trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.includes("\\") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    /[\u0000-\u001f]/.test(normalized) ||
    !/\.html?$/i.test(normalized) ||
    normalized
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    sourceError(
      "unsupported-target",
      "Generated HTML Motion IDs require a safe project-relative .html/.htm source path.",
    );
  }
  return normalized;
}

interface GeneratedHtmlTarget {
  nodeId: string;
  node: HtmlNode;
}

function generatedHtmlTargets(
  source: string,
  sourceFilePath: string,
): GeneratedHtmlTarget[] {
  const modulePath = assertSafeSourceFilePath(sourceFilePath);
  const { nodes } = parseHtml(source);
  const hostNodes = nodes
    .filter(
      (node) =>
        !node.insideTemplate &&
        Boolean(node.tagName) &&
        isMotionSourceHostElementTag(node.tagName!) &&
        node.sourceCodeLocation?.startTag,
    )
    .sort(
      (left, right) =>
        left.sourceCodeLocation!.startTag!.startOffset -
        right.sourceCodeLocation!.startTag!.startOffset,
    );

  return hostNodes.flatMap((node, ordinal) => {
    const ids = attributes(node, NODE_ID_ATTRIBUTE);
    if (ids.length > 1) {
      sourceError(
        "ambiguous-node",
        `HTML source has duplicate ${NODE_ID_ATTRIBUTE} attributes.`,
      );
    }
    if (ids.length > 0) return [];
    return [{ nodeId: generatedMotionNodeId(modulePath, ordinal), node }];
  });
}

function nodeIdInsertionOffset(source: string, node: HtmlNode): number {
  const startTag = node.sourceCodeLocation?.startTag;
  if (!startTag || startTag.endOffset <= startTag.startOffset) {
    sourceError(
      "malformed-source",
      "A generated HTML Motion ID target has incomplete source ranges.",
    );
  }
  const tag = source.slice(startTag.startOffset, startTag.endOffset);
  const closeStart = startTag.endOffset - 1;
  const trailingSlash = /\/[\t\n\f\r ]*$/.exec(tag.slice(0, -1));
  return trailingSlash
    ? startTag.startOffset + trailingSlash.index
    : closeStart;
}

function addGeneratedHtmlNodeIds(
  source: string,
  sourceFilePath: string,
  targetNodeIds: readonly string[],
): string {
  const requested = new Set(targetNodeIds);
  if (requested.size === 0) return source;
  const generatedTargets = generatedHtmlTargets(source, sourceFilePath);
  const generatedById = new Map(
    generatedTargets.map((target) => [target.nodeId, target]),
  );
  const { nodes } = parseHtml(source);
  const existingCounts = new Map<string, number>();
  for (const node of nodes) {
    const ids = attributes(node, NODE_ID_ATTRIBUTE);
    if (ids.length > 1) {
      sourceError(
        "ambiguous-node",
        `HTML source has duplicate ${NODE_ID_ATTRIBUTE} attributes.`,
      );
    }
    const id = ids[0]?.value;
    if (id !== undefined) {
      existingCounts.set(id, (existingCounts.get(id) ?? 0) + 1);
    }
  }

  const edits: Array<{ offset: number; text: string }> = [];
  for (const targetNodeId of requested) {
    assertSafeTargetId(targetNodeId);
    const generated = generatedById.get(targetNodeId);
    if (!generated) continue;
    if ((existingCounts.get(targetNodeId) ?? 0) > 0) {
      sourceError(
        "ambiguous-node",
        `Generated HTML Motion ID "${targetNodeId}" conflicts with an authored node ID.`,
      );
    }
    edits.push({
      offset: nodeIdInsertionOffset(source, generated.node),
      text: ` ${NODE_ID_ATTRIBUTE}="${targetNodeId}"`,
    });
  }

  let result = source;
  for (const edit of edits.sort((left, right) => right.offset - left.offset)) {
    result = `${result.slice(0, edit.offset)}${edit.text}${result.slice(edit.offset)}`;
  }
  return result;
}

/** Adds the same deterministic identities used by source writeback to a preview copy. */
export function instrumentMotionHtmlPreviewSource(args: {
  source: string;
  sourceFilePath: string;
}): MotionHtmlPreviewSource {
  const targets = generatedHtmlTargets(args.source, args.sourceFilePath);
  const targetNodeIds = targets.map((target) => target.nodeId);
  return {
    source: addGeneratedHtmlNodeIds(
      args.source,
      args.sourceFilePath,
      targetNodeIds,
    ),
    targetNodeIds,
    sourceHash: bytesToHex(sha256(new TextEncoder().encode(args.source))),
  };
}

function assertTargetsExist(
  source: string,
  targetNodeIds: readonly string[],
  sourceFilePath?: string,
  checkExecutableScripts = true,
  checkEditSafety = true,
): void {
  if (targetNodeIds.length === 0) return;
  const { nodes } = parseHtml(source);
  const generatedTargets = sourceFilePath
    ? generatedHtmlTargets(source, sourceFilePath)
    : [];
  const generatedIds = new Map(
    generatedTargets.map((target) => [
      target.node.sourceCodeLocation?.startTag?.startOffset,
      target.nodeId,
    ]),
  );
  if (checkExecutableScripts) {
    assertExecutableScriptsSafe(source, nodes, targetNodeIds, generatedIds);
  }
  const targets = new Map<string, HtmlNode[]>();
  for (const node of nodes) {
    if (!node.tagName) continue;
    const ids = attributes(node, NODE_ID_ATTRIBUTE);
    if (ids.length > 1) {
      sourceError(
        "ambiguous-node",
        `HTML source has duplicate ${NODE_ID_ATTRIBUTE} attributes.`,
      );
    }
    const nodeId = ids[0]?.value;
    if (nodeId === undefined) continue;
    const matches = targets.get(nodeId) ?? [];
    matches.push(node);
    targets.set(nodeId, matches);
  }
  const generatedById = new Map(
    generatedTargets.map((target) => [target.nodeId, target.node]),
  );

  for (const nodeId of targetNodeIds) {
    assertSafeTargetId(nodeId);
    const matches = targets.get(nodeId) ?? [];
    const generated = generatedById.get(nodeId);
    if (matches.length > 1) {
      sourceError(
        "ambiguous-node",
        `HTML source contains ${matches.length} elements with ${NODE_ID_ATTRIBUTE}="${nodeId}".`,
      );
    }
    if (matches.length === 1 && generated && generated !== matches[0]) {
      sourceError(
        "ambiguous-node",
        `HTML source contains multiple elements represented by Motion target "${nodeId}".`,
      );
    }
    const target = matches[0] ?? generated;
    if (!target) {
      sourceError(
        "missing-node",
        `HTML source does not contain a static ${NODE_ID_ATTRIBUTE}="${nodeId}" target.`,
      );
    }
    const tagName = target.tagName;
    if (target.insideTemplate) {
      sourceError(
        "unsupported-target",
        `Motion target "${nodeId}" is inside an inert HTML template.`,
      );
    }
    if (
      ["base", "head", "link", "meta", "script", "style", "title"].includes(
        tagName ?? "",
      )
    ) {
      sourceError(
        "unsupported-target",
        `Motion target "${nodeId}" is on a non-rendered ${tagName} element.`,
      );
    }
    if (checkEditSafety) {
      const conflictingMotionBinding = target.attrs?.find(
        ({ name }) =>
          name.startsWith("x-transition") ||
          [":style", "x-bind", "x-bind:style", "v-bind:style"].includes(name),
      );
      if (conflictingMotionBinding) {
        sourceError(
          "unsupported-target",
          `Motion target "${nodeId}" uses ${conflictingMotionBinding.name}, which cannot be synchronized with CSS Motion yet.`,
        );
      }
      const runtimeStyleMutation = findRuntimeStyleMutationAttribute(target);
      if (runtimeStyleMutation) {
        const { attribute, location } = runtimeStyleMutation;
        const runtimeScope =
          location === "target"
            ? `uses ${attribute.name}`
            : location === "ancestor"
              ? `has an ancestor using ${attribute.name}`
              : `is in a runtime scope using ${attribute.name}`;
        sourceError(
          "unsupported-target",
          `Motion target "${nodeId}" ${runtimeScope}, whose runtime expression cannot be proven free of style mutations.`,
        );
      }
      const inlineStyle = target.attrs?.find(({ name }) => name === "style");
      if (inlineStyle && hasInlineMotionDeclarations(inlineStyle.value)) {
        sourceError(
          "unsupported-target",
          `Motion target "${nodeId}" uses style, which cannot be synchronized with CSS Motion yet.`,
        );
      }
    }
  }
}

function hasInlineMotionDeclarations(value: string): boolean {
  const motionProperty =
    /^(?:-(?:webkit|moz|ms|o)-)?(?:animation|transition)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/i;
  try {
    const declarations = postcss.parse(`.motion-target {\n${value}\n}`);
    let found = false;
    declarations.walkDecls((declaration) => {
      if (
        motionProperty.test(
          decodeMotionCssIdentifier(declaration.prop).toLowerCase(),
        )
      ) {
        found = true;
      }
    });
    return found;
  } catch {
    const withoutComments = value.replace(/\/\*[\s\S]*?\*\//g, "");
    return /(?:^|;)\s*(?:-(?:webkit|moz|ms|o)-)?(?:animation|transition)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?\s*:/i.test(
      decodeMotionCssIdentifier(withoutComments),
    );
  }
}

export function assertMotionHtmlSourceTargets(args: {
  source: string;
  targetNodeIds: readonly string[];
  sourceFilePath?: string;
}): void {
  assertTargetsExist(args.source, args.targetNodeIds, args.sourceFilePath);
}

/** Removes only an unversioned managed block so the HTML adapter can migrate it. */
export function removeUnversionedManagedMotionStyle(source: string): string {
  const { nodes } = parseHtml(source);
  const managedStyle = findManagedStyle(source, nodes);
  if (!managedStyle) return source;
  const metadata = decodeMotionCodeMetadata(managedStyle.css);
  if (metadata.status === "valid") return source;
  if (metadata.status === "invalid") {
    sourceError("invalid-managed-style", metadata.error.message);
  }
  return `${source.slice(0, managedStyle.range.start)}${source.slice(managedStyle.range.end)}`;
}

interface AuthoredHtmlStyleImport {
  node: HtmlNode;
  contentStart: number;
  contentEnd: number;
  css: string;
  ranges: MotionAuthoredCssSourceRange[];
}

interface AuthoredHtmlMotion {
  document: MotionCodeDocument | null;
  rangesToRemove: MotionAuthoredCssSourceRange[];
}

function staticAuthoredHtmlStyleContents(
  source: string,
  nodes: readonly HtmlNode[],
): string[] {
  return nodes.flatMap((node) => {
    if (
      node.tagName !== "style" ||
      node.insideTemplate ||
      !isPotentialCssStyle(node) ||
      attributes(node, MANAGED_STYLE_ATTRIBUTE).length > 0
    ) {
      return [];
    }

    const location = node.sourceCodeLocation;
    const contentStart = location?.startTag?.endOffset;
    const contentEnd = location?.endTag?.startOffset;
    if (
      contentStart === undefined ||
      contentEnd === undefined ||
      contentStart < 0 ||
      contentEnd < contentStart ||
      contentEnd > source.length
    ) {
      return [];
    }

    const css = source.slice(contentStart, contentEnd);
    if (textContent(node) !== css || hasCssTemplateInterpolation(css)) {
      return [];
    }
    return [css];
  });
}

function readAuthoredHtmlMotion(
  source: string,
  nodes: HtmlNode[],
  sourceFilePath?: string,
  skipUnresolvedStylesheetCheck = false,
): AuthoredHtmlMotion {
  const generatedIds = sourceFilePath
    ? new Map(
        generatedHtmlTargets(source, sourceFilePath).map((target) => [
          target.node.sourceCodeLocation?.startTag?.startOffset,
          target.nodeId,
        ]),
      )
    : new Map<number | undefined, string>();
  const importedStyles: AuthoredHtmlStyleImport[] = [];
  const tracks: NonNullable<MotionCodeDocument["tracks"]> = [];
  const importedTargetNodeIds = new Set<string>();
  const usedKeyframeNames = new Set<string>();
  const keyframeNameCounts = new Map<string, number>();
  const transitionCssBlocks = staticAuthoredHtmlStyleContents(source, nodes);
  let durationMs = 1;

  for (const node of nodes) {
    if (
      node.tagName !== "style" ||
      node.insideTemplate ||
      !isPotentialCssStyle(node) ||
      attributes(node, MANAGED_STYLE_ATTRIBUTE).length > 0
    ) {
      continue;
    }
    const location = node.sourceCodeLocation;
    const contentStart = location?.startTag?.endOffset;
    const contentEnd = location?.endTag?.startOffset;
    if (
      contentStart === undefined ||
      contentEnd === undefined ||
      contentStart < 0 ||
      contentEnd < contentStart ||
      contentEnd > source.length
    ) {
      continue;
    }
    const css = source.slice(contentStart, contentEnd);
    if (textContent(node) !== css) {
      if (/(?:^|[;{\s])(?:-?[a-z]+-)?animation(?:-[a-z-]+)?\s*:/i.test(css)) {
        sourceError(
          "unsupported-authored-motion",
          "An inline style animation cannot be imported because its source text is not lossless.",
        );
      }
      continue;
    }
    const result = importAuthoredCssAnimations(
      css,
      (selector) =>
        resolveAuthoredHtmlTarget(source, nodes, selector, generatedIds),
      { transitionCssBlocks },
    );
    if (result.status === "absent") {
      for (const name of result.definedKeyframeNames) {
        keyframeNameCounts.set(name, (keyframeNameCounts.get(name) ?? 0) + 1);
      }
      continue;
    }
    if (result.status === "unsupported") {
      sourceError("unsupported-authored-motion", result.reason);
    }
    if (!skipUnresolvedStylesheetCheck && hasUnresolvedStylesheet(nodes)) {
      sourceError(
        "unresolved-stylesheet",
        "Resolve external or runtime-generated styles before editing or adding Motion.",
      );
    }
    for (const name of result.definedKeyframeNames) {
      keyframeNameCounts.set(name, (keyframeNameCounts.get(name) ?? 0) + 1);
    }
    for (const name of result.keyframeNames) usedKeyframeNames.add(name);
    for (const targetNodeId of new Set(
      result.tracks.map((track) => track.targetNodeId),
    )) {
      if (importedTargetNodeIds.has(targetNodeId)) {
        sourceError(
          "unsupported-authored-motion",
          `Motion target "${targetNodeId}" has animation rules in multiple inline style blocks, so CSS cascade order cannot be preserved.`,
        );
      }
      importedTargetNodeIds.add(targetNodeId);
    }
    if (!isSupportedAuthoredHtmlStyle(node)) {
      sourceError(
        "unsupported-authored-motion",
        "Inline style animations with conditional or alternate stylesheet attributes are unsupported.",
      );
    }
    const ranges = result.rangesToRemove.map((range) => ({
      ...range,
      start: range.start + contentStart,
      end: range.end + contentStart,
    }));
    importedStyles.push({ node, contentStart, contentEnd, css, ranges });
    tracks.push(...result.tracks);
    durationMs = Math.max(durationMs, result.durationMs);
  }

  if (tracks.length === 0) {
    return { document: null, rangesToRemove: [] };
  }
  for (const name of usedKeyframeNames) {
    if ((keyframeNameCounts.get(name) ?? 0) > 1) {
      sourceError(
        "unsupported-authored-motion",
        `Animation "${name}" has duplicate @keyframes definitions across inline style blocks.`,
      );
    }
  }
  try {
    const document = mergeAuthoredCssMotionDocument(null, {
      tracks,
      durationMs,
      defaultEase: "ease",
    });
    return {
      document,
      rangesToRemove: importedStyles.flatMap((style) => style.ranges),
    };
  } catch (error) {
    sourceError(
      "unsupported-authored-motion",
      error instanceof Error
        ? error.message
        : "Inline CSS animations cannot be represented by one Motion timeline.",
    );
  }
}

function hasUnresolvedStylesheet(nodes: readonly HtmlNode[]): boolean {
  return (
    hasLinkedStylesheet(nodes) ||
    hasImportedStylesheet(nodes) ||
    hasDynamicStyleContent(nodes)
  );
}

function dynamicBoundAttributeName(attributeName: string): string | null {
  const normalized = attributeName.toLowerCase();
  if (normalized.startsWith(":")) return normalized.slice(1);
  for (const prefix of ["x-bind:", "v-bind:", "ng-attr-"]) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  }
  return normalized === "ng-href" ? "href" : null;
}

function hasLinkedStylesheet(nodes: readonly HtmlNode[]): boolean {
  return nodes.some((node) => {
    if (node.tagName !== "link" || node.insideTemplate) return false;
    const relAttributes = attributes(node, "rel");
    const hrefAttributes = attributes(node, "href");
    const relTokens = relAttributes.flatMap((attribute) =>
      attribute.value.split(/[\t\n\f\r ]+/).map((value) => value.toLowerCase()),
    );
    const objectBinding = (node.attrs ?? []).some((attribute) =>
      ["x-bind", "v-bind"].includes(attribute.name.toLowerCase()),
    );
    const hasBoundAttribute = (name: string) =>
      (node.attrs ?? []).some((attribute) => {
        const attributeName = attribute.name.toLowerCase();
        return (
          dynamicBoundAttributeName(attributeName) === name ||
          (attributeName === name && /\{\{|\$\{|<%/u.test(attribute.value))
        );
      });
    const hasHref =
      hrefAttributes.some((attribute) => attribute.value.trim()) ||
      hasBoundAttribute("href") ||
      objectBinding;
    const stylesheetRel = relTokens.includes("stylesheet");
    const stylePreload =
      relTokens.includes("preload") &&
      (attributes(node, "as").some(
        (attribute) => attribute.value.toLowerCase() === "style",
      ) ||
        hasBoundAttribute("as") ||
        objectBinding) &&
      (attributes(node, "onload").length > 0 ||
        hasBoundAttribute("onload") ||
        objectBinding);
    return (
      hasHref &&
      (stylesheetRel ||
        hasBoundAttribute("rel") ||
        stylePreload ||
        objectBinding)
    );
  });
}

function hasDynamicStyleContent(nodes: readonly HtmlNode[]): boolean {
  return nodes.some((node) => {
    if (node.tagName !== "style" || node.insideTemplate) return false;
    if (
      hasPotentialRuntimeMutationHandler(node.attrs) ||
      (node.attrs ?? []).some(({ name }) => {
        const normalized = name.toLowerCase();
        return (
          (normalized.startsWith("x-") && normalized !== "x-cloak") ||
          (normalized.startsWith("v-") && normalized !== "v-cloak") ||
          (normalized.startsWith("ng-") && normalized !== "ng-cloak") ||
          normalized.startsWith(":")
        );
      })
    ) {
      return true;
    }
    if (!isPotentialCssStyle(node)) return false;
    if (hasCssTemplateInterpolation(textContent(node))) {
      return true;
    }
    return (node.attrs ?? []).some((attribute) => {
      const name = attribute.name.toLowerCase();
      return (
        [
          "x-text",
          "x-html",
          "v-text",
          "v-html",
          "ng-bind",
          "ng-bind-html",
        ].includes(name) ||
        ["innerhtml", "textcontent"].includes(
          dynamicBoundAttributeName(name) ?? "",
        )
      );
    });
  });
}

function hasCssTemplateInterpolation(css: string): boolean {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < css.length; index++) {
    const character = css[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (
      css.startsWith("{{", index) ||
      css.startsWith("${", index) ||
      css.startsWith("<%", index)
    ) {
      return true;
    }
  }

  return false;
}

function hasImportedStylesheet(nodes: readonly HtmlNode[]): boolean {
  for (const node of nodes) {
    if (
      node.tagName !== "style" ||
      node.insideTemplate ||
      !isPotentialCssStyle(node)
    ) {
      continue;
    }
    try {
      let imported = false;
      postcss.parse(textContent(node)).walkAtRules((atRule) => {
        if (decodeMotionCssIdentifier(atRule.name).toLowerCase() === "import") {
          imported = true;
        }
      });
      if (imported) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function isPotentialCssStyle(node: HtmlNode): boolean {
  const attributes = node.attrs ?? [];
  const hasObjectBinding = attributes.some((attribute) =>
    ["x-bind", "v-bind"].includes(attribute.name.toLowerCase()),
  );
  const hasDynamicType = attributes.some((attribute) => {
    const name = attribute.name.toLowerCase();
    return (
      dynamicBoundAttributeName(name) === "type" ||
      (name === "type" && /\{\{|\$\{|<%/u.test(attribute.value))
    );
  });
  if (hasObjectBinding || hasDynamicType) return true;

  const type = attributes.find(
    (attribute) => attribute.name.toLowerCase() === "type",
  )?.value;
  return type === undefined || /^\s*text\/css(?:\s*;|\s*$)/i.test(type);
}

function isSupportedAuthoredHtmlStyle(node: HtmlNode): boolean {
  for (const attribute of node.attrs ?? []) {
    const name = attribute.name.toLowerCase();
    if (
      [
        "x-text",
        "x-html",
        "v-text",
        "v-html",
        "ng-bind",
        "ng-bind-html",
      ].includes(name) ||
      ["innerhtml", "textcontent"].includes(
        dynamicBoundAttributeName(name) ?? "",
      )
    ) {
      return false;
    }
    if (
      /^(?::|x-bind:|v-bind:)(?:media|disabled|title|scoped|type)$/.test(name)
    ) {
      return false;
    }
    if (["media", "disabled", "title", "scoped"].includes(name)) {
      return false;
    }
    if (name === "type" && !/^\s*(?:text\/css)?\s*$/i.test(attribute.value)) {
      return false;
    }
  }
  return true;
}

function resolveAuthoredHtmlTarget(
  _source: string,
  nodes: HtmlNode[],
  selector: string,
  generatedIds: Map<number | undefined, string>,
): MotionAuthoredCssTargetResolution {
  const parsed = parseMotionAuthoredCssSimpleSelector(selector);
  if (!parsed) return { status: "unresolved" };
  const attributeName =
    parsed.kind === "id"
      ? "id"
      : parsed.kind === "class"
        ? "class"
        : parsed.kind === "attribute"
          ? parsed.name
          : null;
  const matches: Array<{ node: HtmlNode; targetNodeId: string }> = [];
  let hasDynamicMatch = false;

  for (const node of nodes) {
    if (!node.tagName || !isMotionSourceHostElementTag(node.tagName)) {
      continue;
    }
    const attrs = node.attrs ?? [];
    const targetAttrs = attributes(node, NODE_ID_ATTRIBUTE);
    if (targetAttrs.length > 1) return { status: "ambiguous" };
    if (
      attrs.some((attribute) =>
        isDynamicHtmlAttribute(attribute.name, attributeName),
      )
    ) {
      hasDynamicMatch = true;
    }
    const attributeMatch = matchesHtmlSelector(node, parsed);
    if (!attributeMatch) continue;
    if (node.insideTemplate) return { status: "ambiguous" };
    const targetNodeId =
      targetAttrs[0]?.value ??
      generatedIds.get(node.sourceCodeLocation?.startTag?.startOffset);
    if (!targetNodeId || !SAFE_NODE_ID.test(targetNodeId)) {
      hasDynamicMatch = true;
      continue;
    }
    matches.push({ node, targetNodeId });
  }

  if (hasDynamicMatch) return { status: "ambiguous" };
  if (matches.length === 0) return { status: "unresolved" };
  if (matches.length !== 1) return { status: "ambiguous" };
  return { status: "resolved", targetNodeId: matches[0]!.targetNodeId };
}

function isDynamicHtmlAttribute(
  name: string,
  selectorAttribute: string | null,
): boolean {
  if (!selectorAttribute) return false;
  const normalized = name.toLowerCase();
  return (
    normalized === "x-bind" ||
    normalized === "v-bind" ||
    [
      `:${selectorAttribute}`,
      `x-bind:${selectorAttribute}`,
      `v-bind:${selectorAttribute}`,
    ].includes(normalized)
  );
}

function matchesHtmlSelector(
  node: HtmlNode,
  selector: MotionAuthoredCssSimpleSelector,
): boolean {
  if (selector.kind === "type")
    return node.tagName?.toLowerCase() === selector.name;
  const name =
    selector.kind === "id"
      ? "id"
      : selector.kind === "class"
        ? "class"
        : selector.name;
  const values = attributes(node, name);
  if (selector.kind === "id") {
    return values.some((attribute) => attribute.value === selector.value);
  }
  if (selector.kind === "class") {
    return values.some((attribute) =>
      attribute.value.split(/[\t\n\f\r ]+/).includes(selector.value),
    );
  }
  if (selector.value === undefined) return values.length > 0;
  return values.some((attribute) => attribute.value === selector.value);
}

function removeAuthoredHtmlMotion(
  source: string,
  sourceFilePath?: string,
): string {
  const { nodes } = parseHtml(source);
  const authored = readAuthoredHtmlMotion(source, nodes, sourceFilePath);
  return authored.rangesToRemove.length > 0
    ? removeAuthoredCssSourceRanges(source, authored.rangesToRemove)
    : source;
}

function readSource(
  source: string,
  sourceFilePath?: string,
  options: {
    allowUnmanagedExecutableScripts?: boolean;
    cleanupOnly?: boolean;
  } = {},
): Exclude<MotionHtmlSourceReadResult, { status: "invalid" }> {
  const { nodes } = parseHtml(source);
  assertMotionTextOutsideTemplates(nodes);
  const managedStyle = findManagedStyle(source, nodes);
  const metadata = managedStyle
    ? decodeMotionCodeMetadata(managedStyle.css)
    : { status: "absent" as const };
  if (managedStyle && metadata.status === "absent") {
    sourceError(
      "invalid-managed-style",
      "Managed HTML Motion CSS is missing its versioned source document.",
    );
  }
  if (metadata.status === "invalid") {
    sourceError("invalid-managed-style", metadata.error.message);
  }

  let document: MotionCodeDocument | null = null;
  if (metadata.status === "valid") {
    try {
      document = reconcileMotionCodeDocument(
        managedStyle?.css ?? "",
        metadata.document,
      );
    } catch (error) {
      sourceError(
        "invalid-managed-style",
        error instanceof Error
          ? error.message
          : "Managed HTML Motion CSS could not be read safely.",
      );
    }
  }
  const authoredMotion = readAuthoredHtmlMotion(
    source,
    nodes,
    sourceFilePath,
    options.cleanupOnly,
  );
  if (authoredMotion.document) {
    try {
      document = mergeAuthoredCssMotionDocument(
        document,
        authoredMotion.document,
      );
    } catch (error) {
      sourceError(
        "unsupported-authored-motion",
        error instanceof Error
          ? error.message
          : "Inline CSS animations cannot share one Motion timeline.",
      );
    }
  }
  const textDocument = readMotionText(source);
  if (
    !options.cleanupOnly &&
    (document || textDocument) &&
    hasUnresolvedStylesheet(nodes)
  ) {
    sourceError(
      "unresolved-stylesheet",
      "Resolve external or runtime-generated styles before editing or adding Motion.",
    );
  }
  const targetNodeIds = targetsFromDocuments(document, textDocument);
  assertTargetsExist(
    source,
    targetNodeIds,
    sourceFilePath,
    !options.allowUnmanagedExecutableScripts,
    !options.cleanupOnly,
  );
  const pathTrimmedSource = applyPathTrimTargets(
    source,
    pathTrimTargetsFromDocument(document),
  );
  if (pathTrimmedSource !== source) {
    sourceError(
      "invalid-path-trim",
      "HTML Motion Path trim markers do not match the active Motion timeline.",
    );
  }
  if (!document && !textDocument) {
    if (!options.cleanupOnly && hasUnresolvedStylesheet(nodes)) {
      sourceError(
        "unresolved-stylesheet",
        "Resolve external or runtime-generated styles before editing or adding Motion.",
      );
    }
    return { status: "absent" };
  }

  return {
    status: "valid",
    css: managedStyle?.css ?? "",
    document,
    textDocument,
    playbackMode: document
      ? (document.playbackMode ??
        readTimelinePlaybackMode(document.tracks) ??
        MOTION_DEFAULT_PLAYBACK_MODE)
      : MOTION_DEFAULT_PLAYBACK_MODE,
    targetNodeIds,
  };
}

/** Reads managed HTML Motion CSS and Text source without treating malformed data as absent. */
export function readMotionHtmlSource(
  source: string,
  sourceFilePath?: string,
): MotionHtmlSourceReadResult {
  try {
    return readSource(source, sourceFilePath);
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionHtmlSourceError
          ? error
          : new MotionHtmlSourceError(
              "malformed-source",
              error instanceof Error
                ? error.message
                : "HTML Motion source could not be read.",
            ),
    };
  }
}

function normalizeTextDocument(
  value: MotionTextDocument | null,
): MotionTextDocument | null {
  if (value === null) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    sourceError(
      "invalid-motion-text",
      "HTML Motion Text source must be serializable as static JSON.",
    );
  }
  if (typeof serialized !== "string") {
    sourceError(
      "invalid-motion-text",
      "HTML Motion Text source must be serializable as static JSON.",
    );
  }
  const decoded = decodeMotionTextDocument(serialized);
  if (decoded.status !== "valid") {
    sourceError(
      "invalid-motion-text",
      decoded.status === "invalid"
        ? decoded.error.message
        : `HTML Motion Text source must contain version ${MOTION_TEXT_SOURCE_VERSION}.`,
    );
  }
  return decoded.document;
}

function timelineTargets(
  timeline: MotionTimeline,
  textDocument: MotionTextDocument | null,
): string[] {
  return [
    ...new Set([
      ...timeline.tracks.map((track) => track.targetNodeId),
      ...(timeline.nativeStyles ?? []).map((style) => style.targetNodeId),
      ...(textDocument?.animations.map((animation) => animation.targetNodeId) ??
        []),
    ]),
  ];
}

function isMetadataOnlyWrite(
  targetNodeIds: readonly string[],
  timeline: MotionTimeline,
  args: ApplyMotionHtmlSourceEditArgs,
): boolean {
  return (
    targetNodeIds.length === 0 &&
    ((timeline.animationStyles?.length ?? 0) > 0 ||
      args.easingVariables !== undefined ||
      args.audioClips !== undefined)
  );
}

function updateManagedStyle(source: string, css: string): string {
  if (/<\/style\b/i.test(css)) {
    sourceError(
      "invalid-motion-document",
      "Compiled Motion CSS cannot safely be embedded in an HTML style element.",
    );
  }
  const { nodes } = parseHtml(source);
  const existing = findManagedStyle(source, nodes);
  if (existing) {
    return `${source.slice(0, existing.range.contentStart)}${css}${source.slice(existing.range.contentEnd)}`;
  }

  const head = nodes.find(
    (node) => node.tagName === "head" && node.sourceCodeLocation?.startTag,
  );
  const body = nodes.find(
    (node) => node.tagName === "body" && node.sourceCodeLocation?.startTag,
  );
  const offset =
    head?.sourceCodeLocation?.endTag?.startOffset ??
    body?.sourceCodeLocation?.startTag?.startOffset ??
    source.length;
  if (offset < 0 || offset > source.length) {
    sourceError(
      "malformed-source",
      "HTML source has an invalid Motion style insertion point.",
    );
  }
  const markup = `<style ${MANAGED_STYLE_ATTRIBUTE}>${css}</style>`;
  return `${source.slice(0, offset)}${markup}${source.slice(offset)}`;
}

function normalizeTimelineError(error: unknown): MotionHtmlSourceError {
  return new MotionHtmlSourceError(
    "invalid-motion-document",
    error instanceof Error
      ? error.message
      : "Motion source could not be compiled.",
  );
}

/** Writes managed Motion CSS and Text source while leaving unrelated HTML byte-for-byte intact. */
export function applyMotionHtmlSourceEdit(
  args: ApplyMotionHtmlSourceEditArgs,
): MotionHtmlSourceEdit {
  const { currentSource, expectedSource, preview, timeline } = args;
  if (currentSource !== expectedSource) {
    sourceError(
      "stale-source",
      "HTML source changed since the Motion edit was prepared. Re-read the file and retry.",
    );
  }
  if (
    preview.sourceHash !==
    bytesToHex(sha256(new TextEncoder().encode(currentSource)))
  ) {
    sourceError(
      "stale-preview",
      "The HTML preview identity snapshot does not match the current source. Refresh the preview and retry.",
    );
  }

  const currentRead = readSource(currentSource, args.sourceFilePath);
  const textDocument = normalizeTextDocument(args.textDocument ?? null);
  const targetNodeIds = timelineTargets(timeline, textDocument);
  const metadataOnlyWrite = isMetadataOnlyWrite(targetNodeIds, timeline, args);
  if (targetNodeIds.length === 0 && !metadataOnlyWrite) {
    sourceError(
      "unsupported-motion-document",
      "HTML Motion source writes require a CSS track, Text animation, or saved animation style library.",
    );
  }
  let source = removeAuthoredHtmlMotion(currentSource, args.sourceFilePath);
  source = args.sourceFilePath
    ? addGeneratedHtmlNodeIds(source, args.sourceFilePath, targetNodeIds)
    : source;
  assertTargetsExist(source, targetNodeIds);

  const preservedAudioClips =
    currentRead.status === "valid"
      ? currentRead.document?.audioClips
      : undefined;
  const audioClips = args.audioClips ?? preservedAudioClips;
  let compiled: ReturnType<typeof compileMotionCode>;
  try {
    compiled = compileMotionCode(timeline, {
      easingVariables: args.easingVariables,
      ...(audioClips !== undefined ? { audioClips } : {}),
    });
  } catch (error) {
    throw normalizeTimelineError(error);
  }

  source = updateManagedStyle(source, compiled.css);
  const playbackMode =
    timeline.playbackMode ??
    readTimelinePlaybackMode(timeline.tracks) ??
    MOTION_DEFAULT_PLAYBACK_MODE;
  try {
    source = textDocument
      ? injectMotionTextRuntime(source, textDocument, playbackMode)
      : removeMotionTextRuntime(source);
  } catch (error) {
    if (error instanceof MotionHtmlSourceError) throw error;
    throw motionTextError(
      error instanceof Error
        ? error
        : new Error("Motion Text source could not be written."),
    );
  }
  source = applyPathTrimTargets(source, pathTrimTargetsFromTimeline(timeline));

  return {
    source,
    css: compiled.css,
    hash: compiled.hash,
    targetNodeIds,
  };
}

/** Reports whether an HTML source can safely own the requested Motion targets. */
export function inspectMotionHtmlSourceWriteCapability(args: {
  source: string;
  targetNodeIds: readonly string[];
  sourceFilePath?: string;
}): MotionHtmlSourceWriteCapability {
  let targetNodeIds = [...new Set(args.targetNodeIds)];
  try {
    const read = readSource(args.source, args.sourceFilePath);
    targetNodeIds = [
      ...new Set([
        ...targetNodeIds,
        ...(read.status === "valid"
          ? (read.document?.nativeStyles?.map((style) => style.targetNodeId) ??
            [])
          : []),
      ]),
    ];
    if (targetNodeIds.length === 0) {
      const canEditMetadata =
        read.status === "valid" &&
        ((read.document?.animationStyles?.length ?? 0) > 0 ||
          read.document?.audioClips !== undefined);
      if (!canEditMetadata) {
        sourceError(
          "missing-node",
          "HTML Motion source capability requires a target, saved style library, or source-backed audio clip.",
        );
      }
    }
    const source = args.sourceFilePath
      ? addGeneratedHtmlNodeIds(args.source, args.sourceFilePath, targetNodeIds)
      : args.source;
    assertTargetsExist(source, targetNodeIds);
    return { status: "supported", targetNodeIds };
  } catch (error) {
    const normalized =
      error instanceof MotionHtmlSourceError
        ? error
        : new MotionHtmlSourceError(
            "malformed-source",
            error instanceof Error
              ? error.message
              : "HTML Motion source capability could not be checked.",
          );
    return {
      status: "unsupported",
      targetNodeIds,
      code: normalized.code,
      reason: normalized.message,
    };
  }
}

/** Removes only valid managed Motion CSS and Text source, preserving all other HTML. */
export function removeMotionHtmlSource(
  source: string,
  sourceFilePath?: string,
): MotionHtmlSourceRemoval {
  const read = readSource(source, sourceFilePath, {
    allowUnmanagedExecutableScripts: true,
    cleanupOnly: true,
  });
  if (read.status === "absent") return { source, changed: false };

  const managedRuntimeScripts = parseHtml(source).nodes.filter(
    (node) =>
      node.tagName === "script" &&
      attributes(node, MOTION_TEXT_RUNTIME_ATTRIBUTE).length > 0,
  );
  if (
    managedRuntimeScripts.some(
      (node) => !isManagedMotionTextRuntime(source, node),
    )
  ) {
    sourceError(
      "invalid-motion-text",
      "The managed Motion Text runtime does not match a supported generated version.",
    );
  }

  const withoutAuthored = removeAuthoredHtmlMotion(source, sourceFilePath);
  const { nodes } = parseHtml(withoutAuthored);
  const managedStyle = findManagedStyle(withoutAuthored, nodes);
  let withoutStyle = withoutAuthored;
  if (managedStyle) {
    withoutStyle =
      withoutAuthored.slice(0, managedStyle.range.start) +
      withoutAuthored.slice(managedStyle.range.end);
  }
  let clean: string;
  try {
    clean = removeMotionTextRuntime(withoutStyle);
  } catch (error) {
    throw motionTextError(
      error instanceof Error
        ? error
        : new Error("Motion Text source could not be removed."),
    );
  }
  clean = restorePathTrimTargets(clean);
  return { source: clean, changed: clean !== source };
}
