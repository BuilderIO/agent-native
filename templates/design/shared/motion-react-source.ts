import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "@agent-native/core/shared/motion-source-node-id";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type * as TypeScript from "typescript";

import {
  compileMotionCode,
  decodeMotionCodeMetadata,
  type MotionAudioClip,
  type MotionCodeDocument,
} from "./motion-code";
import type { MotionEasingVariable } from "./motion-easing";
import {
  decodeMotionTextDocument,
  MOTION_TEXT_SOURCE_VERSION,
  type MotionTextAnimation,
  type MotionTextDocument,
} from "./motion-text-code";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  readTimelinePlaybackMode,
  type MotionPlaybackMode,
  type MotionTimeline,
} from "./motion-timeline";
import { ts } from "./motion-typescript-runtime";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const MANAGED_STYLE_ATTRIBUTE = "data-agent-native-motion";
const MOTION_TEXT_COMPONENT_MODULE = "@agent-native/core/client/motion-text";
const MOTION_TEXT_COMPONENT_EXPORT = "AgentNativeMotionText";

export type MotionReactSourceErrorCode =
  | "stale-source"
  | "stale-preview"
  | "invalid-jsx"
  | "ambiguous-node"
  | "missing-node"
  | "unsupported-root"
  | "ambiguous-managed-style"
  | "invalid-managed-style"
  | "unsupported-motion-document"
  | "unsupported-motion-text"
  | "invalid-motion-text";

export class MotionReactSourceError extends Error {
  constructor(
    readonly code: MotionReactSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MotionReactSourceError";
  }
}

export type MotionReactSourceWriteCapability =
  | {
      status: "supported";
      modulePath: string;
      moduleVersionHash: string;
      targetNodeIds: string[];
    }
  | {
      status: "unsupported";
      modulePath: string;
      moduleVersionHash: string;
      targetNodeIds: string[];
      code: MotionReactSourceErrorCode;
      reason: string;
    };

/** The source hash ties the editor's prepared edit to the live JSX snapshot. */
export interface MotionReactPreviewIdentitySnapshot {
  sourceHash: string;
}

export interface ApplyMotionReactSourceEditArgs {
  /** Current source read from the file being edited. */
  currentSource: string;
  /** Exact source snapshot used when the motion edit was prepared. */
  expectedSource: string;
  /** A DOM identity snapshot from the preview of this exact source version. */
  preview: MotionReactPreviewIdentitySnapshot;
  /** Project-relative module path stamped by the Vite dev transform. */
  modulePath?: string;
  timeline: MotionTimeline;
  textDocument?: MotionTextDocument | null;
  easingVariables?: readonly MotionEasingVariable[];
  audioClips?: readonly MotionAudioClip[];
}

export interface MotionReactSourceEdit {
  source: string;
  css: string;
  hash: string;
  targetNodeIds: string[];
}

export interface MotionReactSourceRemoval {
  source: string;
  changed: boolean;
}

export type MotionReactSourceReadResult =
  | { status: "absent" }
  | {
      status: "valid";
      css: string;
      document: MotionCodeDocument | null;
      textDocument: MotionTextDocument | null;
      playbackMode: MotionPlaybackMode;
      targetNodeIds: string[];
    }
  | { status: "invalid"; error: MotionReactSourceError };

interface ReactNodeTarget {
  nodeId: string;
  element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement;
  componentRoot: TypeScript.JsxElement | TypeScript.JsxFragment;
  needsAuthoredNodeId: boolean;
}

interface ManagedStyle {
  element: TypeScript.JsxElement;
  css: string;
  literal: TypeScript.StringLiteral;
}

interface ManagedTextAnimation {
  element: TypeScript.JsxElement;
  child: TypeScript.JsxElement;
  targetNodeId: string;
  animations: MotionTextAnimation[];
  attribute: TypeScript.JsxAttribute;
  attributeName: "animation" | "animations";
  playbackMode: MotionPlaybackMode | null;
  playbackModeAttribute?: TypeScript.JsxAttribute;
  componentName: string;
}

/**
 * Writes CSS and Text motion as static JSX source. JSX formatting outside the
 * inserted or replaced nodes is retained byte-for-byte; persistence still
 * uses the localhost bridge's compare-and-swap path.
 */
export function applyMotionReactSourceEdit(
  args: ApplyMotionReactSourceEditArgs,
): MotionReactSourceEdit {
  const { currentSource, expectedSource, preview, timeline } = args;
  if (currentSource !== expectedSource) {
    throw new MotionReactSourceError(
      "stale-source",
      "React source changed since the Motion edit was prepared. Re-read the file and retry.",
    );
  }
  if (
    preview.sourceHash !==
    bytesToHex(sha256(new TextEncoder().encode(currentSource)))
  ) {
    throw new MotionReactSourceError(
      "stale-preview",
      "The React preview identity snapshot does not match the current source. Refresh the preview and retry.",
    );
  }

  const textDocument = normalizeReactMotionTextDocument(
    args.textDocument ?? null,
  );
  const playbackMode = resolveMotionPlaybackMode(timeline);
  const targetNodeIds = [
    ...new Set([
      ...timeline.tracks.map((track) => track.targetNodeId),
      ...(timeline.nativeStyles ?? []).map((style) => style.targetNodeId),
      ...(textDocument?.animations.map((animation) => animation.targetNodeId) ??
        []),
    ]),
  ];
  const metadataOnlyWrite =
    targetNodeIds.length === 0 &&
    ((timeline.animationStyles?.length ?? 0) > 0 ||
      args.easingVariables !== undefined ||
      args.audioClips !== undefined);
  if (targetNodeIds.length === 0 && !metadataOnlyWrite) {
    throw new MotionReactSourceError(
      "unsupported-motion-document",
      "React Motion source writes require a CSS track, Text animation, or saved animation style library.",
    );
  }

  const sourceFile = parseTsx(currentSource);
  const targets =
    targetNodeIds.length > 0
      ? findTargets(
          sourceFile,
          targetNodeIds,
          args.modulePath ?? "motion-source.tsx",
        )
      : [];
  const managedStyles = findManagedStyles(sourceFile);
  if (managedStyles.length > 1) {
    throw new MotionReactSourceError(
      "ambiguous-managed-style",
      "React source contains more than one managed Motion style element.",
    );
  }
  let preservedAudioClips: MotionAudioClip[] | undefined;
  if (managedStyles.length === 1) {
    const managedStyle = managedStyles[0];
    const owningRoot = findComponentRoot(sourceFile, managedStyle.element);
    assertSupportedRoot(owningRoot);
    const targetRoots = new Set(targets.map((target) => target.componentRoot));
    if (!metadataOnlyWrite && !targetRoots.has(owningRoot)) {
      throw new MotionReactSourceError(
        "ambiguous-managed-style",
        "The managed Motion style element is outside the component that owns the target layers.",
      );
    }
    const metadata = decodeMotionCodeMetadata(managedStyle.css);
    if (metadata.status !== "valid") {
      throw new MotionReactSourceError(
        "invalid-managed-style",
        metadata.status === "invalid"
          ? metadata.error.message
          : "Managed React Motion CSS is missing its versioned source document.",
      );
    }
    preservedAudioClips = metadata.document.audioClips;
  }
  const audioClips = args.audioClips ?? preservedAudioClips;
  const compiled = compileMotionCode(timeline, {
    easingVariables: args.easingVariables,
    ...(audioClips !== undefined ? { audioClips } : {}),
  });
  const componentNames = findMotionTextComponentNames(sourceFile);
  const managedText = findManagedTextAnimations(sourceFile, componentNames);
  const managedTextByTarget = new Set<string>();
  for (const existing of managedText) {
    if (managedTextByTarget.has(existing.targetNodeId)) {
      throw new MotionReactSourceError(
        "ambiguous-node",
        `React source contains more than one Motion Text wrapper for target "${existing.targetNodeId}".`,
      );
    }
    managedTextByTarget.add(existing.targetNodeId);
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  if (managedStyles.length === 1) {
    const managedStyle = managedStyles[0];
    edits.push({
      start: managedStyle.literal.getStart(sourceFile),
      end: managedStyle.literal.end,
      text: JSON.stringify(compiled.css),
    });
  } else {
    let root: TypeScript.JsxElement | TypeScript.JsxFragment;
    if (metadataOnlyWrite) {
      if (args.audioClips === undefined) {
        throw new MotionReactSourceError(
          "unsupported-motion-document",
          "A React style-library-only write requires an existing managed Motion style element.",
        );
      }
      root = findDefaultExportComponentRoot(sourceFile);
    } else {
      root = targets[0].componentRoot;
    }
    assertSupportedRoot(root);
    const { start, offset, suffix } = rootInsertionPoint(currentSource, root);
    const style = `<style ${MANAGED_STYLE_ATTRIBUTE}>{${JSON.stringify(compiled.css)}}</style>`;
    edits.push({
      start,
      end: offset,
      text: `${currentSource.slice(start, offset)}${style}${suffix}`,
    });
  }

  const incomingText = new Map<string, MotionTextAnimation[]>();
  for (const animation of textDocument?.animations ?? []) {
    const targetAnimations = incomingText.get(animation.targetNodeId) ?? [];
    targetAnimations.push(animation);
    incomingText.set(animation.targetNodeId, targetAnimations);
  }
  for (const existing of managedText) {
    const next = incomingText.get(existing.targetNodeId);
    if (next) {
      const useArray =
        existing.attributeName === "animations" || next.length > 1;
      edits.push({
        start: existing.attribute.getStart(sourceFile),
        end: existing.attribute.end,
        text: `${useArray ? "animations" : "animation"}={${JSON.stringify(
          useArray ? next : next[0],
        )}}`,
      });
      if (existing.playbackModeAttribute?.initializer) {
        edits.push({
          start:
            existing.playbackModeAttribute.initializer.getStart(sourceFile),
          end: existing.playbackModeAttribute.initializer.end,
          text: JSON.stringify(playbackMode),
        });
      } else {
        edits.push({
          start: existing.element.openingElement.attributes.end,
          end: existing.element.openingElement.attributes.end,
          text: ` playbackMode=${JSON.stringify(playbackMode)}`,
        });
      }
      incomingText.delete(existing.targetNodeId);
    } else {
      edits.push({
        start: existing.element.getStart(sourceFile),
        end: existing.child.getStart(sourceFile),
        text: "",
      });
      edits.push({
        start: existing.child.end,
        end: existing.element.end,
        text: "",
      });
    }
  }

  let componentName = managedText[0]?.componentName;
  if (incomingText.size > 0 && !componentName) {
    const imported = ensureMotionTextComponentImport(sourceFile);
    componentName = imported.localName;
    if (imported.edit) edits.push(imported.edit);
  }
  if (incomingText.size > 0 && !componentName) {
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      "React Motion could not add the AgentNativeMotionText component import safely.",
    );
  }
  for (const [targetNodeId, animations] of incomingText) {
    const target = targets.find(
      (candidate) => candidate.nodeId === targetNodeId,
    );
    if (!target || !ts.isJsxElement(target.element)) {
      throw new MotionReactSourceError(
        "unsupported-motion-text",
        `Text animation target "${targetNodeId}" must be a JSX element with static text children.`,
      );
    }
    assertStaticMotionTextHost(sourceFile, target.element, targetNodeId);
    edits.push({
      start: target.element.getStart(sourceFile),
      end: target.element.getStart(sourceFile),
      text: `<${componentName} playbackMode=${JSON.stringify(playbackMode)} ${animations.length > 1 ? "animations" : "animation"}={${JSON.stringify(animations.length > 1 ? animations : animations[0])}}>`,
    });
    edits.push({
      start: target.element.end,
      end: target.element.end,
      text: `</${componentName}>`,
    });
  }

  for (const target of targets) {
    if (!target.needsAuthoredNodeId) continue;
    const opening = ts.isJsxElement(target.element)
      ? target.element.openingElement
      : target.element;
    edits.push({
      start: opening.attributes.end,
      end: opening.attributes.end,
      text: ` ${NODE_ID_ATTRIBUTE}=${JSON.stringify(target.nodeId)}`,
    });
  }
  const sourceWithEdits = applySourceEdits(currentSource, edits);
  const source =
    incomingText.size === 0 && managedText.length > 0
      ? removeUnusedMotionTextImport(sourceWithEdits)
      : sourceWithEdits;

  return {
    source,
    css: compiled.css,
    hash: compiled.hash,
    targetNodeIds,
  };
}

/** Reads managed React CSS and Text Motion without treating malformed data as absent. */
export function readMotionReactSource(
  source: string,
): MotionReactSourceReadResult {
  try {
    const sourceFile = parseTsx(source);
    const managedStyles = findManagedStyles(sourceFile);
    if (managedStyles.length > 1) {
      throw new MotionReactSourceError(
        "ambiguous-managed-style",
        "React source contains more than one managed Motion style element.",
      );
    }

    const css = managedStyles[0]?.css ?? "";
    const metadata = managedStyles[0]
      ? decodeMotionCodeMetadata(css)
      : { status: "absent" as const };
    if (metadata.status === "absent" && managedStyles.length > 0) {
      throw new MotionReactSourceError(
        "invalid-managed-style",
        "Managed React Motion CSS is missing its versioned source document.",
      );
    }
    if (metadata.status === "invalid") {
      throw new MotionReactSourceError(
        "invalid-managed-style",
        metadata.error.message,
      );
    }

    const componentNames = findMotionTextComponentNames(sourceFile);
    const managedText = findManagedTextAnimations(sourceFile, componentNames);
    const textDocument =
      managedText.length > 0
        ? normalizeReactMotionTextDocument({
            version: MOTION_TEXT_SOURCE_VERSION,
            animations: managedText.flatMap((entry) => entry.animations),
          })
        : null;
    const document = metadata.status === "valid" ? metadata.document : null;
    const documentPlaybackMode = document
      ? resolveMotionPlaybackMode(document)
      : null;
    const explicitTextPlaybackModes = new Set(
      managedText
        .map((entry) => entry.playbackMode)
        .filter((mode): mode is MotionPlaybackMode => mode !== null),
    );
    if (
      explicitTextPlaybackModes.size > 1 ||
      (documentPlaybackMode !== null &&
        [...explicitTextPlaybackModes].some(
          (mode) => mode !== documentPlaybackMode,
        ))
    ) {
      throw new MotionReactSourceError(
        "invalid-motion-text",
        "AgentNativeMotionText playbackMode must match the managed CSS Motion timeline.",
      );
    }
    const playbackMode =
      [...explicitTextPlaybackModes][0] ??
      documentPlaybackMode ??
      MOTION_DEFAULT_PLAYBACK_MODE;
    const targetNodeIds = [
      ...new Set([
        ...(document?.tracks.map((track) => track.targetNodeId) ?? []),
        ...(document?.nativeStyles?.map((style) => style.targetNodeId) ?? []),
        ...(textDocument?.animations.map(
          (animation) => animation.targetNodeId,
        ) ?? []),
      ]),
    ];
    findStaticTargets(sourceFile, targetNodeIds);
    if (!document && !textDocument) return { status: "absent" };
    return {
      status: "valid",
      css,
      document,
      textDocument,
      playbackMode,
      targetNodeIds,
    };
  } catch (error) {
    return {
      status: "invalid",
      error:
        error instanceof MotionReactSourceError
          ? error
          : new MotionReactSourceError(
              "invalid-jsx",
              error instanceof Error
                ? error.message
                : "React Motion source could not be read.",
            ),
    };
  }
}

export function inspectMotionReactSourceWriteCapability(args: {
  source: string;
  targetNodeIds: readonly string[];
  modulePath: string;
  moduleVersionHash: string;
}): MotionReactSourceWriteCapability {
  const read = readMotionReactSource(args.source);
  const nativeStyleTargetNodeIds =
    read.status === "valid"
      ? (read.document?.nativeStyles?.map((style) => style.targetNodeId) ?? [])
      : [];
  const targetNodeIds = [
    ...new Set([...args.targetNodeIds, ...nativeStyleTargetNodeIds]),
  ];
  const capabilityIdentity = {
    modulePath: args.modulePath,
    moduleVersionHash: args.moduleVersionHash,
    targetNodeIds,
  };
  try {
    if (read.status === "invalid") throw read.error;
    const sourceFile = parseTsx(args.source);
    if (targetNodeIds.length === 0) {
      const canEditMetadata =
        read.status === "valid" &&
        ((read.document?.animationStyles?.length ?? 0) > 0 ||
          read.document?.audioClips !== undefined);
      if (!canEditMetadata) {
        throw new MotionReactSourceError(
          "missing-node",
          "React Motion source capability requires a target, saved style library, or source-backed audio clip.",
        );
      }
      const managedStyles = findManagedStyles(sourceFile);
      if (managedStyles.length > 1) {
        throw new MotionReactSourceError(
          "invalid-managed-style",
          "React Motion metadata editing requires at most one managed Motion style element.",
        );
      }
      if (managedStyles.length === 1) {
        assertSupportedRoot(
          findComponentRoot(sourceFile, managedStyles[0].element),
        );
      } else if (
        read.status === "valid" &&
        read.document?.audioClips !== undefined
      ) {
        findDefaultExportComponentRoot(sourceFile);
      }
    } else {
      findTargets(sourceFile, targetNodeIds, args.modulePath);
    }
    return { status: "supported", ...capabilityIdentity };
  } catch (error) {
    if (!(error instanceof MotionReactSourceError)) throw error;
    return {
      status: "unsupported",
      ...capabilityIdentity,
      code: error.code,
      reason: error.message,
    };
  }
}

/** Removes only the valid managed Motion element; malformed markers fail closed. */
export function removeMotionReactSource(
  source: string,
): MotionReactSourceRemoval {
  const read = readMotionReactSource(source);
  if (read.status === "invalid") throw read.error;
  if (read.status === "absent") return { source, changed: false };

  const sourceFile = parseTsx(source);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const managedStyle of findManagedStyles(sourceFile)) {
    const start = managedStyle.element.getStart(sourceFile);
    const end = managedStyle.element.end;
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const leading = source.slice(lineStart, start);
    if (/^[\t ]*$/.test(leading)) {
      let tail = end;
      if (source.slice(tail, tail + 2) === "\r\n") tail += 2;
      else if (source[tail] === "\n") tail++;
      edits.push({ start: lineStart, end: tail, text: "" });
    } else {
      edits.push({ start, end, text: "" });
    }
  }
  const componentNames = findMotionTextComponentNames(sourceFile);
  for (const entry of findManagedTextAnimations(sourceFile, componentNames)) {
    edits.push({
      start: entry.element.getStart(sourceFile),
      end: entry.child.getStart(sourceFile),
      text: "",
    });
    edits.push({ start: entry.child.end, end: entry.element.end, text: "" });
  }
  const withoutMotion = applySourceEdits(source, edits);
  const clean = removeUnusedMotionTextImport(withoutMotion);
  return { source: clean, changed: clean !== source };
}

function parseTsx(source: string): TypeScript.SourceFile {
  const sourceFile = ts.createSourceFile(
    "design-motion.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parseDiagnostics = (
    sourceFile as TypeScript.SourceFile & {
      parseDiagnostics: readonly TypeScript.Diagnostic[];
    }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    const diagnostic = parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      " ",
    );
    throw new MotionReactSourceError(
      "invalid-jsx",
      `React source has a JSX parse error: ${message}`,
    );
  }
  return sourceFile;
}

function findTargets(
  sourceFile: TypeScript.SourceFile,
  targetNodeIds: string[],
  modulePath = "motion-source.tsx",
): ReactNodeTarget[] {
  return findStaticTargets(sourceFile, targetNodeIds, modulePath).map(
    (target) => ({
      ...target,
      componentRoot: findComponentRoot(sourceFile, target.element),
    }),
  );
}

function findStaticTargets(
  sourceFile: TypeScript.SourceFile,
  targetNodeIds: string[],
  modulePath = "motion-source.tsx",
): Array<Omit<ReactNodeTarget, "componentRoot">> {
  const elements = new Map<
    string,
    Array<{
      element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement;
      needsAuthoredNodeId: boolean;
    }>
  >();
  let hostElementOrdinal = 0;

  const visit = (node: TypeScript.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName;
      const isHostElement =
        ts.isIdentifier(tag) && isMotionSourceHostElementTag(tag.text);
      const ordinal = isHostElement ? hostElementOrdinal++ : -1;
      if (!isHostElement) {
        ts.forEachChild(node, visit);
        return;
      }
      const attributes = opening.attributes.properties;
      const hasSpread = attributes.some(ts.isJsxSpreadAttribute);
      const idAttributes = attributes.filter(
        (property): property is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          property.name.getText(sourceFile) === NODE_ID_ATTRIBUTE,
      );
      const hasStaticId =
        idAttributes.length === 1 &&
        !!idAttributes[0].initializer &&
        ts.isStringLiteral(idAttributes[0].initializer);
      if (!hasSpread && (idAttributes.length === 0 || hasStaticId)) {
        const nodeId = hasStaticId
          ? (idAttributes[0].initializer as TypeScript.StringLiteral).text
          : generatedMotionNodeId(modulePath, ordinal);
        const matches = elements.get(nodeId) ?? [];
        matches.push({ element: node, needsAuthoredNodeId: !hasStaticId });
        elements.set(nodeId, matches);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return targetNodeIds.map((nodeId) => {
    if (!/^[A-Za-z0-9_-]+$/.test(nodeId)) {
      throw new MotionReactSourceError(
        "ambiguous-node",
        `Motion target ID "${nodeId}" is not a safe authored JSX node ID.`,
      );
    }
    const matches = elements.get(nodeId) ?? [];
    if (matches.length === 0) {
      throw new MotionReactSourceError(
        "missing-node",
        `React source does not contain a static ${NODE_ID_ATTRIBUTE}="${nodeId}" target.`,
      );
    }
    if (matches.length !== 1) {
      throw new MotionReactSourceError(
        "ambiguous-node",
        `React source contains ${matches.length} elements with ${NODE_ID_ATTRIBUTE}="${nodeId}".`,
      );
    }
    const { element, needsAuthoredNodeId } = matches[0];
    return {
      nodeId,
      element,
      needsAuthoredNodeId,
    };
  });
}

function findComponentRoot(
  sourceFile: TypeScript.SourceFile,
  element: TypeScript.Node,
): TypeScript.JsxElement | TypeScript.JsxFragment {
  let owner:
    | TypeScript.FunctionDeclaration
    | TypeScript.FunctionExpression
    | TypeScript.ArrowFunction
    | null = null;
  for (
    let current: TypeScript.Node | undefined = element.parent;
    current;
    current = current.parent
  ) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      owner = current;
      break;
    }
  }
  if (!owner?.body) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Motion targets must belong to a React function component.",
    );
  }

  let expression: TypeScript.Expression | null = null;
  if (ts.isBlock(owner.body)) {
    const returns: TypeScript.ReturnStatement[] = [];
    const visit = (node: TypeScript.Node): void => {
      if (node !== owner.body && isFunctionBoundary(node)) return;
      if (ts.isReturnStatement(node)) returns.push(node);
      ts.forEachChild(node, visit);
    };
    visit(owner.body);

    if (returns.length === 1 && returns[0].expression) {
      expression = returns[0].expression;
    }
  } else if (ts.isArrowFunction(owner)) {
    expression = owner.body;
  }

  if (!expression) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Motion source writes require one unconditional JSX return in the target component.",
    );
  }
  while (ts.isParenthesizedExpression(expression))
    expression = expression.expression;
  if (!ts.isJsxElement(expression) && !ts.isJsxFragment(expression)) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Motion source writes require the component to return one JSX element or fragment.",
    );
  }
  if (
    element.getStart(sourceFile) < expression.getStart(sourceFile) ||
    element.end > expression.end
  ) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "The Motion target is not inside the component's returned JSX tree.",
    );
  }
  return expression;
}

function findDefaultExportComponentRoot(
  sourceFile: TypeScript.SourceFile,
): TypeScript.JsxElement | TypeScript.JsxFragment {
  const defaultStatements = sourceFile.statements.filter((statement) =>
    ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        )
      : false,
  );
  if (defaultStatements.length !== 1) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Audio-only React Motion source requires one default-exported component with a single JSX root.",
    );
  }

  const defaultStatement = defaultStatements[0];
  if (!defaultStatement) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Audio-only React Motion source requires one default-exported component with a single JSX root.",
    );
  }
  let owner:
    | TypeScript.FunctionDeclaration
    | TypeScript.FunctionExpression
    | TypeScript.ArrowFunction
    | null = null;
  if (ts.isFunctionDeclaration(defaultStatement)) {
    owner = defaultStatement;
  } else if (ts.isExportAssignment(defaultStatement)) {
    const expression = defaultStatement.expression;
    if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
      owner = expression;
    } else if (ts.isIdentifier(expression)) {
      const name = expression.text;
      const declaration = sourceFile.statements.find((statement) => {
        if (ts.isFunctionDeclaration(statement)) {
          return statement.name?.text === name;
        }
        if (!ts.isVariableStatement(statement)) return false;
        return statement.declarationList.declarations.some(
          (candidate) =>
            ts.isIdentifier(candidate.name) && candidate.name.text === name,
        );
      });
      if (declaration && ts.isFunctionDeclaration(declaration)) {
        owner = declaration;
      } else if (declaration && ts.isVariableStatement(declaration)) {
        const candidate = declaration.declarationList.declarations.find(
          (entry) => ts.isIdentifier(entry.name) && entry.name.text === name,
        );
        const initializer = candidate?.initializer;
        if (initializer && ts.isArrowFunction(initializer)) {
          owner = initializer;
        } else if (initializer && ts.isFunctionExpression(initializer)) {
          owner = initializer;
        }
      }
    }
  }
  if (!owner?.body) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Audio-only React Motion source requires a default-exported function component.",
    );
  }

  const returns: TypeScript.ReturnStatement[] = [];
  const findReturns = (node: TypeScript.Node): void => {
    if (node !== owner?.body && isFunctionBoundary(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, findReturns);
  };
  if (ts.isBlock(owner.body)) {
    findReturns(owner.body);
    const [singleReturn] = returns;
    if (returns.length !== 1 || !singleReturn?.expression) {
      throw new MotionReactSourceError(
        "unsupported-root",
        "Audio-only React Motion source requires one unconditional JSX return.",
      );
    }
  }
  const returnedExpression: TypeScript.Expression = ts.isBlock(owner.body)
    ? (returns[0]?.expression as TypeScript.Expression)
    : owner.body;
  if (!returnedExpression) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Audio-only React Motion source requires a JSX return value.",
    );
  }
  let jsxNode: TypeScript.Node | null = null;
  const findJsx = (node: TypeScript.Node): void => {
    if (jsxNode) return;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      jsxNode = node;
      return;
    }
    ts.forEachChild(node, findJsx);
  };
  findJsx(returnedExpression);
  if (!jsxNode) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Audio-only React Motion source requires a JSX element or fragment root.",
    );
  }
  const root = findComponentRoot(sourceFile, jsxNode);
  assertSupportedRoot(root);
  return root;
}

function isFunctionBoundary(node: TypeScript.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function findMotionTextComponentNames(
  sourceFile: TypeScript.SourceFile,
): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== MOTION_TEXT_COMPONENT_MODULE ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      if (specifier.isTypeOnly) continue;
      const exportedName = specifier.propertyName?.text ?? specifier.name.text;
      if (exportedName !== MOTION_TEXT_COMPONENT_EXPORT) continue;
      assertImportBindingUnshadowed(sourceFile, specifier.name.text, specifier);
      if (names.has(specifier.name.text)) {
        throw new MotionReactSourceError(
          "unsupported-motion-text",
          "React source imports AgentNativeMotionText more than once under the same local name.",
        );
      }
      names.add(specifier.name.text);
    }
  }
  return names;
}

function assertImportBindingUnshadowed(
  sourceFile: TypeScript.SourceFile,
  localName: string,
  imported: TypeScript.ImportSpecifier,
): void {
  let shadowed = false;
  const visit = (node: TypeScript.Node): void => {
    if (node !== imported && isDeclarationNamed(node, localName))
      shadowed = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (shadowed) {
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      `The imported Motion text component name "${localName}" is shadowed in this module.`,
    );
  }
}

function isDeclarationNamed(node: TypeScript.Node, name: string): boolean {
  let declarationName: TypeScript.Node | undefined;
  if (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isImportClause(node) ||
    ts.isImportSpecifier(node) ||
    ts.isNamespaceImport(node) ||
    ts.isBindingElement(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    declarationName = node.name;
  }
  return (
    !!declarationName &&
    ts.isIdentifier(declarationName) &&
    declarationName.text === name
  );
}

function findManagedTextAnimations(
  sourceFile: TypeScript.SourceFile,
  componentNames: ReadonlySet<string>,
): ManagedTextAnimation[] {
  const managed: ManagedTextAnimation[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      isMotionTextTag(node.tagName, componentNames)
    ) {
      throw new MotionReactSourceError(
        "unsupported-motion-text",
        "AgentNativeMotionText must wrap one static JSX text element.",
      );
    }
    if (
      ts.isJsxElement(node) &&
      isMotionTextTag(node.openingElement.tagName, componentNames)
    ) {
      const attributes = node.openingElement.attributes.properties;
      const animationAttributes = attributes.filter(
        (attribute): attribute is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(attribute) &&
          (attribute.name.getText(sourceFile) === "animation" ||
            attribute.name.getText(sourceFile) === "animations"),
      );
      const playbackModeAttributes = attributes.filter(
        (attribute): attribute is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "playbackMode",
      );
      if (
        attributes.length !==
          animationAttributes.length + playbackModeAttributes.length ||
        animationAttributes.length !== 1 ||
        playbackModeAttributes.length > 1 ||
        !animationAttributes[0].initializer ||
        !ts.isJsxExpression(animationAttributes[0].initializer) ||
        !animationAttributes[0].initializer.expression
      ) {
        throw new MotionReactSourceError(
          "invalid-motion-text",
          "AgentNativeMotionText requires one static animation or animations prop and at most one static playbackMode prop.",
        );
      }
      const attributeName = animationAttributes[0].name.getText(sourceFile);
      const animationValue = evaluateStaticExpression(
        animationAttributes[0].initializer.expression,
      );
      const animationValues =
        attributeName === "animation"
          ? [animationValue]
          : Array.isArray(animationValue)
            ? animationValue
            : null;
      if (!animationValues || animationValues.length === 0) {
        throw new MotionReactSourceError(
          "invalid-motion-text",
          "AgentNativeMotionText animations must be a non-empty static array.",
        );
      }
      const decoded = normalizeReactMotionTextDocument({
        version: MOTION_TEXT_SOURCE_VERSION,
        animations: animationValues,
      });
      const animations = decoded!.animations;
      const targetNodeId = animations[0]!.targetNodeId;
      if (
        animations.some((animation) => animation.targetNodeId !== targetNodeId)
      ) {
        throw new MotionReactSourceError(
          "invalid-motion-text",
          "One AgentNativeMotionText wrapper cannot target multiple nodes.",
        );
      }
      const playbackModeAttribute = attributes.find(
        (attribute): attribute is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "playbackMode",
      );
      const playbackMode = readManagedTextPlaybackMode(playbackModeAttribute);
      const child = findSoleStaticTextChild(sourceFile, node, targetNodeId);
      managed.push({
        element: node,
        child,
        targetNodeId,
        animations,
        attribute: animationAttributes[0],
        attributeName: attributeName as "animation" | "animations",
        playbackMode,
        ...(playbackModeAttribute ? { playbackModeAttribute } : {}),
        componentName: node.openingElement.tagName.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return managed;
}

function readManagedTextPlaybackMode(
  attribute: TypeScript.JsxAttribute | undefined,
): MotionPlaybackMode | null {
  if (!attribute) return null;
  if (
    !attribute.initializer ||
    !ts.isStringLiteral(attribute.initializer) ||
    !isMotionPlaybackMode(attribute.initializer.text)
  ) {
    throw new MotionReactSourceError(
      "invalid-motion-text",
      "AgentNativeMotionText playbackMode must be one static loop, once, or ping-pong value.",
    );
  }
  return attribute.initializer.text;
}

function isMotionPlaybackMode(value: string): value is MotionPlaybackMode {
  return value === "loop" || value === "once" || value === "ping-pong";
}

function resolveMotionPlaybackMode(
  timeline: Pick<MotionTimeline, "playbackMode" | "tracks">,
): MotionPlaybackMode {
  return (
    timeline.playbackMode ??
    readTimelinePlaybackMode(timeline.tracks) ??
    MOTION_DEFAULT_PLAYBACK_MODE
  );
}

function isMotionTextTag(
  tag: TypeScript.JsxTagNameExpression,
  names: ReadonlySet<string>,
): tag is TypeScript.Identifier {
  return ts.isIdentifier(tag) && names.has(tag.text);
}

function findSoleStaticTextChild(
  sourceFile: TypeScript.SourceFile,
  wrapper: TypeScript.JsxElement,
  targetNodeId: string,
): TypeScript.JsxElement {
  const childElements: TypeScript.JsxElement[] = [];
  for (const child of wrapper.children) {
    if (ts.isJsxElement(child)) {
      childElements.push(child);
      continue;
    }
    if (ts.isJsxText(child) && child.getText(sourceFile).trim() === "")
      continue;
    if (ts.isJsxExpression(child) && !child.expression) continue;
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      "AgentNativeMotionText must directly wrap one intrinsic element without dynamic children.",
    );
  }
  if (childElements.length !== 1) {
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      "AgentNativeMotionText must directly wrap one intrinsic element with static text.",
    );
  }
  const child = childElements[0];
  assertStaticMotionTextHost(sourceFile, child, targetNodeId);
  return child;
}

function assertStaticMotionTextHost(
  sourceFile: TypeScript.SourceFile,
  element: TypeScript.JsxElement,
  targetNodeId: string,
): void {
  const tag = element.openingElement.tagName;
  if (!ts.isIdentifier(tag) || !isMotionSourceHostElementTag(tag.text)) {
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      "Motion Text targets must be intrinsic HTML elements.",
    );
  }
  const attributes = element.openingElement.attributes.properties;
  const ids = attributes.filter(
    (attribute): attribute is TypeScript.JsxAttribute =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(sourceFile) === NODE_ID_ATTRIBUTE,
  );
  if (
    attributes.some(ts.isJsxSpreadAttribute) ||
    attributes.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        ["children", "dangerouslySetInnerHTML"].includes(
          attribute.name.getText(sourceFile),
        ),
    ) ||
    ids.length !== 1 ||
    !ids[0].initializer ||
    !ts.isStringLiteral(ids[0].initializer) ||
    ids[0].initializer.text !== targetNodeId
  ) {
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      `Motion Text target "${targetNodeId}" must have one static ${NODE_ID_ATTRIBUTE} and no spread or overridden children.`,
    );
  }
  let hasText = false;
  for (const child of element.children) {
    if (ts.isJsxText(child)) {
      if (child.getText(sourceFile).trim()) hasText = true;
      continue;
    }
    if (ts.isJsxExpression(child) && !child.expression) continue;
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      `Motion Text target "${targetNodeId}" has dynamic or nested JSX children; only static JSX text is supported.`,
    );
  }
  if (!hasText) {
    throw new MotionReactSourceError(
      "unsupported-motion-text",
      `Motion Text target "${targetNodeId}" does not contain static JSX text.`,
    );
  }
}

function normalizeReactMotionTextDocument(
  value: unknown,
): MotionTextDocument | null {
  if (value === null) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new MotionReactSourceError(
      "invalid-motion-text",
      "React Motion Text source must be serializable as static JSON.",
    );
  }
  if (typeof serialized !== "string") {
    throw new MotionReactSourceError(
      "invalid-motion-text",
      "React Motion Text source must be serializable as static JSON.",
    );
  }
  const result = decodeMotionTextDocument(serialized);
  if (result.status === "invalid") {
    throw new MotionReactSourceError(
      "invalid-motion-text",
      result.error.message,
    );
  }
  if (result.status === "absent") {
    throw new MotionReactSourceError(
      "invalid-motion-text",
      "React Motion Text source must contain a document.",
    );
  }
  return result.document;
}

function evaluateStaticExpression(node: TypeScript.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element)) {
        throw new MotionReactSourceError(
          "invalid-motion-text",
          "React Motion Text animation arrays cannot contain spreads.",
        );
      }
      return evaluateStaticExpression(element);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value = Object.create(null) as Record<string, unknown>;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new MotionReactSourceError(
          "invalid-motion-text",
          "React Motion Text animation objects must use static property assignments.",
        );
      }
      const name = property.name;
      const key =
        ts.isIdentifier(name) ||
        ts.isStringLiteral(name) ||
        ts.isNumericLiteral(name)
          ? name.text
          : null;
      if (key === null || Object.prototype.hasOwnProperty.call(value, key)) {
        throw new MotionReactSourceError(
          "invalid-motion-text",
          "React Motion Text animation object keys must be unique static names.",
        );
      }
      value[key] = evaluateStaticExpression(property.initializer);
    }
    return value;
  }
  throw new MotionReactSourceError(
    "invalid-motion-text",
    "React Motion Text animation values must be static JSON literals; expressions are not supported.",
  );
}

function ensureMotionTextComponentImport(sourceFile: TypeScript.SourceFile): {
  localName: string;
  edit?: { start: number; end: number; text: string };
} {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== MOTION_TEXT_COMPONENT_MODULE ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const named = statement.importClause.namedBindings;
    const specifier = named.elements.find(
      (entry) =>
        !entry.isTypeOnly &&
        (entry.propertyName?.text ?? entry.name.text) ===
          MOTION_TEXT_COMPONENT_EXPORT,
    );
    if (specifier) return { localName: specifier.name.text };
    const localName = uniqueMotionTextComponentName(sourceFile);
    const namedText = named.getText(sourceFile);
    const closeBrace = namedText.lastIndexOf("}");
    if (closeBrace === -1) break;
    const beforeClose = namedText.slice(0, closeBrace);
    const trailingWhitespace = /\s*$/.exec(beforeClose)?.[0] ?? "";
    const contentEnd = beforeClose.length - trailingWhitespace.length;
    const hasTrailingComma = beforeClose.slice(0, contentEnd).endsWith(",");
    const insertAt = named.getStart(sourceFile) + contentEnd;
    const separator =
      named.elements.length === 0 ? "" : hasTrailingComma ? " " : ", ";
    return {
      localName,
      edit: {
        start: insertAt,
        end: insertAt,
        text: `${separator}${MOTION_TEXT_COMPONENT_EXPORT} as ${localName}`,
      },
    };
  }

  const localName = uniqueMotionTextComponentName(sourceFile);
  const importText = `import { ${MOTION_TEXT_COMPONENT_EXPORT} as ${localName} } from ${JSON.stringify(MOTION_TEXT_COMPONENT_MODULE)};`;
  const importEnd = sourceFile.statements.reduce(
    (end, statement) =>
      ts.isImportDeclaration(statement) ? statement.end : end,
    0,
  );
  const insertion = importEnd > 0 ? importEnd : directiveEnd(sourceFile);
  return {
    localName,
    edit: {
      start: insertion,
      end: insertion,
      text: `${insertion > 0 ? "\n" : ""}${importText}\n`,
    },
  };
}

function uniqueMotionTextComponentName(
  sourceFile: TypeScript.SourceFile,
): string {
  const identifiers = new Set<string>();
  const visit = (node: TypeScript.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  let name = "AgentNativeMotionTextForMotion";
  let suffix = 2;
  while (identifiers.has(name))
    name = `AgentNativeMotionTextForMotion${suffix++}`;
  return name;
}

function directiveEnd(sourceFile: TypeScript.SourceFile): number {
  let end = 0;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    end = statement.end;
  }
  return end;
}

function removeUnusedMotionTextImport(source: string): string {
  const sourceFile = parseTsx(source);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== MOTION_TEXT_COMPONENT_MODULE ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const named = statement.importClause.namedBindings;
    const specifiers = named.elements.filter(
      (entry) =>
        (entry.propertyName?.text ?? entry.name.text) ===
        MOTION_TEXT_COMPONENT_EXPORT,
    );
    for (const specifier of specifiers) {
      const used = containsIdentifierReference(sourceFile, specifier);
      if (used) continue;
      if (named.elements.length === 1 && !statement.importClause.name) {
        const lineStart =
          source.lastIndexOf("\n", statement.getStart(sourceFile) - 1) + 1;
        let end = statement.end;
        if (source.slice(end, end + 2) === "\r\n") end += 2;
        else if (source[end] === "\n") end++;
        edits.push({ start: lineStart, end, text: "" });
      } else if (named.elements.length > 1) {
        const index = named.elements.indexOf(specifier);
        const next = named.elements[index + 1];
        if (next) {
          edits.push({
            start: specifier.getStart(sourceFile),
            end: next.getStart(sourceFile),
            text: "",
          });
        } else {
          const previous = named.elements[index - 1];
          edits.push({
            start: previous.end,
            end: specifier.end,
            text: "",
          });
        }
      } else if (statement.importClause.name) {
        const clause = statement.importClause;
        const defaultName = clause.name;
        if (defaultName) {
          edits.push({ start: defaultName.end, end: named.end, text: "" });
        }
      }
    }
  }
  return applySourceEdits(source, edits);
}

function containsIdentifierReference(
  sourceFile: TypeScript.SourceFile,
  imported: TypeScript.ImportSpecifier,
): boolean {
  const name = imported.name.text;
  let found = false;
  const visit = (node: TypeScript.Node): void => {
    let insideImport = false;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent)) {
        insideImport = true;
        break;
      }
    }
    if (!insideImport && ts.isIdentifier(node) && node.text === name) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function findManagedStyles(sourceFile: TypeScript.SourceFile): ManagedStyle[] {
  const managed: ManagedStyle[] = [];
  const invalidMarker: TypeScript.Node[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = jsxAttributes(node).filter(
        (property): property is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          property.name.getText(sourceFile) === MANAGED_STYLE_ATTRIBUTE,
      );
      if (attributes.length > 0) {
        if (
          !ts.isJsxElement(node) ||
          node.openingElement.tagName.getText(sourceFile) !== "style" ||
          attributes.length !== 1 ||
          attributes[0].initializer
        ) {
          invalidMarker.push(node);
        } else {
          const expressions = node.children.filter(
            (child): child is TypeScript.JsxExpression =>
              ts.isJsxExpression(child) && !!child.expression,
          );
          const otherContent = node.children.filter(
            (child) =>
              !ts.isJsxExpression(child) &&
              (!ts.isJsxText(child) || child.getText(sourceFile).trim() !== ""),
          );
          if (
            expressions.length !== 1 ||
            !ts.isStringLiteral(expressions[0].expression!) ||
            otherContent.length > 0
          ) {
            invalidMarker.push(node);
          } else {
            const literal = expressions[0]
              .expression as TypeScript.StringLiteral;
            managed.push({
              element: node,
              css: literal.text,
              literal,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (invalidMarker.length > 0) {
    throw new MotionReactSourceError(
      "invalid-managed-style",
      "React source contains a malformed managed Motion style element.",
    );
  }
  return managed;
}

function jsxAttributes(
  node: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement,
): readonly TypeScript.JsxAttributeLike[] {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes.properties
    : node.attributes.properties;
}

function applySourceEdits(
  source: string,
  edits: Array<{ start: number; end: number; text: string }>,
): string {
  let result = source;
  const sorted = edits
    .map((edit, index) => ({ ...edit, index }))
    .sort(
      (left, right) =>
        right.start - left.start ||
        right.end - left.end ||
        right.index - left.index,
    );
  for (const edit of sorted) {
    result = replaceRange(result, edit.start, edit.end, edit.text);
  }
  return result;
}

function assertSupportedRoot(
  root: TypeScript.JsxElement | TypeScript.JsxFragment,
): void {
  if (ts.isJsxFragment(root)) return;
  const tag = root.openingElement.tagName;
  if (
    !ts.isIdentifier(tag) ||
    !/^(div|main|section|article|header|footer|aside|nav|body)$/.test(tag.text)
  ) {
    throw new MotionReactSourceError(
      "unsupported-root",
      "Motion source writes can only add a managed style to a fragment or a supported intrinsic HTML container.",
    );
  }
}

function rootInsertionPoint(
  source: string,
  root: TypeScript.JsxElement | TypeScript.JsxFragment,
): { start: number; offset: number; suffix: string } {
  const openingEnd = ts.isJsxFragment(root)
    ? root.openingFragment.end
    : root.openingElement.end;
  const lineBreak = /^(\r\n|\n)[\t ]*/.exec(source.slice(openingEnd));
  if (!lineBreak) {
    return { start: openingEnd, offset: openingEnd, suffix: "" };
  }
  return {
    start: openingEnd,
    offset: openingEnd + lineBreak[0].length,
    suffix: lineBreak[1] + lineBreak[0].slice(lineBreak[1].length),
  };
}

function replaceRange(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return source.slice(0, start) + replacement + source.slice(end);
}
