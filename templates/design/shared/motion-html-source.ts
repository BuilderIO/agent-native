import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "@agent-native/core/shared/motion-source-node-id";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parse as parseJavaScript } from "acorn";
import * as cssTree from "css-tree";
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
import { motionNativeStylesToTracks } from "./motion-native-style-runtime";
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
  MOTION_PROPERTY_PRESETS,
  MOTION_DEFAULT_PLAYBACK_MODE,
  parseMotionPlaybackMode,
  readTimelinePlaybackMode,
  type MotionPlaybackMode,
  type MotionTrack,
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
  const baseDirective = normalized.split(".", 1)[0]!;
  return (
    baseDirective === "x-html" ||
    baseDirective === "v-html" ||
    normalized === "ng-bind-html" ||
    dynamicBoundAttributeName(normalized) === "innerhtml" ||
    ((normalized === "x-data" || normalized === "v-scope") &&
      !isStaticRuntimeScopeData(value)) ||
    isRuntimeLifecycleMutationAttribute(name) ||
    normalized === "x-show" ||
    normalized.startsWith("x-show.") ||
    normalized === "v-show" ||
    normalized.startsWith("v-show.") ||
    ((normalized === "x-bind" || normalized === "v-bind") &&
      runtimeObjectBindingHasDynamicValues(value)) ||
    normalized === ":class" ||
    normalized.startsWith(":class.") ||
    normalized === "x-bind:class" ||
    normalized.startsWith("x-bind:class.") ||
    normalized === "v-bind:class" ||
    normalized.startsWith("v-bind:class.") ||
    normalized === ":style" ||
    normalized.startsWith(":style.") ||
    normalized === "x-bind:style" ||
    normalized.startsWith("x-bind:style.") ||
    normalized === "v-bind:style" ||
    normalized.startsWith("v-bind:style.") ||
    normalized === "x-on" ||
    normalized.startsWith("x-on:") ||
    normalized === "v-on" ||
    normalized.startsWith("v-on:") ||
    normalized.startsWith("@")
  );
}

function runtimeObjectBindingHasDynamicValues(value: string): boolean {
  const expression = value.trim();
  if (!expression.startsWith("{") || !expression.endsWith("}")) return true;
  const entries = splitStaticObjectProperties(expression.slice(1, -1).trim());
  if (!entries) return true;
  return entries.some((entry) => {
    const property =
      /^(?:([A-Za-z_$][\w$]*)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:\s*(.+)$/s.exec(
        entry,
      );
    if (!property) return true;
    const name = (
      property[1] ??
      property[2] ??
      property[3] ??
      ""
    ).toLowerCase();
    return (
      ["class", "style", "hidden", "inert", "open"].includes(name) &&
      !isStaticRuntimeScopeValue(property[4]!.trim())
    );
  });
}

function runtimeObjectBindingMayWriteAttribute(
  value: string,
  attributeName: string,
): boolean {
  const expression = value.trim();
  if (!expression.startsWith("{") || !expression.endsWith("}")) return true;
  const entries = splitStaticObjectProperties(expression.slice(1, -1).trim());
  if (!entries) return true;
  return entries.some((entry) => {
    const property =
      /^(?:([A-Za-z_$][\w$]*)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:\s*(.+)$/s.exec(
        entry,
      );
    if (!property) return true;
    const name = property[1] ?? property[2] ?? property[3];
    if (name === undefined || name.includes("\\")) return true;
    return name?.toLowerCase() === attributeName.toLowerCase();
  });
}

function runtimeObjectBindingHasAnyDynamicAttributes(value: string): boolean {
  const expression = value.trim();
  if (!expression.startsWith("{") || !expression.endsWith("}")) return true;
  const entries = splitStaticObjectProperties(expression.slice(1, -1).trim());
  if (!entries) return true;
  return entries.some((entry) => {
    const property =
      /^(?:[A-Za-z_$][\w$]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:\s*(.+)$/s.exec(
        entry,
      );
    return !property || !isStaticRuntimeScopeValue(property[1]!.trim());
  });
}

function isRuntimeLifecycleMutationAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "x-init" ||
    normalized.startsWith("x-init.") ||
    normalized === "x-effect" ||
    normalized.startsWith("x-effect.")
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

function staticRuntimeScopeHasName(value: string, name: string): boolean {
  if (!isStaticRuntimeScopeData(value)) return false;
  const normalized = value.trim();
  const entries = splitStaticObjectProperties(normalized.slice(1, -1).trim());
  return (
    entries?.some((entry) => {
      const match = /^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/s.exec(entry);
      return match?.[1] === name;
    }) ?? false
  );
}

function enclosingStaticRuntimeScope(
  node: HtmlNode,
  boundary?: HtmlNode,
): { name: string; value: string } | undefined {
  let current: HtmlNode | undefined = node;
  while (current) {
    const scope = current.attrs?.find(({ name }) =>
      isRuntimeStyleMutationScope(name),
    );
    if (scope) return scope;
    if (current === boundary) break;
    current = current.parentNode;
  }
  return undefined;
}

function isSafeStaticVisibilityBinding(
  node: HtmlNode,
  name: string,
  value: string,
  boundary?: HtmlNode,
): boolean {
  const normalized = name.toLowerCase();
  if (normalized !== "x-show" && normalized !== "v-show") return false;

  const expression = value.trim();
  if (expression === "true" || expression === "false") return true;
  const match = /^!?([A-Za-z_$][\w$]*)$/.exec(expression);
  if (!match) return false;

  const scope = enclosingStaticRuntimeScope(node, boundary);
  return Boolean(scope && staticRuntimeScopeHasName(scope.value, match[1]!));
}

function isJavaScriptNode(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isJavaScriptIdentifier(value: unknown, name: string): boolean {
  return (
    isJavaScriptNode(value) &&
    value.type === "Identifier" &&
    value.name === name
  );
}

function isJavaScriptMember(
  value: unknown,
  objectName: string,
  propertyName: string,
): boolean {
  return (
    isJavaScriptNode(value) &&
    value.type === "MemberExpression" &&
    value.computed === false &&
    isJavaScriptIdentifier(value.object, objectName) &&
    isJavaScriptIdentifier(value.property, propertyName)
  );
}

function isSafeStaticRuntimeStateHandler(
  node: HtmlNode,
  name: string,
  value: string,
  boundary?: HtmlNode,
): boolean {
  if (!isRuntimeEventHandler(name)) return false;

  const scope = enclosingStaticRuntimeScope(node, boundary);
  if (!scope) return false;

  let program: unknown;
  try {
    program = parseJavaScript(value, { ecmaVersion: "latest" });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return false;
  }
  if (!isJavaScriptNode(program) || !Array.isArray(program.body)) return false;
  const [statement, ...rest] = program.body;
  if (rest.length > 0 || !isJavaScriptNode(statement)) return false;
  if (statement.type !== "ExpressionStatement") return false;

  const assignment = statement.expression;
  if (
    !isJavaScriptNode(assignment) ||
    assignment.type !== "AssignmentExpression" ||
    assignment.operator !== "=" ||
    !isJavaScriptNode(assignment.left) ||
    assignment.left.type !== "Identifier" ||
    typeof assignment.left.name !== "string" ||
    !staticRuntimeScopeHasName(scope.value, assignment.left.name)
  ) {
    return false;
  }

  const assignedName = assignment.left.name;
  const right = assignment.right;
  if (
    isJavaScriptNode(right) &&
    right.type === "Literal" &&
    ["string", "number", "boolean"].includes(typeof right.value)
  ) {
    return true;
  }
  if (isJavaScriptIdentifier(right, assignedName)) return true;
  return (
    isJavaScriptNode(right) &&
    right.type === "UnaryExpression" &&
    right.operator === "!" &&
    isJavaScriptIdentifier(right.argument, assignedName)
  );
}

function isStaticAlpineBootstrapRuntime(node: HtmlNode): boolean {
  if (
    node.tagName !== "script" ||
    attributes(node, "type")[0]?.value.trim().toLowerCase() !== "module" ||
    attributes(node, "src").length > 0
  ) {
    return false;
  }

  let program: unknown;
  try {
    program = parseJavaScript(textContent(node), {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return false;
  }
  if (!isJavaScriptNode(program) || !Array.isArray(program.body)) return false;
  const body = program.body;
  if (body.length !== 2 && body.length !== 3) return false;

  const [importDeclaration, ...afterImport] = body;
  if (
    !isJavaScriptNode(importDeclaration) ||
    importDeclaration.type !== "ImportDeclaration" ||
    !isJavaScriptNode(importDeclaration.source) ||
    importDeclaration.source.value !== "alpinejs" ||
    !Array.isArray(importDeclaration.specifiers) ||
    importDeclaration.specifiers.length !== 1
  ) {
    return false;
  }

  const defaultImport = importDeclaration.specifiers[0];
  if (
    !isJavaScriptNode(defaultImport) ||
    defaultImport.type !== "ImportDefaultSpecifier" ||
    !isJavaScriptNode(defaultImport.local) ||
    defaultImport.local.name !== "Alpine"
  ) {
    return false;
  }

  const startCall = afterImport[afterImport.length - 1];
  if (
    !isJavaScriptNode(startCall) ||
    startCall.type !== "ExpressionStatement" ||
    !isJavaScriptNode(startCall.expression) ||
    startCall.expression.type !== "CallExpression" ||
    !isJavaScriptMember(startCall.expression.callee, "Alpine", "start") ||
    !Array.isArray(startCall.expression.arguments) ||
    startCall.expression.arguments.length !== 0
  ) {
    return false;
  }

  if (afterImport.length === 1) return true;
  const exposure = afterImport[0];
  return (
    isJavaScriptNode(exposure) &&
    exposure.type === "ExpressionStatement" &&
    isJavaScriptNode(exposure.expression) &&
    exposure.expression.type === "AssignmentExpression" &&
    exposure.expression.operator === "=" &&
    isJavaScriptMember(exposure.expression.left, "window", "Alpine") &&
    isJavaScriptIdentifier(exposure.expression.right, "Alpine")
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
    const attribute = node.attrs?.find(
      ({ name, value }) =>
        isRuntimeStyleMutationHandler(name, value) &&
        !isSafeStaticVisibilityBinding(node, name, value) &&
        !isSafeStaticRuntimeStateHandler(node, name, value),
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

const JAVASCRIPT_URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "data",
]);

function isJavascriptUrl(value: string): boolean {
  return value
    .replace(/[\u0000-\u0020\u007f]/g, "")
    .toLowerCase()
    .startsWith("javascript:");
}

function isJavascriptUrlAttribute(name: string, value: string): boolean {
  return (
    JAVASCRIPT_URL_ATTRIBUTES.has(name.toLowerCase()) && isJavascriptUrl(value)
  );
}

function srcdocContainsExecutableContentOrNestedFrame(value: string): boolean {
  return parseHtml(value).nodes.some((node) => {
    if (node.insideTemplate) return false;
    if (
      (node.tagName === "script" && isExecutableScript(node)) ||
      node.tagName === "iframe" ||
      (node.attrs ?? []).some(
        ({ name, value: attributeValue }) =>
          isEventHandlerAttribute(name) ||
          isRuntimeLifecycleMutationAttribute(name) ||
          isJavascriptUrlAttribute(name, attributeValue),
      )
    ) {
      return true;
    }
    return false;
  });
}

// Every generated design loads these two from jsDelivr. Neither touches a
// Motion target by itself: Tailwind only reads classes already in the
// markup, and Alpine acts only through its directives, which the checks
// below refuse when they could change, replace or restyle a target. Any other
// script, or these URLs with inline code, extra attributes or a query, is
// still unknown code and stays refused.
const GENERATED_DESIGN_LIBRARY_SCRIPT_URLS = [
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4(?:\.\d+){0,2}(?:\/dist\/index\.global\.js)?$/,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs@3(?:\.\d+){0,2}\/dist\/cdn(?:\.min)?\.js$/,
];
const GENERATED_DESIGN_LIBRARY_SCRIPT_ATTRIBUTES = new Set([
  "src",
  "defer",
  "async",
  "crossorigin",
  "integrity",
  "referrerpolicy",
]);

function writesClasses(name: string, value: string): boolean {
  const normalized = name.toLowerCase();
  return (
    ((normalized === "x-bind" || normalized === "v-bind") &&
      runtimeObjectBindingMayWriteAttribute(value, "class")) ||
    dynamicBoundAttributeName(normalized.split(".", 1)[0]!) === "class" ||
    /\bclass(?:List|Name)\b|setAttribute\s*\(\s*["']class["']/.test(value)
  );
}

const MOTION_CONTROL_CSS_PROPERTY =
  /^(?:-(?:webkit|moz|ms|o)-)?(?:animation|transition)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/i;

const CSS_BORDER_SIDES = ["top", "right", "bottom", "left"] as const;
const CSS_LOGICAL_BORDER_SIDES = [
  "block-start",
  "block-end",
  "inline-start",
  "inline-end",
] as const;
const CSS_BORDER_PARTS = ["color", "style", "width"] as const;
const CSS_BORDER_IMAGE_LONGHANDS = [
  "border-image-outset",
  "border-image-repeat",
  "border-image-slice",
  "border-image-source",
  "border-image-width",
] as const;
const cssBorderLonghands = (sides: readonly string[]) =>
  sides.flatMap((side) =>
    CSS_BORDER_PARTS.map((part) => `border-${side}-${part}`),
  );
const CSS_ALL_BORDER_LONGHANDS = [
  "border-color",
  "border-style",
  "border-width",
  ...cssBorderLonghands(CSS_BORDER_SIDES),
  ...cssBorderLonghands(CSS_LOGICAL_BORDER_SIDES),
];
const CSS_SHORTHAND_LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  background: [
    "background-attachment",
    "background-clip",
    "background-color",
    "background-image",
    "background-origin",
    "background-position",
    "background-position-x",
    "background-position-y",
    "background-repeat",
    "background-repeat-x",
    "background-repeat-y",
    "background-size",
  ],
  border: [...CSS_ALL_BORDER_LONGHANDS, ...CSS_BORDER_IMAGE_LONGHANDS],
  "border-color": [
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-color`),
    ...CSS_LOGICAL_BORDER_SIDES.map((side) => `border-${side}-color`),
  ],
  "border-style": [
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-style`),
    ...CSS_LOGICAL_BORDER_SIDES.map((side) => `border-${side}-style`),
  ],
  "border-width": [
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-width`),
    ...CSS_LOGICAL_BORDER_SIDES.map((side) => `border-${side}-width`),
  ],
  ...Object.fromEntries(
    CSS_BORDER_SIDES.map((side) => [
      `border-${side}`,
      [`border-${side}-color`, `border-${side}-style`, `border-${side}-width`],
    ]),
  ),
  "border-radius": [
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "border-top-left-radius",
    "border-top-right-radius",
  ],
  "border-block": [
    ...cssBorderLonghands(["block-start", "block-end"]),
    ...cssBorderLonghands(CSS_BORDER_SIDES),
  ],
  "border-block-color": [
    ...["block-start", "block-end"].map((side) => `border-${side}-color`),
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-color`),
  ],
  "border-block-style": [
    ...["block-start", "block-end"].map((side) => `border-${side}-style`),
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-style`),
  ],
  "border-block-width": [
    ...["block-start", "block-end"].map((side) => `border-${side}-width`),
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-width`),
  ],
  "border-inline": [
    ...cssBorderLonghands(["inline-start", "inline-end"]),
    ...cssBorderLonghands(CSS_BORDER_SIDES),
  ],
  "border-inline-color": [
    ...["inline-start", "inline-end"].map((side) => `border-${side}-color`),
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-color`),
  ],
  "border-inline-style": [
    ...["inline-start", "inline-end"].map((side) => `border-${side}-style`),
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-style`),
  ],
  "border-inline-width": [
    ...["inline-start", "inline-end"].map((side) => `border-${side}-width`),
    ...CSS_BORDER_SIDES.map((side) => `border-${side}-width`),
  ],
  ...Object.fromEntries(
    CSS_LOGICAL_BORDER_SIDES.map((side) => [
      `border-${side}`,
      [...cssBorderLonghands([side]), ...cssBorderLonghands(CSS_BORDER_SIDES)],
    ]),
  ),
  "border-image": [...CSS_BORDER_IMAGE_LONGHANDS],
  "column-rule": [
    "column-rule-color",
    "column-rule-style",
    "column-rule-width",
  ],
  columns: ["column-count", "column-width"],
  flex: ["flex-basis", "flex-grow", "flex-shrink"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  font: [
    "font-family",
    "font-feature-settings",
    "font-kerning",
    "font-language-override",
    "font-optical-sizing",
    "font-size",
    "font-size-adjust",
    "font-stretch",
    "font-style",
    "font-synthesis",
    "font-variant",
    "font-variant-alternates",
    "font-variant-caps",
    "font-variant-east-asian",
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-position",
    "font-variation-settings",
    "font-weight",
    "line-height",
  ],
  "font-variant": [
    "font-variant-alternates",
    "font-variant-caps",
    "font-variant-east-asian",
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-position",
  ],
  gap: ["column-gap", "row-gap"],
  grid: [
    "grid-auto-columns",
    "grid-auto-flow",
    "grid-auto-rows",
    "grid-template-areas",
    "grid-template-columns",
    "grid-template-rows",
  ],
  "grid-area": [
    "grid-column-end",
    "grid-column-start",
    "grid-row-end",
    "grid-row-start",
  ],
  "grid-column": ["grid-column-end", "grid-column-start"],
  "grid-row": ["grid-row-end", "grid-row-start"],
  "grid-template": [
    "grid-template-areas",
    "grid-template-columns",
    "grid-template-rows",
  ],
  inset: [
    "bottom",
    "inset-block-end",
    "inset-block-start",
    "inset-inline-end",
    "inset-inline-start",
    "left",
    "right",
    "top",
  ],
  "inset-block": [
    "inset-block-end",
    "inset-block-start",
    "bottom",
    "left",
    "right",
    "top",
  ],
  "inset-inline": [
    "inset-inline-end",
    "inset-inline-start",
    "bottom",
    "left",
    "right",
    "top",
  ],
  "list-style": ["list-style-image", "list-style-position", "list-style-type"],
  margin: [
    ...CSS_BORDER_SIDES.map((side) => `margin-${side}`),
    "margin-block-end",
    "margin-block-start",
    "margin-inline-end",
    "margin-inline-start",
  ],
  "margin-block": [
    "margin-block-end",
    "margin-block-start",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
  ],
  "margin-inline": [
    "margin-inline-end",
    "margin-inline-start",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
  ],
  outline: ["outline-color", "outline-style", "outline-width"],
  overflow: ["overflow-x", "overflow-y"],
  padding: [
    ...CSS_BORDER_SIDES.map((side) => `padding-${side}`),
    "padding-block-end",
    "padding-block-start",
    "padding-inline-end",
    "padding-inline-start",
  ],
  "padding-block": [
    "padding-block-end",
    "padding-block-start",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
  ],
  "padding-inline": [
    "padding-inline-end",
    "padding-inline-start",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
  ],
  "place-content": ["align-content", "justify-content"],
  "place-items": ["align-items", "justify-items"],
  "place-self": ["align-self", "justify-self"],
  "scroll-margin": [
    ...CSS_BORDER_SIDES.map((side) => `scroll-margin-${side}`),
    "scroll-margin-block-end",
    "scroll-margin-block-start",
    "scroll-margin-inline-end",
    "scroll-margin-inline-start",
  ],
  "scroll-padding": [
    ...CSS_BORDER_SIDES.map((side) => `scroll-padding-${side}`),
    "scroll-padding-block-end",
    "scroll-padding-block-start",
    "scroll-padding-inline-end",
    "scroll-padding-inline-start",
  ],
  "text-decoration": [
    "text-decoration-color",
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-thickness",
  ],
};

function cssDeclarationAffectsMotionProperty(
  property: string,
  motionProperties: ReadonlySet<string> | undefined,
): boolean {
  if (
    property === "all" ||
    MOTION_CONTROL_CSS_PROPERTY.test(property) ||
    motionProperties?.has(property)
  ) {
    return true;
  }

  return (
    CSS_SHORTHAND_LONGHANDS[property]?.some((longhand) =>
      motionProperties?.has(longhand),
    ) ?? false
  );
}

function hasUnsafeMotionCssRule(
  nodes: readonly HtmlNode[],
  targetNodeIds: readonly string[],
  generatedIds: Map<number | undefined, string>,
  motionPropertiesByTarget: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  for (const node of nodes) {
    if (
      node.tagName !== "style" ||
      attributes(node, MANAGED_STYLE_ATTRIBUTE).length > 0 ||
      (node.insideTemplate && !isRenderedByAlpine(node)) ||
      !isPotentialCssStyle(node)
    ) {
      continue;
    }

    try {
      const stylesheet = cssTree.parse(textContent(node), {
        context: "stylesheet",
      });
      let affected = false;
      visitCssRules(
        stylesheet as unknown as CssTreeSelectorNode,
        false,
        false,
        (rule, insideReducedMotionMedia) => {
          if (affected) return;
          const declarations = cssTreeChildren(rule.block).filter(
            (child) => child.type === "Declaration",
          );
          const relevantDeclarations = declarations.filter((declaration) => {
            const property = declaration.property
              ? decodeMotionCssIdentifier(declaration.property).toLowerCase()
              : undefined;
            return (
              property !== undefined &&
              targetNodeIds.some((targetNodeId) =>
                cssDeclarationAffectsMotionProperty(
                  property,
                  motionPropertiesByTarget.get(targetNodeId),
                ),
              )
            );
          });
          if (relevantDeclarations.length === 0) return;
          const hasImportantDeclaration = relevantDeclarations.some(
            (declaration) =>
              declaration.important === true && !insideReducedMotionMedia,
          );
          const affectedTargets = targetNodeIds.filter((targetNodeId) => {
            const targetProperties = motionPropertiesByTarget.get(targetNodeId);
            return relevantDeclarations.some((declaration) => {
              const property = declaration.property
                ? decodeMotionCssIdentifier(declaration.property).toLowerCase()
                : undefined;
              return (
                property !== undefined &&
                cssDeclarationAffectsMotionProperty(property, targetProperties)
              );
            });
          });
          if (affectedTargets.length === 0) return;

          const selectorList = rule.prelude;
          for (const selector of cssTreeChildren(selectorList)) {
            if (selector.type !== "Selector") continue;
            if (
              affectedTargets.some((targetNodeId) => {
                const target = nodes.find((candidate) =>
                  isMotionTargetNode(
                    candidate,
                    new Set([targetNodeId]),
                    generatedIds,
                  ),
                );
                if (!target) return false;
                const effect = selectorEffectOnTarget(
                  selector,
                  target,
                  targetNodeId,
                );
                return (
                  effect.matches && (effect.dynamic || hasImportantDeclaration)
                );
              })
            ) {
              affected = true;
              return;
            }
          }
        },
      );
      if (affected) return true;
    } catch {
      return true;
    }
  }

  return false;
}

function visitCssRules(
  node: CssTreeSelectorNode | undefined,
  insideKeyframes: boolean,
  insideReducedMotionMedia: boolean,
  visit: (rule: CssTreeSelectorNode, insideReducedMotionMedia: boolean) => void,
): void {
  if (!node) return;
  const isKeyframes =
    node.type === "Atrule" && /^(?:-[\w]+-)?keyframes$/i.test(node.name ?? "");
  const nestedInKeyframes = insideKeyframes || isKeyframes;
  const isReducedMotionMedia =
    node.type === "Atrule" &&
    node.name?.toLowerCase() === "media" &&
    isReducedMotionMediaQuery(node.prelude);
  const nestedInReducedMotionMedia =
    insideReducedMotionMedia || isReducedMotionMedia;
  if (node.type === "Rule" && !insideKeyframes) {
    visit(node, insideReducedMotionMedia);
  }
  for (const child of cssTreeChildren(node)) {
    visitCssRules(child, nestedInKeyframes, nestedInReducedMotionMedia, visit);
  }
  if (node.block) {
    visitCssRules(
      node.block,
      nestedInKeyframes,
      nestedInReducedMotionMedia,
      visit,
    );
  }
}

function isReducedMotionMediaQuery(
  prelude: CssTreeSelectorNode | undefined,
): boolean {
  if (!prelude) return false;
  const query = cssTree
    .generate(prelude as Parameters<typeof cssTree.generate>[0])
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  // Only the standalone reduced-motion preference is exempt from the CSS conflict check.
  return /^\(prefers-reduced-motion:\s*reduce\)$/.test(query);
}

type CssTreeSelectorNode = {
  type: string;
  name?: string;
  property?: string;
  important?: boolean;
  children?: { toArray(): CssTreeSelectorNode[] };
  prelude?: CssTreeSelectorNode;
  block?: CssTreeSelectorNode;
};

function cssTreeChildren(
  node: CssTreeSelectorNode | undefined,
): CssTreeSelectorNode[] {
  return node?.children?.toArray() ?? [];
}

type SelectorMatch = { matches: boolean; dynamic: boolean };

const DYNAMIC_BROWSER_PSEUDO_CLASSES = new Set([
  "active",
  "any-link",
  "autofill",
  "checked",
  "default",
  "defined",
  "disabled",
  "enabled",
  "focus",
  "focus-visible",
  "focus-within",
  "fullscreen",
  "hover",
  "indeterminate",
  "invalid",
  "link",
  "modal",
  "open",
  "optional",
  "out-of-range",
  "paused",
  "placeholder-shown",
  "playing",
  "popover-open",
  "read-only",
  "read-write",
  "required",
  "target",
  "user-invalid",
  "user-valid",
  "valid",
  "visited",
]);

const STRUCTURAL_BROWSER_PSEUDO_CLASSES = new Set([
  "empty",
  "first-child",
  "first-of-type",
  "last-child",
  "last-of-type",
  "nth-child",
  "nth-last-child",
  "nth-of-type",
  "nth-last-of-type",
  "only-child",
  "only-of-type",
]);

function selectorEffectOnTarget(
  selector: CssTreeSelectorNode,
  target: HtmlNode,
  targetNodeId: string,
): SelectorMatch {
  const compounds: CssTreeSelectorNode[][] = [[]];
  const combinators: string[] = [];
  for (const child of cssTreeChildren(selector)) {
    if (child.type === "Combinator") {
      combinators.push(child.name ?? " ");
      compounds.push([]);
    } else {
      compounds[compounds.length - 1]!.push(child);
    }
  }
  if (compounds.some((compound) => compound.length === 0)) {
    return { matches: false, dynamic: false };
  }

  let currentNodes = [target];
  let dynamic = false;
  for (let index = compounds.length - 1; index >= 0; index--) {
    const matches = currentNodes.flatMap((candidate) => {
      const match = selectorCompoundMatches(
        candidate,
        compounds[index]!,
        targetNodeId,
      );
      return match.matches ? [{ candidate, match }] : [];
    });
    if (matches.length === 0) return { matches: false, dynamic: false };
    dynamic ||= matches.some(({ match }) => match.dynamic);
    if (index === 0) return { matches: true, dynamic };
    const combinator = combinators[index - 1] ?? " ";
    currentNodes = matches.flatMap(({ candidate }) =>
      selectorRelationCandidates(candidate, combinator),
    );
  }
  return { matches: false, dynamic: false };
}

function selectorCompoundMatches(
  node: HtmlNode,
  compound: readonly CssTreeSelectorNode[],
  targetNodeId: string,
): SelectorMatch {
  if (node.tagName === "template" && isAlpineStructuralTemplate(node)) {
    for (const contentNode of descendants(node.content)) {
      const contentMatch = selectorCompoundMatches(
        contentNode,
        compound,
        targetNodeId,
      );
      if (contentMatch.matches) {
        return { matches: true, dynamic: true };
      }
    }
  }

  let dynamic = false;
  for (const selector of compound) {
    if (selector.type === "UniversalSelector") continue;
    if (selector.type === "PseudoClassSelector") {
      const pseudoMatch = selectorPseudoMatchesNode(
        node,
        selector,
        targetNodeId,
      );
      if (!pseudoMatch.matches) return { matches: false, dynamic: false };
      dynamic ||= pseudoMatch.dynamic;
      continue;
    }

    const simple = parseMotionAuthoredCssSimpleSelector(
      cssTree.generate(selector as never),
    );
    if (!simple) {
      if (hasRuntimeMutationOnSelectorPath(node)) dynamic = true;
      continue;
    }
    const selectorAttribute =
      simple.kind === "id"
        ? "id"
        : simple.kind === "class"
          ? "class"
          : simple.kind === "attribute"
            ? simple.name
            : null;
    const virtualNodeIdMatch =
      simple.kind === "attribute" &&
      simple.name === NODE_ID_ATTRIBUTE &&
      simple.value === targetNodeId;
    const staticMatch =
      (virtualNodeIdMatch || matchesHtmlSelector(node, simple)) &&
      (simple.kind !== "type" || node.tagName?.toLowerCase() === simple.name);
    const dynamicMatch = Boolean(
      selectorAttribute &&
      node.attrs?.some(({ name, value }) =>
        isDynamicHtmlAttribute(name, selectorAttribute, value),
      ),
    );
    if (!staticMatch && !dynamicMatch)
      return { matches: false, dynamic: false };
    dynamic ||= dynamicMatch;
  }
  return { matches: true, dynamic };
}

function selectorPseudoMatchesNode(
  node: HtmlNode,
  pseudo: CssTreeSelectorNode,
  targetNodeId: string,
): SelectorMatch {
  const name = pseudo.name?.toLowerCase() ?? "";
  if (name === "is" || name === "where" || name === "not") {
    const selectorList = cssTreeChildren(pseudo).find(
      (child) => child.type === "SelectorList",
    );
    if (!selectorList) return { matches: true, dynamic: true };

    const matches = cssTreeChildren(selectorList).map((selector) =>
      selectorMatchesCandidate(node, selector, targetNodeId),
    );
    const anyMatch = matches.some((match) => match.matches);
    const dynamic = matches.some((match) => match.dynamic);
    if (dynamic) return { matches: true, dynamic: true };
    return {
      matches: name === "not" ? !anyMatch : anyMatch,
      dynamic: false,
    };
  }

  if (STRUCTURAL_BROWSER_PSEUDO_CLASSES.has(name)) {
    const siblings = htmlElementSiblings(node);
    const siblingIndex = siblings.indexOf(node);
    const matches =
      name === "empty"
        ? !(node.childNodes ?? []).some(
            (child) => child.tagName || child.nodeName === "#text",
          )
        : name === "first-child"
          ? siblingIndex === 0
          : name === "last-child"
            ? siblingIndex === siblings.length - 1
            : name === "only-child"
              ? siblings.length === 1
              : true;
    return {
      matches,
      dynamic:
        name === "empty"
          ? hasAlpineContentReplacement(node)
          : hasAlpineStructuralSibling(node),
    };
  }
  if (DYNAMIC_BROWSER_PSEUDO_CLASSES.has(name)) {
    return { matches: true, dynamic: true };
  }

  if (name === "has") {
    const selectorList = cssTreeChildren(pseudo).find(
      (child) => child.type === "SelectorList",
    );
    const nestedSelectors = selectorList ? cssTreeChildren(selectorList) : [];
    const hasRelativeCombinator = nestedSelectors.some((selector) =>
      cssTreeChildren(selector).some((child) => child.type === "Combinator"),
    );
    const dynamicNestedMatch = nestedSelectors.some((selector) => {
      const compound = cssTreeChildren(selector);
      if (compound.some((child) => child.type === "Combinator")) {
        return (
          selectorContainsDynamicPseudoState(selector) ||
          hasRuntimeMutationInPseudoNeighborhood(node)
        );
      }
      return descendants(node).some(
        (candidate) =>
          selectorCompoundMatches(candidate, compound, targetNodeId).dynamic,
      );
    });
    const dynamicSibling =
      hasRelativeCombinator &&
      htmlElementSiblings(node).some(
        (sibling) =>
          sibling !== node &&
          (isAlpineStructuralTemplate(sibling) ||
            hasRuntimeAttributeMutationInSubtree(sibling)),
      );
    const staticNestedMatch = nestedSelectors.some((selector) => {
      const compound = cssTreeChildren(selector);
      if (compound.some((child) => child.type === "Combinator")) return true;
      return descendants(node).some((candidate) => {
        const match = selectorCompoundMatches(
          candidate,
          compound,
          targetNodeId,
        );
        return match.matches && !match.dynamic;
      });
    });
    const dynamic =
      !selectorList ||
      dynamicNestedMatch ||
      dynamicSibling ||
      hasRuntimeMutationOnSelectorPath(node);
    return {
      matches: dynamic || staticNestedMatch,
      dynamic,
    };
  }

  return {
    matches: true,
    dynamic:
      hasRuntimeMutationOnSelectorPath(node) ||
      hasRuntimeAttributeMutationInSubtree(node),
  };
}

function selectorMatchesCandidate(
  node: HtmlNode,
  selector: CssTreeSelectorNode,
  targetNodeId: string,
): SelectorMatch {
  const compound = cssTreeChildren(selector);
  if (compound.some((child) => child.type === "Combinator")) {
    return {
      matches: false,
      dynamic:
        selectorContainsDynamicPseudoState(selector) ||
        hasRuntimeMutationInPseudoNeighborhood(node),
    };
  }
  return selectorCompoundMatches(node, compound, targetNodeId);
}

function selectorContainsDynamicPseudoState(
  node: CssTreeSelectorNode,
): boolean {
  return (
    (node.type === "PseudoClassSelector" &&
      DYNAMIC_BROWSER_PSEUDO_CLASSES.has(node.name?.toLowerCase() ?? "")) ||
    cssTreeChildren(node).some(selectorContainsDynamicPseudoState)
  );
}

function hasRuntimeMutationOnSelectorPath(node: HtmlNode): boolean {
  for (let candidate: HtmlNode | undefined = node; candidate?.tagName; ) {
    if (hasRuntimeHtmlMutation(candidate)) return true;
    candidate = candidate.parentNode;
  }
  return false;
}

function hasRuntimeMutationInPseudoNeighborhood(node: HtmlNode): boolean {
  return (
    hasRuntimeMutationOnSelectorPath(node) ||
    hasRuntimeAttributeMutationInSubtree(node) ||
    htmlElementSiblings(node).some(
      (sibling) =>
        sibling !== node &&
        (isAlpineStructuralTemplate(sibling) ||
          hasRuntimeAttributeMutationInSubtree(sibling)),
    )
  );
}

function selectorRelationCandidates(
  node: HtmlNode,
  combinator: string,
): HtmlNode[] {
  if (combinator === ">")
    return node.parentNode?.tagName ? [node.parentNode] : [];
  const siblings = htmlElementSiblings(node);
  const index = siblings.indexOf(node);
  if (index < 0) return [];
  if (combinator === "+") return index > 0 ? [siblings[index - 1]!] : [];
  if (combinator === "~") return siblings.slice(0, index).reverse();
  const ancestors: HtmlNode[] = [];
  for (
    let parent = node.parentNode;
    parent?.tagName;
    parent = parent.parentNode
  ) {
    ancestors.push(parent);
  }
  return ancestors;
}

function htmlElementSiblings(node: HtmlNode): HtmlNode[] {
  return (node.parentNode?.childNodes ?? [])
    .filter((candidate) => candidate.tagName)
    .sort(
      (left, right) =>
        (left.sourceCodeLocation?.startTag?.startOffset ?? -1) -
        (right.sourceCodeLocation?.startTag?.startOffset ?? -1),
    );
}

function isAlpineStructuralTemplate(node: HtmlNode): boolean {
  return (
    node.tagName === "template" &&
    node.attrs?.some(({ name }) =>
      /^x-(?:if|for|teleport)(?:\.|$)/i.test(name),
    ) === true
  );
}

function hasAlpineStructuralSibling(node: HtmlNode): boolean {
  return (node.parentNode?.childNodes ?? []).some(
    (sibling) => sibling !== node && isAlpineStructuralTemplate(sibling),
  );
}

function hasAlpineContentReplacement(node: HtmlNode): boolean {
  return (
    node.attrs?.some(({ name }) => isAlpineContentReplacement(name)) ?? false
  );
}

function hasRuntimeAttributeMutationInSubtree(node: HtmlNode): boolean {
  return descendants(node).some(hasRuntimeHtmlMutation);
}

function hasRuntimeHtmlMutation(node: HtmlNode): boolean {
  return (
    isAlpineStructuralTemplate(node) ||
    (node.attrs ?? []).some(({ name, value }) => {
      const normalized = name.toLowerCase();
      return (
        dynamicBoundAttributeName(normalized) !== null ||
        ((normalized === "x-bind" || normalized === "v-bind") &&
          runtimeObjectBindingHasAnyDynamicAttributes(value)) ||
        isRuntimeStyleMutationHandler(name, value) ||
        isEventHandlerAttribute(name)
      );
    })
  );
}

function descendants(node: HtmlNode | undefined): HtmlNode[] {
  if (!node) return [];
  const result: HtmlNode[] = [];
  const pending = [...(node.childNodes ?? [])];
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    result.push(candidate);
    pending.push(...(candidate.childNodes ?? []));
    if (candidate.content) pending.push(candidate.content);
  }
  return result;
}

function buildsStringAtRuntime(value: string): boolean {
  return (
    /`[^`]*\$\{/.test(value) ||
    /\+/.test(value) ||
    /\bfromCharCode\b|\.\s*(?:join|concat|replace(?:All)?|repeat)\s*\(/.test(
      value,
    )
  );
}

function isTailwindBrowserRuntime(node: HtmlNode): boolean {
  return (
    node.tagName === "script" &&
    !node.insideTemplate &&
    isGeneratedDesignLibraryScript(node) &&
    GENERATED_DESIGN_LIBRARY_SCRIPT_URLS[0]!.test(
      attributes(node, "src")[0]?.value.trim() ?? "",
    )
  );
}

function isGeneratedDesignLibraryScript(node: HtmlNode): boolean {
  if ((node.childNodes ?? []).some((child) => (child.value ?? "").trim())) {
    return false;
  }
  const attrs = node.attrs ?? [];
  if (
    !attrs.every((attr) =>
      GENERATED_DESIGN_LIBRARY_SCRIPT_ATTRIBUTES.has(attr.name.toLowerCase()),
    )
  ) {
    return false;
  }
  const src = attributes(node, "src");
  return (
    src.length === 1 &&
    GENERATED_DESIGN_LIBRARY_SCRIPT_URLS.some((url) =>
      url.test(src[0]!.value.trim()),
    )
  );
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
  motionPropertiesByTarget: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const alpineBootstraps = nodes.filter(isStaticAlpineBootstrapRuntime);
  const alpineBootstrap =
    alpineBootstraps.length === 1 ? alpineBootstraps[0] : undefined;
  const compilesClassesAtRuntime =
    targetNodeIds.length > 0 && nodes.some(isTailwindBrowserRuntime);
  if (
    hasUnsafeMotionCssRule(
      nodes,
      targetNodeIds,
      generatedIds,
      motionPropertiesByTarget,
    )
  ) {
    sourceError(
      "unsupported-target",
      "HTML Motion targets cannot be synchronized safely while runtime HTML state can change CSS for an animated property.",
    );
  }

  for (const node of nodes) {
    if (node.insideTemplate && !isRenderedByAlpine(node)) continue;

    // The Tailwind browser runtime compiles classes as they are added, and an
    // arbitrary variant ([&~main_h1]:) can style elements other than its own.
    // A class assembled at runtime may spell one that no literal shows.
    const runtimeVariant =
      compilesClassesAtRuntime &&
      node.attrs?.find(
        ({ name, value }) =>
          (isAlpineExpressionAttribute(name) ||
            isEventHandlerAttribute(name) ||
            /^x-transition/i.test(name)) &&
          (/\[[^\]]*\]:/.test(value) ||
            (writesClasses(name, value) && buildsStringAtRuntime(value))),
      );
    if (runtimeVariant) {
      sourceError(
        "unsupported-target",
        `HTML Motion targets cannot be synchronized safely while ${runtimeVariant.name} may add a Tailwind arbitrary variant that restyles them.`,
      );
    }

    const markupSink =
      targetNodeIds.length > 0 &&
      node.attrs?.find(({ name }) => isAlpineMarkupInjection(name));
    if (markupSink) {
      sourceError(
        "unsupported-target",
        `HTML Motion targets cannot be synchronized safely while ${markupSink.name} may inject a stylesheet.`,
      );
    }

    // A template is never rendered, so nothing fires its event handlers.
    const targetMutatingHandler = node.attrs?.find(
      ({ name, value }) =>
        !(node.tagName === "template" && isEventHandlerAttribute(name)) &&
        (isEventHandlerAttribute(name) ||
          isRuntimeLifecycleMutationAttribute(name) ||
          isAlpineExpressionAttribute(name)) &&
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

    const javascriptUrl = node.attrs?.find(({ name, value }) =>
      isJavascriptUrlAttribute(name, value),
    );
    if (javascriptUrl) {
      sourceError(
        "unsupported-target",
        `HTML Motion targets cannot be synchronized safely while ${javascriptUrl.name} contains a javascript URL.`,
      );
    }

    const srcdoc = attributes(node, "srcdoc")[0]?.value;
    if (
      node.tagName === "iframe" &&
      srcdoc &&
      srcdocContainsExecutableContentOrNestedFrame(srcdoc)
    ) {
      sourceError(
        "unsupported-target",
        "HTML Motion targets cannot be synchronized safely while an iframe srcdoc contains an executable script, event handler, javascript URL, or nested frame.",
      );
    }

    if (node.tagName !== "script") continue;
    if (
      alpineBootstrap &&
      attributes(node, "type")[0]?.value.trim().toLowerCase() === "importmap"
    ) {
      sourceError(
        "unsupported-target",
        "HTML Motion targets cannot be synchronized safely while an executable script may change their class or style.",
      );
    }
    if (
      !isExecutableScript(node) &&
      !hasPotentialRuntimeMutationHandler(node.attrs)
    ) {
      continue;
    }
    if (
      !hasPotentialRuntimeMutationHandler(node.attrs) &&
      (node === alpineBootstrap || isManagedMotionTextRuntime(source, node))
    ) {
      continue;
    }
    if (isGeneratedDesignLibraryScript(node)) continue;
    sourceError(
      "unsupported-target",
      "HTML Motion targets cannot be synchronized safely while an executable script may change their class or style.",
    );
  }
}

// Alpine clones x-if, x-for and x-teleport template content into the live
// document, so what it renders runs like any other markup.
function isRenderedByAlpine(node: HtmlNode): boolean {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (
      current.tagName === "template" &&
      current.attrs?.some(({ name }) =>
        /^x-(?:if|for|teleport)(?:\.|$)/i.test(name),
      )
    ) {
      return true;
    }
  }
  return false;
}

function isAlpineMarkupInjection(name: string): boolean {
  const directive = name.toLowerCase().split(".", 1)[0]!;
  return (
    directive === "x-html" ||
    ["innerhtml", "outerhtml"].includes(
      dynamicBoundAttributeName(directive) ?? "",
    )
  );
}

function isAlpineContentReplacement(name: string): boolean {
  const directive = name.toLowerCase().split(".", 1)[0]!;
  return (
    directive === "x-text" ||
    isAlpineMarkupInjection(directive) ||
    ["textcontent", "innertext"].includes(
      dynamicBoundAttributeName(directive) ?? "",
    )
  );
}

function findContentReplacement(
  target: HtmlNode,
):
  | { attribute: { name: string; value: string }; onTarget: boolean }
  | undefined {
  for (
    let current: HtmlNode | undefined = target;
    current;
    current = current.parentNode
  ) {
    // x-text on the target only replaces its text, which CSS Motion does not
    // depend on; Motion Text refuses dynamic text on its own.
    const replaces =
      current === target ? isAlpineMarkupInjection : isAlpineContentReplacement;
    const attribute = current.attrs?.find(({ name }) => replaces(name));
    if (attribute) return { attribute, onTarget: current === target };
  }
  return undefined;
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

// Alpine evaluates every directive value as JavaScript on any element, so a
// binding on a sibling can reach a Motion target as surely as a handler can.
// Directives whose values are class lists, selectors or names are not run.
const ALPINE_NON_EXPRESSION_DIRECTIVES = new Set([
  "x-cloak",
  "x-ignore",
  "x-ref",
  "x-teleport",
]);

function isAlpineExpressionAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized.startsWith(":") || normalized.startsWith("@")) return true;
  if (!normalized.startsWith("x-")) return false;
  const directive = normalized.split(/[.:]/, 1)[0]!;
  return (
    !ALPINE_NON_EXPRESSION_DIRECTIVES.has(directive) &&
    directive !== "x-transition"
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
  if (mayMutateThroughDomTraversal(value)) {
    return true;
  }

  const targetIds = new Set(targetNodeIds);
  if (mayMutateThroughAlternateDomRoot(value, nodes, targetIds, generatedIds)) {
    return true;
  }
  if (
    alpineMagicMayMutateMotionTarget(
      value,
      handlerNode,
      nodes,
      targetIds,
      generatedIds,
    )
  ) {
    return true;
  }
  const handlerReachesTarget = () =>
    isMotionTargetNode(handlerNode, targetIds, generatedIds) ||
    containsMotionTarget(handlerNode, nodes, targetIds, generatedIds);
  if (
    (DIRECT_ELEMENT_CONTENT_REPLACEMENT.test(value) ||
      (REFLECTIVE_WRITE.test(value) && SELF_REFERENCE.test(value))) &&
    handlerReachesTarget()
  ) {
    return true;
  }
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

// $root and $refs hand an expression elements it never selects, so the
// selector checks cannot see them reach a Motion target. Both resolve
// through the x-data components around the expression; x-init runs an
// expression without starting one, so it is not a root. Replacing an
// element's content removes any Motion target inside it.
function alpineMagicMayMutateMotionTarget(
  value: string,
  handlerNode: HtmlNode,
  nodes: readonly HtmlNode[],
  targetIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  if (!mayWriteElement(value)) return false;
  const roots = alpineRoots(handlerNode);
  if (roots.length === 0) return false;
  const reachesTarget = (node: HtmlNode) =>
    isMotionTargetNode(node, targetIds, generatedIds) ||
    containsMotionTarget(node, nodes, targetIds, generatedIds);

  if (/\$root\b/.test(value) && reachesTarget(roots[0]!)) return true;

  const refs =
    /\$refs\b(?:\s*\??\.\s*([A-Za-z_$][\w$]*)|\s*\[\s*(["'])([^"']*)\2\s*\])?/g;
  // Alpine merges the refs of every component around the expression, the
  // nearest first, so a name resolves in the nearest component defining it.
  const refsIn = (root: HtmlNode, name: string | undefined) =>
    nodes.filter(
      (node) =>
        alpineRoots(node)[0] === root &&
        attributes(node, "x-ref").some(
          ({ value: ref }) => name === undefined || ref === name,
        ),
    );
  for (const match of value.matchAll(refs)) {
    const name = match[1] ?? match[3];
    const referenced =
      name === undefined
        ? roots.flatMap((root) => refsIn(root, undefined))
        : (roots
            .map((root) => refsIn(root, name))
            .find((found) => found.length > 0) ?? []);
    if (referenced.some(reachesTarget)) return true;
  }
  return false;
}

function alpineRoots(node: HtmlNode): HtmlNode[] {
  const roots: HtmlNode[] = [];
  for (
    let current: HtmlNode | undefined = node;
    current;
    current = current.parentNode
  ) {
    if (attributes(current, "x-data").length > 0) roots.push(current);
  }
  return roots;
}

const CONTENT_REPLACEMENT_MEMBERS = String.raw`innerHTML|outerHTML|textContent|innerText|outerText|replaceChildren|replaceWith|remove|removeChild|insertAdjacentHTML`;
const CONTENT_REPLACEMENT_MEMBER_ACCESS = String.raw`(?:\?\.|\.)\s*(?:${CONTENT_REPLACEMENT_MEMBERS})\b|\[\s*["'](?:${CONTENT_REPLACEMENT_MEMBERS})["']\s*\]`;
const CONTENT_REPLACEMENT_ACCESS = new RegExp(
  CONTENT_REPLACEMENT_MEMBER_ACCESS,
);
// These write any property named by a string or key, so the member checks
// cannot tell what they change.
const REFLECTIVE_WRITE =
  /\b(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties)|Reflect\s*\.\s*(?:set|defineProperty))\s*\(/;

const REFLECTIVE_WRITE_TARGET =
  /\b(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties)|Reflect\s*\.\s*(?:set|defineProperty))\s*\(\s*$/;
const SELF_REFERENCE =
  /(?:\bthis\b|\$el\b|\b(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))/;

function mayWriteElement(value: string): boolean {
  return (
    MUTATION_MEMBER_ACCESS_PATTERN.test(value) ||
    CONTENT_REPLACEMENT_ACCESS.test(value) ||
    REFLECTIVE_WRITE.test(value)
  );
}

const MUTATION_MEMBER_ACCESS = String.raw`(?:\?\.|\.)\s*(?:style\b|classList\b|className\b|setAttribute(?:NS)?\s*\(|removeAttribute\s*\(|toggleAttribute\s*\(|animate\s*\()|\[\s*["'](?:style|classList|className|setAttribute(?:NS)?|removeAttribute|toggleAttribute|animate)["']\s*\]`;
const MUTATION_MEMBER_ACCESS_PATTERN = new RegExp(MUTATION_MEMBER_ACCESS, "i");

function handlerElementSelectorMayMutateMotionTarget(
  value: string,
  handlerNode: HtmlNode,
  nodes: readonly HtmlNode[],
  targetIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  const selectorNames = String.raw`querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|Name|TagName)`;
  const scope = String.raw`(?:this|\$el|(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))`;
  const selectorCall = new RegExp(
    String.raw`(?:^|[^\w$])${scope}\s*(?:\.\s*(${selectorNames})|\[\s*["'](${selectorNames})["']\s*\])\s*\(`,
    "gi",
  );
  const hasMutation = mayWriteElement(value);
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

const DIRECT_ELEMENT_MUTATION = new RegExp(
  String.raw`(?:\bthis\b|\b(?:event|e)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\])|\$el|\$event\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))\s*(?:${MUTATION_MEMBER_ACCESS})`,
  "i",
);

const DIRECT_ELEMENT_CONTENT_REPLACEMENT = new RegExp(
  String.raw`(?:\bthis\b|\$el|\b(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))\s*(?:${CONTENT_REPLACEMENT_MEMBER_ACCESS})`,
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
  return traversesDom && mayWriteElement(value);
}

function mayMutateThroughAlternateDomRoot(
  value: string,
  nodes: readonly HtmlNode[],
  targetIds: ReadonlySet<string>,
  generatedIds: Map<number | undefined, string>,
): boolean {
  const root = String.raw`(?:this|\$el|\$root|\$refs\s*(?:\??\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])|(?:event|e|\$event)\s*(?:\.\s*(?:currentTarget|target)|\[\s*["'](?:currentTarget|target)["']\s*\]))`;
  const selectorNames = String.raw`querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|Name|TagName)`;
  const selectorCalls = new RegExp(
    String.raw`(?<![\w$])${root}\s*(?:\.\s*(?:ownerDocument)|\.\s*getRootNode\s*\(\s*\)|\[\s*["'](?:ownerDocument|getRootNode)["']\s*\](?:\s*\(\s*\))?)\s*(?:\.\s*(${selectorNames})|\[\s*["'](${selectorNames})["']\s*\])\s*\(`,
    "gi",
  );
  let match: RegExpExecArray | null;

  while ((match = selectorCalls.exec(value)) !== null) {
    const callStartIndex = match.index;
    const method = match[1] ?? match[2]!;
    const openParenIndex = selectorCalls.lastIndex - 1;
    const callEndIndex = findSelectorCallEnd(value, openParenIndex);
    if (callEndIndex === null) return true;
    if (
      !alternateRootSelectorCallFeedsMutationSink(
        value,
        callStartIndex,
        callEndIndex,
        method,
      )
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
    if (selectorMayTargetMotionNode(selector, nodes, targetIds, generatedIds)) {
      return true;
    }
  }

  return false;
}

function alternateRootSelectorCallFeedsMutationSink(
  source: string,
  callStartIndex: number,
  callEndIndex: number,
  method: string,
): boolean {
  const afterCall = source.slice(callEndIndex);
  if (selectedElementHasActualMutationSink(afterCall)) return true;

  const assignment =
    /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*$/.exec(
      source.slice(0, callStartIndex),
    );
  if (
    assignment &&
    identifierHasActualMutationSink(afterCall, assignment[1]!)
  ) {
    return true;
  }

  if (method.toLowerCase() === "queryselectorall") {
    const callbackStatus = querySelectorAllCallbackMutationStatus(afterCall);
    const forOfStatus = querySelectorAllForOfMutationStatus(
      source,
      callStartIndex,
      callEndIndex,
    );
    if (callbackStatus === true || forOfStatus === true) return true;
    if (callbackStatus === false || forOfStatus === false) return false;
  }

  return destructuredSelectorCallHasActualMutationSink(
    source.slice(0, callStartIndex),
    afterCall,
  );
}

const ACTUAL_MUTATION_MEMBER_ACCESS = String.raw`(?:\?\.|\.)\s*(?:style(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\]))*\s*(?:=(?!=)|\+=|-=|\+\+|--)|style\s*(?:\?\.|\.)\s*(?:setProperty|removeProperty)\s*\(|classList\s*(?:\?\.|\.)\s*(?:add|remove|toggle|replace)\s*\(|className\s*(?:=(?!=)|\+=)|(?:setAttribute(?:NS)?|removeAttribute|toggleAttribute|animate)\s*\()|\[\s*["'](?:setAttribute(?:NS)?|removeAttribute|toggleAttribute|animate)["']\s*\]\s*\(`;

function selectedElementHasActualMutationSink(suffix: string): boolean {
  return new RegExp(
    String.raw`^\s*(?:\[\s*\d+\s*\]\s*)?${ACTUAL_MUTATION_MEMBER_ACCESS}`,
    "i",
  ).test(suffix);
}

function identifierHasActualMutationSink(
  source: string,
  identifier: string,
): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(
      `\\b${escaped}\\s*(?:${ACTUAL_MUTATION_MEMBER_ACCESS})`,
      "i",
    ).test(source) ||
    new RegExp(
      `\\bObject\\s*\\.\\s*assign\\s*\\(\\s*${escaped}\\s*(?:\\?\\.|\\.)\\s*style\\b`,
      "i",
    ).test(source)
  );
}

function identifierAliasHasActualMutationSink(
  source: string,
  identifier: string,
): boolean {
  return identifierAliases(source, identifier).some((alias) =>
    identifierHasActualMutationSink(source, alias),
  );
}

function styleAliasHasActualMutationSink(
  source: string,
  identifier: string,
): boolean {
  return identifierAliases(source, identifier).some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
      new RegExp(
        `\\b${escaped}\\s*(?:(?:\\.\\s*[A-Za-z_$][\\w$]*|\\[\\s*[^\\]]+\\s*\\])\\s*(?:=(?!=)|\\+=|-=|\\+\\+|--)|(?:\\?\\.|\\.)\\s*(?:setProperty|removeProperty)\\s*\\()`,
        "i",
      ).test(source) ||
      new RegExp(
        `\\bObject\\s*\\.\\s*assign\\s*\\(\\s*${escaped}(?:\\s*[,\\)])`,
        "i",
      ).test(source)
    );
  });
}

function destructuredBindingsMayMutate(
  bindings: string,
  source: string,
): boolean {
  return bindings.split(",").some((binding) => {
    const [property, alias] = binding.split(/\s*:\s*/);
    const name = alias?.trim() || property?.trim();
    if (!name) return false;
    if (property?.trim() === "classList") {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `\\b${escaped}\\s*(?:\\?\\.|\\.)\\s*(?:add|remove|toggle|replace)\\s*\\(`,
        "i",
      ).test(source);
    }
    return (
      property?.trim() === "style" &&
      styleAliasHasActualMutationSink(source, name)
    );
  });
}

function querySelectorAllCallbackMutationStatus(
  source: string,
): boolean | null {
  const methodCall =
    /^\s*[\])]*\s*\.\s*(?:forEach|map|filter|some|every)\s*\(/i.exec(source);
  const callback =
    /^\s*[\])]*\s*\.\s*(?:forEach|map|filter|some|every)\s*\(\s*(?:async\s+)?(?:\(\s*([\w$]+)\s*\)|([\w$]+)|\(\s*\{\s*([^}]+)\s*\}\s*\))\s*=>/i.exec(
      source,
    );
  if (!methodCall) return null;
  if (!callback) return true;

  const methodOpenIndex = methodCall[0].lastIndexOf("(");
  const callEnd = findSelectorCallEnd(
    source,
    methodCall.index + methodOpenIndex,
  );
  if (callEnd === null) return true;

  const callbackBody = source.slice(callback[0].length, callEnd - 1);
  const callbackParameter = callback[1] ?? callback[2];
  if (callbackParameter) {
    return identifierAliasHasActualMutationSink(
      callbackBody,
      callbackParameter,
    );
  }
  return (
    callback[3] !== undefined &&
    destructuredBindingsMayMutate(callback[3], callbackBody)
  );
}

function destructuredSelectorCallHasActualMutationSink(
  prefix: string,
  suffix: string,
): boolean {
  const assignment = /\b(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*$/.exec(
    prefix,
  );
  if (!assignment) return false;

  return destructuredBindingsMayMutate(assignment[1]!, suffix);
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
    if (identifierWriteSink(alias).test(source)) return true;
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
  return [...aliases].some(
    (alias) =>
      identifierMutationSink(alias).test(value) ||
      identifierWriteSink(alias).test(value),
  );
}

function eventTargetAliasMayMutate(value: string): boolean {
  const targetExpression =
    /^(?:event|e|\$event)\s*(?:\.\s*target|\[\s*["']target["']\s*\])/i;
  const aliases = assignedAliases(value, targetExpression);
  return [...aliases].some(
    (alias) =>
      identifierMutationSink(alias).test(value) ||
      identifierWriteSink(alias).test(value),
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
  const destructuredMutationCandidate =
    /\b(?:const|let|var)\s*\{[^}]*\b(?:style|classList)\b[^}]*\}\s*=|\(\s*\{[^}]*\b(?:style|classList)\b[^}]*\}\s*\)\s*=>/i.test(
      value,
    );
  if (
    !usesDocumentSelector ||
    (!mayWriteElement(value) && !destructuredMutationCandidate)
  )
    return false;

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
  if (REFLECTIVE_WRITE_TARGET.test(source.slice(0, callStartIndex))) {
    return true;
  }
  if (
    destructuredSelectorCallHasActualMutationSink(
      source.slice(0, callStartIndex),
      afterCall,
    )
  ) {
    return true;
  }

  if (method.toLowerCase() === "queryselectorall") {
    const callbackStatus = querySelectorAllCallbackMutationStatus(afterCall);
    if (callbackStatus !== null) return callbackStatus;
    if (
      arrayFromSelectorCallbackMayMutate(source, callStartIndex, callEndIndex)
    ) {
      return true;
    }
    const forOfStatus = querySelectorAllForOfMutationStatus(
      source,
      callStartIndex,
      callEndIndex,
    );
    if (forOfStatus !== null) return forOfStatus;
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

function arrayFromSelectorCallbackMayMutate(
  source: string,
  callStartIndex: number,
  callEndIndex: number,
): boolean {
  if (!/\bArray\s*\.\s*from\s*\(\s*$/.test(source.slice(0, callStartIndex)))
    return false;

  const callback =
    /^\s*,\s*(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)(?:\s*,[^)]*)?\)|([A-Za-z_$][\w$]*))\s*=>/i.exec(
      source.slice(callEndIndex),
    );
  const callbackParameter = callback?.[1] ?? callback?.[2];
  return (
    callbackParameter !== undefined &&
    identifierAliasHasActualMutationSink(
      source.slice(callEndIndex),
      callbackParameter,
    )
  );
}

function querySelectorAllForOfMutationStatus(
  source: string,
  callStartIndex: number,
  callEndIndex: number,
): boolean | null {
  const prefix = source.slice(0, callStartIndex);
  const forOfHeader = /\bfor\s*\(([^)]*)\bof\s*(?:\[\s*\.\.\.\s*)?$/i.exec(
    prefix,
  );
  if (!forOfHeader) return null;

  const binding = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*$/.exec(
    forOfHeader[1]!,
  );
  if (!binding) return true;

  const afterCall = source.slice(callEndIndex);
  const loopHeaderEnd = /^\s*\]?\s*\)\s*/.exec(afterCall);
  if (!loopHeaderEnd) return true;

  const loopBody = afterCall.slice(loopHeaderEnd[0].length);
  if (loopBody.startsWith("{")) {
    const bodyEnd = findMatchingBlockEnd(loopBody, 0);
    if (bodyEnd === null) return true;
    return identifierAliasHasActualMutationSink(
      loopBody.slice(1, bodyEnd),
      binding[1]!,
    );
  }

  const statementEnd = loopBody.indexOf(";");
  const statement =
    statementEnd < 0 ? loopBody : loopBody.slice(0, statementEnd);
  return identifierAliasHasActualMutationSink(statement, binding[1]!);
}

function findMatchingBlockEnd(
  source: string,
  openBraceIndex: number,
): number | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = openBraceIndex; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth++;
    } else if (character === "}" && --depth === 0) {
      return index;
    }
  }

  return null;
}

const SELECTED_ELEMENT_MUTATION_SINK = new RegExp(
  `^\\s*(?:\\[\\s*\\d+\\s*\\]\\s*)?(?:${MUTATION_MEMBER_ACCESS})`,
  "i",
);

// Content replacement on an element, or a reflective write taking it first.
function identifierWriteSink(identifier: string): RegExp {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`\b${escaped}\s*(?:${CONTENT_REPLACEMENT_MEMBER_ACCESS})|\b(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties)|Reflect\s*\.\s*(?:set|defineProperty))\s*\(\s*${escaped}\b`,
    "i",
  );
}

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

    const attribute = node.attrs?.find(
      ({ name, value }) =>
        isRuntimeStyleMutationHandler(name, value) &&
        !isSafeStaticVisibilityBinding(node, name, value, scope) &&
        !isSafeStaticRuntimeStateHandler(node, name, value, scope),
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

function motionPropertiesForTargets(
  targetNodeIds: readonly string[],
  motionTracks: readonly MotionTrack[],
): Map<string, Set<string>> {
  const propertiesByTarget = new Map<string, Set<string>>();
  for (const targetNodeId of targetNodeIds) {
    const properties = new Set<string>();
    for (const track of motionTracks) {
      if (track.enabled === false || track.targetNodeId !== targetNodeId) {
        continue;
      }
      if (track.property === "path-trim") {
        properties.add("stroke-dasharray");
        properties.add("stroke-dashoffset");
      } else if (
        track.property === "translate" &&
        track.keyframes.some((keyframe) => keyframe.motionPath)
      ) {
        for (const property of [
          "offset-path",
          "offset-anchor",
          "offset-rotate",
          "offset-distance",
          "offset",
          "translate",
        ]) {
          properties.add(property);
        }
      } else {
        properties.add(track.property.toLowerCase());
      }
    }
    if (properties.size === 0) {
      for (const preset of MOTION_PROPERTY_PRESETS) {
        properties.add(preset.property.toLowerCase());
        for (const property of preset.additionalProperties ?? []) {
          properties.add(property.toLowerCase());
        }
      }
    }
    propertiesByTarget.set(targetNodeId, properties);
  }
  return propertiesByTarget;
}

function assertTargetsExist(
  source: string,
  targetNodeIds: readonly string[],
  sourceFilePath?: string,
  checkExecutableScripts = true,
  checkEditSafety = true,
  motionTracks: readonly MotionTrack[] = [],
  rejectAllImportant = false,
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
  const motionPropertiesByTarget = motionPropertiesForTargets(
    targetNodeIds,
    motionTracks,
  );
  if (checkExecutableScripts) {
    assertExecutableScriptsSafe(
      source,
      nodes,
      targetNodeIds,
      generatedIds,
      motionPropertiesByTarget,
    );
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
      const contentReplacement = findContentReplacement(target);
      if (contentReplacement) {
        const { attribute, onTarget } = contentReplacement;
        sourceError(
          "unsupported-target",
          `Motion target "${nodeId}" ${onTarget ? "uses" : "has an ancestor using"} ${attribute.name}, which replaces its content when Alpine runs.`,
        );
      }
      const inlineStyle = target.attrs?.find(({ name }) => name === "style");
      if (
        inlineStyle &&
        hasInlineMotionDeclarations(
          inlineStyle.value,
          motionPropertiesByTarget.get(nodeId),
          rejectAllImportant,
        )
      ) {
        sourceError(
          "unsupported-target",
          `Motion target "${nodeId}" uses style that conflicts with CSS Motion.`,
        );
      }
    }
  }
}

function hasInlineMotionDeclarations(
  value: string,
  animatedProperties: ReadonlySet<string> = new Set(),
  rejectAllImportant = false,
): boolean {
  try {
    const declarations = postcss.parse(`.motion-target {\n${value}\n}`);
    let found = false;
    declarations.walkDecls((declaration) => {
      const property = decodeMotionCssIdentifier(
        declaration.prop,
      ).toLowerCase();
      if (
        MOTION_CONTROL_CSS_PROPERTY.test(property) ||
        (declaration.important &&
          cssDeclarationAffectsMotionProperty(property, animatedProperties) &&
          (property !== "all" ||
            rejectAllImportant ||
            animatedProperties.size > 0))
      ) {
        found = true;
      }
    });
    return found;
  } catch {
    const withoutComments = value.replace(/\/\*[\s\S]*?\*\//g, "");
    const normalized = decodeMotionCssIdentifier(withoutComments);
    return (
      /(?:^|;)\s*(?:-(?:webkit|moz|ms|o)-)?(?:animation|transition)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?\s*:/i.test(
        normalized,
      ) ||
      (animatedProperties.size > 0 && /!\s*important\b/i.test(normalized))
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

function htmlStyleTextMatchesSource(
  parsedText: string,
  sourceText: string,
): boolean {
  const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, "\n");
  return normalizeLineEndings(parsedText) === normalizeLineEndings(sourceText);
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
    if (
      !htmlStyleTextMatchesSource(textContent(node), css) ||
      hasCssTemplateInterpolation(css)
    ) {
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
    if (!htmlStyleTextMatchesSource(textContent(node), css)) {
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
  if (normalized.startsWith(":")) return normalized.slice(1).split(".", 1)[0]!;
  for (const prefix of ["x-bind:", "v-bind:"]) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length).split(".", 1)[0]!;
    }
  }
  if (normalized.startsWith("ng-attr-"))
    return normalized.slice("ng-attr-".length);
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
  value = "",
): boolean {
  if (!selectorAttribute) return false;
  const normalized = name.toLowerCase();
  return (
    ((normalized === "x-bind" || normalized === "v-bind") &&
      runtimeObjectBindingMayWriteAttribute(value, selectorAttribute)) ||
    dynamicBoundAttributeName(normalized) === selectorAttribute
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
  cleanupOnly = false,
): string {
  const { nodes } = parseHtml(source);
  const authored = readAuthoredHtmlMotion(
    source,
    nodes,
    sourceFilePath,
    cleanupOnly,
  );
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
    [
      ...(document?.tracks ?? []),
      ...motionNativeStylesToTracks(document?.nativeStyles ?? []),
    ],
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
  assertTargetsExist(source, targetNodeIds, undefined, true, true, [
    ...timeline.tracks,
    ...motionNativeStylesToTracks(timeline.nativeStyles ?? []),
  ]);

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
    assertTargetsExist(
      source,
      targetNodeIds,
      undefined,
      true,
      true,
      read.status === "valid"
        ? [
            ...(read.document?.tracks ?? []),
            ...motionNativeStylesToTracks(read.document?.nativeStyles ?? []),
          ]
        : [],
      true,
    );
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

  const withoutAuthored = removeAuthoredHtmlMotion(
    source,
    sourceFilePath,
    true,
  );
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
