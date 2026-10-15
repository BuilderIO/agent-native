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
  MOTION_TEXT_RUNTIME_ATTRIBUTE,
  MOTION_TEXT_SOURCE_ATTRIBUTE,
  MOTION_TEXT_SOURCE_VERSION,
  readMotionTextDocument,
  removeMotionTextRuntime,
  type MotionTextDocument,
} from "./motion-text-code";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  readTimelinePlaybackMode,
  type MotionPlaybackMode,
  type MotionTimeline,
} from "./motion-timeline";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const MANAGED_STYLE_ATTRIBUTE = "data-agent-native-motion";
const SAFE_NODE_ID = /^[A-Za-z0-9_-]{1,512}$/;

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
  const pending: Array<{ node: HtmlNode; insideTemplate: boolean }> = [
    { node: document, insideTemplate: false },
  ];
  while (pending.length > 0) {
    const { node, insideTemplate } = pending.pop()!;
    node.insideTemplate = insideTemplate;
    nodes.push(node);
    pending.push(
      ...(node.childNodes ?? [])
        .reverse()
        .map((child) => ({ node: child, insideTemplate })),
    );
    if (node.tagName === "template" && node.content) {
      pending.push({ node: node.content, insideTemplate: true });
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
): void {
  if (targetNodeIds.length === 0) return;
  const { nodes } = parseHtml(source);
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
    sourceFilePath
      ? generatedHtmlTargets(source, sourceFilePath).map((target) => [
          target.nodeId,
          target.node,
        ])
      : [],
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
    const inlineStyle = target.attrs?.find(({ name }) => name === "style");
    if (inlineStyle && hasInlineMotionDeclarations(inlineStyle.value)) {
      sourceError(
        "unsupported-target",
        `Motion target "${nodeId}" uses style, which cannot be synchronized with CSS Motion yet.`,
      );
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

function readAuthoredHtmlMotion(
  source: string,
  nodes: HtmlNode[],
  sourceFilePath?: string,
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
  let durationMs = 1;

  for (const node of nodes) {
    if (
      node.tagName !== "style" ||
      node.insideTemplate ||
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
    const result = importAuthoredCssAnimations(css, (selector) =>
      resolveAuthoredHtmlTarget(source, nodes, selector, generatedIds),
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

function isSupportedAuthoredHtmlStyle(node: HtmlNode): boolean {
  for (const attribute of node.attrs ?? []) {
    const name = attribute.name.toLowerCase();
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
  const authoredMotion = readAuthoredHtmlMotion(source, nodes, sourceFilePath);
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
  const targetNodeIds = targetsFromDocuments(document, textDocument);
  assertTargetsExist(source, targetNodeIds, sourceFilePath);
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
  if (!document && !textDocument) return { status: "absent" };

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
  const read = readSource(source, sourceFilePath);
  if (read.status === "absent") return { source, changed: false };

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
