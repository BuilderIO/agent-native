import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "@agent-native/core/shared/motion-source-node-id";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type * as TypeScript from "typescript";

import {
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
  | "unsupported-authored-motion"
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

interface AuthoredReactMotion {
  document: MotionCodeDocument | null;
  rangesToRemove: MotionAuthoredCssSourceRange[];
}

interface ReactAuthoredHost {
  element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement;
  ordinal: number;
  tagName: string;
  isInsideConditionalOrMappedExpression: boolean;
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

  const currentRead = readMotionReactSource(currentSource, args.modulePath);
  if (currentRead.status === "invalid") throw currentRead.error;

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

  const originalSourceFile = parseTsx(currentSource);
  const managedStyles = findManagedStyles(originalSourceFile);
  const authoredMotion = readAuthoredReactMotion(
    originalSourceFile,
    args.modulePath,
    managedStyles,
    targetNodeIds,
  );
  const sourceAfterAdoption = removeAuthoredCssSourceRanges(
    currentSource,
    authoredMotion.rangesToRemove,
  );
  const sourceFile =
    sourceAfterAdoption === currentSource
      ? originalSourceFile
      : parseTsx(sourceAfterAdoption);
  const targets =
    targetNodeIds.length > 0
      ? findTargets(
          sourceFile,
          targetNodeIds,
          args.modulePath ?? "motion-source.tsx",
        )
      : [];
  const editableManagedStyles = findManagedStyles(sourceFile);
  if (editableManagedStyles.length > 1) {
    throw new MotionReactSourceError(
      "ambiguous-managed-style",
      "React source contains more than one managed Motion style element.",
    );
  }
  let preservedAudioClips: MotionAudioClip[] | undefined;
  if (editableManagedStyles.length === 1) {
    const managedStyle = editableManagedStyles[0];
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
    try {
      reconcileMotionCodeDocument(managedStyle.css, metadata.document);
    } catch (error) {
      throw new MotionReactSourceError(
        "invalid-managed-style",
        error instanceof Error
          ? error.message
          : "Managed React Motion CSS cannot be read safely.",
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
  if (editableManagedStyles.length === 1) {
    const managedStyle = editableManagedStyles[0];
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
    const { start, offset, suffix } = rootInsertionPoint(
      sourceAfterAdoption,
      root,
    );
    const style = `<style ${MANAGED_STYLE_ATTRIBUTE}>{${JSON.stringify(compiled.css)}}</style>`;
    edits.push({
      start,
      end: offset,
      text: `${sourceAfterAdoption.slice(start, offset)}${style}${suffix}`,
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
  const sourceWithEdits = applySourceEdits(sourceAfterAdoption, edits);
  const output =
    incomingText.size === 0 && managedText.length > 0
      ? removeUnusedMotionTextImport(sourceWithEdits)
      : sourceWithEdits;

  return {
    source: output,
    css: compiled.css,
    hash: compiled.hash,
    targetNodeIds,
  };
}

/** Reads managed React CSS and Text Motion without treating malformed data as absent. */
export function readMotionReactSource(
  source: string,
  modulePath?: string,
): MotionReactSourceReadResult {
  return readMotionReactSourceInternal(source, modulePath);
}

function readMotionReactSourceInternal(
  source: string,
  modulePath: string | undefined,
  options: { allowUnsupportedRuntimeCallbacks?: boolean } = {},
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
    let document: MotionCodeDocument | null = null;
    if (metadata.status === "valid") {
      try {
        document = reconcileMotionCodeDocument(css, metadata.document);
      } catch (error) {
        throw new MotionReactSourceError(
          "invalid-managed-style",
          error instanceof Error
            ? error.message
            : "Managed React Motion CSS could not be read safely.",
        );
      }
    }
    const managedTargetNodeIds = [
      ...(document?.tracks.map((track) => track.targetNodeId) ?? []),
      ...(document?.nativeStyles?.map((style) => style.targetNodeId) ?? []),
      ...(textDocument?.animations.map((animation) => animation.targetNodeId) ??
        []),
    ];
    const authoredMotion = readAuthoredReactMotion(
      sourceFile,
      modulePath,
      managedStyles,
      managedTargetNodeIds,
      {
        allowManagedMotionWithUnresolvedStylesheets: true,
        allowUnsupportedRuntimeCallbacks:
          options.allowUnsupportedRuntimeCallbacks,
      },
    );
    if (authoredMotion.document) {
      try {
        document = mergeAuthoredCssMotionDocument(
          document,
          authoredMotion.document,
        );
      } catch (error) {
        throw new MotionReactSourceError(
          "unsupported-authored-motion",
          error instanceof Error
            ? error.message
            : "Inline CSS animations cannot share one Motion timeline.",
        );
      }
    }
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
    findStaticTargets(sourceFile, targetNodeIds, modulePath);
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
  const read = readMotionReactSource(args.source, args.modulePath);
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
    if (targetNodeIds.length > 0 && hasUnresolvedReactStylesheet(sourceFile)) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        "Resolve external stylesheets before editing or adding Motion.",
      );
    }
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
      const targets = findTargets(sourceFile, targetNodeIds, args.modulePath);
      assertNoUnsupportedReactStylePropAnimations(
        sourceFile,
        targetNodeIds,
        args.modulePath,
      );
      const targetRoots = new Set(
        targets.map((target) => target.componentRoot),
      );
      if (targetRoots.size !== 1) {
        throw new MotionReactSourceError(
          "unsupported-root",
          "React Motion source targets must belong to one component root.",
        );
      }

      const managedStyles = findManagedStyles(sourceFile);
      if (managedStyles.length > 1) {
        throw new MotionReactSourceError(
          "ambiguous-managed-style",
          "React source contains more than one managed Motion style element.",
        );
      }
      if (managedStyles.length === 1) {
        const owningRoot = findComponentRoot(
          sourceFile,
          managedStyles[0]!.element,
        );
        assertSupportedRoot(owningRoot);
        if (!targetRoots.has(owningRoot)) {
          throw new MotionReactSourceError(
            "ambiguous-managed-style",
            "The managed Motion style element is outside the component that owns the target layers.",
          );
        }
      } else {
        assertSupportedRoot(targets[0]!.componentRoot);
      }
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
  modulePath?: string,
): MotionReactSourceRemoval {
  const read = readMotionReactSourceInternal(source, modulePath, {
    allowUnsupportedRuntimeCallbacks: true,
  });
  if (read.status === "invalid") throw read.error;
  if (read.status === "absent") return { source, changed: false };

  const originalSourceFile = parseTsx(source);
  const authoredMotion = readAuthoredReactMotion(
    originalSourceFile,
    modulePath,
    findManagedStyles(originalSourceFile),
    read.status === "valid" ? read.targetNodeIds : [],
    {
      allowManagedMotionWithUnresolvedStylesheets: true,
      allowUnsupportedRuntimeCallbacks: true,
    },
  );
  const withoutAuthored = removeAuthoredCssSourceRanges(
    source,
    authoredMotion.rangesToRemove,
  );
  const sourceFile = parseTsx(withoutAuthored);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const managedStyle of findManagedStyles(sourceFile)) {
    const start = managedStyle.element.getStart(sourceFile);
    const end = managedStyle.element.end;
    const lineStart = withoutAuthored.lastIndexOf("\n", start - 1) + 1;
    const leading = withoutAuthored.slice(lineStart, start);
    if (/^[\t ]*$/.test(leading)) {
      let tail = end;
      if (withoutAuthored.slice(tail, tail + 2) === "\r\n") tail += 2;
      else if (withoutAuthored[tail] === "\n") tail++;
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
  const withoutMotion = applySourceEdits(withoutAuthored, edits);
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

function readAuthoredReactMotion(
  sourceFile: TypeScript.SourceFile,
  modulePath: string | undefined,
  managedStyles: readonly ManagedStyle[],
  managedTargetNodeIds: readonly string[] = [],
  options: {
    allowManagedMotionWithUnresolvedStylesheets?: boolean;
    allowUnsupportedRuntimeCallbacks?: boolean;
  } = {},
): AuthoredReactMotion {
  if (
    !options.allowManagedMotionWithUnresolvedStylesheets &&
    managedTargetNodeIds.length > 0 &&
    hasUnresolvedReactStylesheet(sourceFile)
  ) {
    throw new MotionReactSourceError(
      "unsupported-authored-motion",
      "Resolve external stylesheets before editing or adding Motion.",
    );
  }

  const managedElements = new Set(managedStyles.map((style) => style.element));
  const authoredStyles: TypeScript.JsxElement[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isJsxElement(node) &&
      ts.isIdentifier(node.openingElement.tagName) &&
      node.openingElement.tagName.text === "style" &&
      !managedElements.has(node)
    ) {
      authoredStyles.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const hosts = findReactAuthoredHosts(sourceFile);
  const transitionCssBlocks = authoredStyles.flatMap((style) => {
    const content = readStaticReactStyleContent(sourceFile, style);
    return content ? [content.css] : [];
  });
  const tracks: NonNullable<MotionCodeDocument["tracks"]> = [];
  const rangesToRemove: MotionAuthoredCssSourceRange[] = [];
  const importedTargetNodeIds = new Set<string>();
  const usedKeyframeNames = new Set<string>();
  const keyframeNameCounts = new Map<string, number>();
  let durationMs = 1;

  for (const style of authoredStyles) {
    const content = readStaticReactStyleContent(sourceFile, style);
    if (!content) {
      const start = style.openingElement.end;
      const end = style.closingElement.getStart(sourceFile);
      const raw = sourceFile.text.slice(start, end);
      if (raw.trim().length > 0) {
        throw new MotionReactSourceError(
          "unsupported-authored-motion",
          "A React inline style element cannot be inspected because its JSX source is not one lossless static CSS string.",
        );
      }
      continue;
    }

    const result = importAuthoredCssAnimations(
      content.css,
      (selector) => {
        let styleRoot: TypeScript.JsxElement | TypeScript.JsxFragment;
        try {
          styleRoot = findComponentRoot(sourceFile, style);
        } catch (error) {
          return {
            status: "unsupported",
            reason:
              error instanceof Error
                ? error.message
                : "React inline style animations must belong to one static component root.",
          };
        }
        return resolveAuthoredReactTarget(
          selector,
          hosts,
          modulePath,
          sourceFile,
          styleRoot,
        );
      },
      { transitionCssBlocks },
    );
    if (result.status === "absent") {
      for (const name of result.definedKeyframeNames) {
        keyframeNameCounts.set(name, (keyframeNameCounts.get(name) ?? 0) + 1);
      }
      continue;
    }
    if (result.status === "unsupported") {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        result.reason,
      );
    }
    if (hasUnresolvedReactStylesheet(sourceFile)) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        "Inline CSS animations cannot be imported while stylesheet dependencies remain unresolved.",
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
        throw new MotionReactSourceError(
          "unsupported-authored-motion",
          `Motion target "${targetNodeId}" has animation rules in multiple inline style blocks, so CSS cascade order cannot be preserved.`,
        );
      }
      importedTargetNodeIds.add(targetNodeId);
    }
    assertSupportedAuthoredReactStyle(sourceFile, style);
    tracks.push(...result.tracks);
    durationMs = Math.max(durationMs, result.durationMs);
    rangesToRemove.push(
      ...result.rangesToRemove.map((range) => ({
        ...range,
        start: range.start + content.start,
        end: range.end + content.start,
      })),
    );
  }

  if (!options.allowUnsupportedRuntimeCallbacks) {
    assertNoUnsupportedReactStylePropAnimations(
      sourceFile,
      [...managedTargetNodeIds, ...importedTargetNodeIds],
      modulePath,
    );
  }
  if (tracks.length === 0) return { document: null, rangesToRemove: [] };
  for (const name of usedKeyframeNames) {
    if ((keyframeNameCounts.get(name) ?? 0) > 1) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        `Animation "${name}" has duplicate @keyframes definitions across inline style blocks.`,
      );
    }
  }
  try {
    return {
      document: mergeAuthoredCssMotionDocument(null, {
        tracks,
        durationMs,
        defaultEase: "ease",
      }),
      rangesToRemove,
    };
  } catch (error) {
    throw new MotionReactSourceError(
      "unsupported-authored-motion",
      error instanceof Error
        ? error.message
        : "Inline CSS animations cannot be represented by one Motion timeline.",
    );
  }
}

function hasImportedStylesheet(sourceFile: TypeScript.SourceFile): boolean {
  let found = false;
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      isCssModuleSpecifier(node.moduleSpecifier)
    ) {
      found = true;
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      isCssModuleSpecifier(node.moduleSpecifier)
    ) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isImportMetaGlob =
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isMetaProperty(node.expression.expression) &&
        node.expression.expression.keywordToken ===
          ts.SyntaxKind.ImportKeyword &&
        node.expression.expression.name.text === "meta" &&
        ["glob", "globEager"].includes(node.expression.name.text);
      if (
        (isRequire || isDynamicImport) &&
        isPotentialCssModuleSpecifier(node.arguments[0]!)
      ) {
        found = true;
        return;
      }
      if (isImportMetaGlob && isPotentialCssGlobPattern(node.arguments[0]!)) {
        found = true;
        return;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function hasUnresolvedReactStylesheet(
  sourceFile: TypeScript.SourceFile,
): boolean {
  return (
    hasImportedStylesheet(sourceFile) || hasLinkedReactStylesheet(sourceFile)
  );
}

function isPotentialCssGlobPattern(node: TypeScript.Expression): boolean {
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some(isPotentialCssGlobPattern);
  }
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
    return true;
  }

  const pattern = node.text;
  if (/\.(?:css|scss|sass|less|styl)(?:$|[?#*{}])/i.test(pattern)) {
    return true;
  }
  const extensionList = pattern.match(/\.\{([^}]+)\}(?:[?#].*)?$/);
  if (extensionList) {
    return extensionList[1]!
      .split(",")
      .some((extension) => /^(?:css|scss|sass|less|styl)$/i.test(extension));
  }
  return !/\.[a-z0-9]+(?:[?#].*)?$/i.test(pattern);
}

function hasLinkedReactStylesheet(sourceFile: TypeScript.SourceFile): boolean {
  let found = false;
  const visit = (node: TypeScript.Node): void => {
    if (found) return;
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (
      opening &&
      ts.isIdentifier(opening.tagName) &&
      opening.tagName.text === "link"
    ) {
      const properties = opening.attributes.properties;
      const attributes = new Map<string, TypeScript.JsxAttribute>();
      let hasSpread = false;
      for (const property of properties) {
        if (ts.isJsxSpreadAttribute(property)) {
          hasSpread = true;
        } else {
          attributes.set(
            property.name.getText(sourceFile).toLowerCase(),
            property,
          );
        }
      }
      const relAttribute = attributes.get("rel");
      const hrefAttribute = attributes.get("href");
      const rel = relAttribute
        ? readStaticJsxAttributeValue(relAttribute)
        : null;
      const relationTokens =
        rel?.status === "static"
          ? rel.value.split(/[\t\n\f\r ]+/).map((value) => value.toLowerCase())
          : [];
      const href = hrefAttribute
        ? readStaticJsxAttributeValue(hrefAttribute)
        : null;
      const asAttribute = attributes.get("as");
      const as = asAttribute ? readStaticJsxAttributeValue(asAttribute) : null;
      const hasHref =
        href?.status === "dynamic" ||
        (href?.status === "static" && href.value.trim().length > 0);
      const relMayBeStylesheet =
        rel?.status === "dynamic" && hrefAttribute !== undefined;
      const preloadMayBecomeStylesheet =
        relationTokens.includes("preload") &&
        (as?.status === "dynamic" ||
          (as?.status === "static" && as.value.toLowerCase() === "style")) &&
        attributes.has("onload");
      found =
        hasSpread ||
        (hasHref &&
          (relationTokens.includes("stylesheet") ||
            relMayBeStylesheet ||
            preloadMayBecomeStylesheet));
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isPotentialCssModuleSpecifier(node: TypeScript.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return isCssModuleSpecifier(node);
  }
  return true;
}

function isCssModuleSpecifier(node: TypeScript.Expression): boolean {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
    return false;
  }
  return /\.(?:css|scss|sass|less|styl)(?:[?#].*)?$/i.test(node.text);
}

function assertNoUnsupportedReactStylePropAnimations(
  sourceFile: TypeScript.SourceFile,
  targetNodeIds: readonly string[],
  modulePath: string | undefined,
): void {
  const targets =
    targetNodeIds.length > 0
      ? findStaticTargets(sourceFile, [...new Set(targetNodeIds)], modulePath)
      : [];
  const targetElements = new Set(targets.map((target) => target.element));
  const capturedMotionRefNames = new Set<string>();
  for (const target of targets) {
    const attributes = ts.isJsxElement(target.element)
      ? target.element.openingElement.attributes
      : target.element.attributes;
    for (const property of attributes.properties) {
      if (
        !ts.isJsxAttribute(property) ||
        property.name.getText(sourceFile) !== "ref" ||
        !property.initializer ||
        !ts.isJsxExpression(property.initializer) ||
        !property.initializer.expression
      ) {
        continue;
      }
      for (const name of collectReactCapturedRefNames(
        property.initializer.expression,
        sourceFile,
        new Set(),
      )) {
        capturedMotionRefNames.add(name);
      }
    }
  }
  const targetRoots = new Set(
    targets.map((target) => findComponentRoot(sourceFile, target.element)),
  );
  const isWithinTargetRoot = (node: TypeScript.Node): boolean => {
    for (
      let current: TypeScript.Node | undefined = node;
      current;
      current = current.parent
    ) {
      if (
        targetRoots.has(
          current as TypeScript.JsxElement | TypeScript.JsxFragment,
        )
      ) {
        return true;
      }
    }
    return false;
  };
  const componentFunctions = new Set<
    | TypeScript.FunctionDeclaration
    | TypeScript.FunctionExpression
    | TypeScript.ArrowFunction
    | TypeScript.MethodDeclaration
  >();
  for (const root of targetRoots) {
    for (
      let current: TypeScript.Node | undefined = root.parent;
      current;
      current = current.parent
    ) {
      if (isFunctionBoundary(current)) {
        if (
          ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current)
        ) {
          componentFunctions.add(current);
        }
        break;
      }
    }
  }
  for (const component of componentFunctions) {
    if (!component.body) continue;
    const inspectLifecycleEffects = (node: TypeScript.Node): void => {
      if (node !== component.body && isFunctionBoundary(node)) return;
      if (
        ts.isCallExpression(node) &&
        isReactLifecycleEffectCall(node, sourceFile)
      ) {
        const callback = node.arguments[0];
        const inspection = callback
          ? inspectReactStyleMutationCallback(
              callback,
              sourceFile,
              new Set(),
              false,
              capturedMotionRefNames,
              true,
            )
          : "unknown";
        if (inspection !== "safe") {
          throw new MotionReactSourceError(
            "unsupported-authored-motion",
            "React effect callbacks in a Motion component can access or mutate target styles and cannot be proven safe.",
          );
        }
        return;
      }
      ts.forEachChild(node, inspectLifecycleEffects);
    };
    inspectLifecycleEffects(component.body);
  }
  for (const root of targetRoots) {
    const visitRoot = (node: TypeScript.Node): void => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(sourceFile) === "dangerouslySetInnerHTML"
      ) {
        throw new MotionReactSourceError(
          "unsupported-authored-motion",
          "React dangerouslySetInnerHTML in a Motion component can hide CSS from source inspection.",
        );
      }
      ts.forEachChild(node, visitRoot);
    };
    visitRoot(root);
  }
  const visit = (node: TypeScript.Node): void => {
    if (ts.isJsxSpreadAttribute(node)) {
      const opening = node.parent.parent;
      const host = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
      const isRelevantTargetProp =
        targetElements.has(host) || isWithinTargetRoot(host);
      if (isRelevantTargetProp) {
        const inspection = inspectReactJsxSpreadExpression(
          node.expression,
          sourceFile,
          new Set(),
          capturedMotionRefNames,
        );
        if (inspection !== "safe") {
          throw new MotionReactSourceError(
            "unsupported-authored-motion",
            "React JSX spread props in a Motion component can supply style declarations or callbacks that mutate target styles and cannot be proven safe.",
          );
        }
      }
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      const initializer = node.initializer;
      const attributes = node.parent;
      const opening = attributes.parent;
      const host = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
      const isRelevantTargetProp =
        targetElements.has(host) ||
        (attributeName !== "style" && isWithinTargetRoot(host));
      const expression =
        initializer && ts.isJsxExpression(initializer) && initializer.expression
          ? initializer.expression
          : null;

      if (!["style", "css", "sx"].includes(attributeName)) {
        if (
          isRelevantTargetProp &&
          (attributeName === "ref" || /^on[A-Za-z]/.test(attributeName))
        ) {
          const inspection = expression
            ? inspectReactStyleMutationCallback(
                expression,
                sourceFile,
                new Set(),
                attributeName === "ref",
                capturedMotionRefNames,
              )
            : "unknown";
          if (inspection !== "safe") {
            throw new MotionReactSourceError(
              "unsupported-authored-motion",
              `React ${attributeName} callbacks on a Motion component can access or mutate target styles and cannot be proven safe.`,
            );
          }
        }
        ts.forEachChild(node, visit);
        return;
      }
      if (!isRelevantTargetProp) return;
      const inspection = expression
        ? attributeName === "style"
          ? inspectReactStyleExpression(expression, sourceFile, new Set())
          : inspectReactCssExpression(expression, sourceFile, new Set(), true)
        : "unknown";
      if (inspection !== "safe") {
        throw new MotionReactSourceError(
          "unsupported-authored-motion",
          inspection === "motion"
            ? `React ${attributeName} prop animations and transitions cannot be imported losslessly; use a supported static JSX <style> animation rule.`
            : `A React dynamic ${attributeName} prop on a Motion target cannot be proven free of animation or transition declarations.`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

type ReactStyleInspection = "safe" | "motion" | "unknown";
const REACT_EVENT_TARGET_PROPERTIES = new Set([
  "currentTarget",
  "target",
  "srcElement",
]);
const REACT_EVENT_TARGET_SCALAR_PROPERTIES = new Set([
  "alt",
  "checked",
  "disabled",
  "height",
  "htmlFor",
  "id",
  "innerText",
  "max",
  "maxLength",
  "min",
  "minLength",
  "multiple",
  "name",
  "placeholder",
  "readOnly",
  "required",
  "role",
  "scrollLeft",
  "scrollTop",
  "selected",
  "selectedIndex",
  "selectionEnd",
  "selectionStart",
  "tabIndex",
  "textContent",
  "title",
  "type",
  "value",
  "width",
]);
const REACT_EVENT_TARGET_SCALAR_METHODS = new Set(["trim"]);
const REACT_REF_READ_METHODS = new Set([
  "closest",
  "contains",
  "getAttribute",
  "getBoundingClientRect",
  "getClientRects",
  "hasAttribute",
  "matches",
  "querySelector",
  "querySelectorAll",
]);

function collectReactCapturedRefNames(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
): Set<string> {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
    if (!ts.isIdentifier(expression)) return new Set();

    const resolved = resolveReactStyleExpression(expression, sourceFile);
    if (resolved) {
      const declarationKey = `${resolved.start}:${resolved.end}`;
      if (resolving.has(declarationKey)) return new Set();
      resolving.add(declarationKey);
      const names = collectReactCapturedRefNames(
        resolved.expression,
        sourceFile,
        resolving,
      );
      resolving.delete(declarationKey);
      return names;
    }

    const functions: TypeScript.FunctionDeclaration[] = [];
    const findFunction = (node: TypeScript.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === expression.text
      ) {
        functions.push(node);
      }
      ts.forEachChild(node, findFunction);
    };
    findFunction(sourceFile);
    const callback = functions.length === 1 ? functions[0] : null;
    if (!callback?.body) return new Set();
    return collectReactCapturedRefNamesFromCallback(
      callback.parameters,
      callback.body,
    );
  }

  return collectReactCapturedRefNamesFromCallback(
    expression.parameters,
    expression.body,
  );
}

function collectReactCapturedRefNamesFromCallback(
  parameters: TypeScript.NodeArray<TypeScript.ParameterDeclaration>,
  body: TypeScript.ConciseBody,
): Set<string> {
  const capturedNames = new Set<string>();
  const parameterNames = getReactCallbackParameterNames(parameters);
  if (parameterNames.size === 0) return capturedNames;

  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      isReactAssignmentOperator(node.operatorToken.getText()) &&
      ts.isIdentifier(node.left) &&
      !parameterNames.has(node.left.text) &&
      !isReactNameBoundWithinCallback(node, node.left.text, parameters, body) &&
      isReactCallbackParameterDerivedExpression(
        node.right,
        parameterNames,
        body,
        new Set(),
      )
    ) {
      capturedNames.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return capturedNames;
}

function isReactNameBoundWithinCallback(
  assignment: TypeScript.BinaryExpression,
  name: string,
  callbackParameters: TypeScript.NodeArray<TypeScript.ParameterDeclaration>,
  callbackBody: TypeScript.ConciseBody,
): boolean {
  const bindingContainsName = (
    bindingName: TypeScript.BindingName,
  ): boolean => {
    if (ts.isIdentifier(bindingName)) return bindingName.text === name;
    return bindingName.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) && bindingContainsName(element.name),
    );
  };
  const hasFunctionScopedBinding = (
    functionNode: TypeScript.FunctionLikeDeclaration,
  ): boolean => {
    if (
      functionNode.parameters.some((parameter) =>
        bindingContainsName(parameter.name),
      )
    ) {
      return true;
    }
    if (
      (ts.isFunctionExpression(functionNode) ||
        ts.isFunctionDeclaration(functionNode)) &&
      functionNode.name?.text === name
    ) {
      return true;
    }

    let found = false;
    const visit = (node: TypeScript.Node): void => {
      if (found || (node !== functionNode.body && isFunctionBoundary(node))) {
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.parent &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    if (functionNode.body) visit(functionNode.body);
    return found;
  };
  const hasBlockScopedBinding = (block: TypeScript.Block): boolean => {
    let found = false;
    const visit = (node: TypeScript.Node): void => {
      if (
        found ||
        (node !== block && (ts.isBlock(node) || isFunctionBoundary(node)))
      ) {
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.parent &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0
      ) {
        found = true;
        return;
      }
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name?.text === name
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(block);
    return found;
  };

  if (
    callbackParameters.some((parameter) => bindingContainsName(parameter.name))
  ) {
    return true;
  }
  for (
    let current: TypeScript.Node | undefined = assignment.parent;
    current;
    current = current.parent
  ) {
    if (ts.isBlock(current) && hasBlockScopedBinding(current)) return true;
    if (
      isFunctionBoundary(current) &&
      hasFunctionScopedBinding(current as TypeScript.FunctionLikeDeclaration)
    ) {
      return true;
    }
    if (current === callbackBody) {
      const callbackFunction = current.parent;
      if (
        callbackFunction &&
        isFunctionBoundary(callbackFunction) &&
        hasFunctionScopedBinding(
          callbackFunction as TypeScript.FunctionLikeDeclaration,
        )
      ) {
        return true;
      }
      break;
    }
  }
  return false;
}

function inspectReactStyleMutationCallback(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
  isRefCallback: boolean,
  capturedMotionRefNames: ReadonlySet<string> = new Set(),
  inspectLifecycleCalls = false,
): ReactStyleInspection {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
    if (ts.isIdentifier(expression)) {
      const resolved = resolveReactStyleExpression(expression, sourceFile);
      if (resolved) {
        const declarationKey = `${resolved.start}:${resolved.end}`;
        if (resolving.has(declarationKey)) return "unknown";
        resolving.add(declarationKey);
        const result = inspectReactStyleMutationCallback(
          resolved.expression,
          sourceFile,
          resolving,
          isRefCallback,
          capturedMotionRefNames,
          inspectLifecycleCalls,
        );
        resolving.delete(declarationKey);
        return result;
      }

      const handlerName = expression.text;
      const functions: TypeScript.FunctionDeclaration[] = [];
      const findFunction = (node: TypeScript.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === handlerName) {
          functions.push(node);
        }
        ts.forEachChild(node, findFunction);
      };
      findFunction(sourceFile);
      if (functions.length === 1 && functions[0]!.body) {
        if (
          isRefCallback &&
          functions[0]!.parameters.some(
            (parameter) => !ts.isIdentifier(parameter.name),
          )
        ) {
          return "unknown";
        }
        const callback = functions[0]!;
        const declarationKey = `${callback.getStart(sourceFile)}:${callback.end}`;
        if (resolving.has(declarationKey)) return "unknown";
        resolving.add(declarationKey);
        const callbackParameterNames = getReactCallbackParameterNames(
          callback.parameters,
        );
        const eventTargetBindings = isRefCallback
          ? { targetNames: new Set<string>(), scalarNames: new Set<string>() }
          : getReactCallbackEventTargetBindings(
              callback.parameters,
              callback.body!,
              callbackParameterNames,
            );
        if (!isRefCallback) {
          for (const name of capturedMotionRefNames) {
            eventTargetBindings.targetNames.add(name);
          }
        }
        const result = inspectReactStyleMutationBody(
          callback.body!,
          callbackParameterNames,
          isRefCallback,
          sourceFile,
          eventTargetBindings.targetNames,
          eventTargetBindings.scalarNames,
          resolving,
          inspectLifecycleCalls,
        );
        resolving.delete(declarationKey);
        return result;
      }
    }
    return "unknown";
  }

  if (
    isRefCallback &&
    expression.parameters.some((parameter) => !ts.isIdentifier(parameter.name))
  ) {
    return "unknown";
  }

  const callbackParameterNames = getReactCallbackParameterNames(
    expression.parameters,
  );
  const eventTargetBindings = isRefCallback
    ? { targetNames: new Set<string>(), scalarNames: new Set<string>() }
    : getReactCallbackEventTargetBindings(
        expression.parameters,
        expression.body,
        callbackParameterNames,
      );
  if (!isRefCallback) {
    for (const name of capturedMotionRefNames) {
      eventTargetBindings.targetNames.add(name);
    }
  }
  return inspectReactStyleMutationBody(
    expression.body,
    callbackParameterNames,
    isRefCallback,
    sourceFile,
    eventTargetBindings.targetNames,
    eventTargetBindings.scalarNames,
    resolving,
    inspectLifecycleCalls,
  );
}

function inspectReactStyleMutationBody(
  body: TypeScript.ConciseBody,
  callbackParameterNames: Set<string>,
  isRefCallback: boolean,
  sourceFile: TypeScript.SourceFile,
  eventTargetNames: Set<string>,
  eventTargetScalarNames: Set<string>,
  resolving: Set<string>,
  inspectLifecycleCalls: boolean,
): ReactStyleInspection {
  let inspection: ReactStyleInspection = "safe";
  const visit = (node: TypeScript.Node): void => {
    if (inspection !== "safe") return;

    if (isReactGlobalDocumentReference(node, sourceFile)) {
      inspection = "unknown";
      return;
    }

    if (inspectLifecycleCalls && ts.isCallExpression(node)) {
      const callInspection = inspectReactLifecycleHelperCall(
        node,
        sourceFile,
        resolving,
        eventTargetNames,
      );
      if (callInspection !== "safe") {
        inspection = callInspection;
        return;
      }
    }

    if (
      isRefCallback &&
      ts.isBinaryExpression(node) &&
      isReactAssignmentOperator(node.operatorToken.getText()) &&
      containsReactCallbackParameterReference(
        node.right,
        callbackParameterNames,
      ) &&
      (!ts.isIdentifier(node.left) ||
        !isReactCallbackParameterDerivedExpression(
          node.right,
          callbackParameterNames,
          body,
          new Set(),
        ))
    ) {
      inspection = "unknown";
      return;
    }

    if (
      isRefCallback &&
      ts.isVariableDeclaration(node) &&
      !ts.isIdentifier(node.name) &&
      node.initializer &&
      isReactCallbackParameterDerivedExpression(
        node.initializer,
        callbackParameterNames,
        body,
        new Set(),
      )
    ) {
      inspection = "unknown";
      return;
    }

    if (
      isRefCallback &&
      ((ts.isCallExpression(node) &&
        isReactRefTargetMethodCall(node, callbackParameterNames, body)) ||
        isReactRefTargetMemberAccess(node, callbackParameterNames, body) ||
        (ts.isBinaryExpression(node) &&
          isReactRefTargetMemberAssignment(node, callbackParameterNames, body)))
    ) {
      inspection = "unknown";
      return;
    }

    if (
      !isRefCallback &&
      isReactEventTargetMutation(
        node,
        callbackParameterNames,
        body,
        eventTargetNames,
      )
    ) {
      inspection = "unknown";
      return;
    }

    if (
      !isRefCallback &&
      ts.isIdentifier(node) &&
      eventTargetNames.has(node.text) &&
      !isReactStaticPropertyName(node) &&
      !isReactBindingNameIdentifier(node)
    ) {
      const access = getReactMemberAccessFollowing(node);
      if (
        !access ||
        !isReactSafeEventTargetScalarValue(
          access,
          callbackParameterNames,
          body,
          eventTargetNames,
          eventTargetScalarNames,
        )
      ) {
        inspection = "unknown";
        return;
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ["style", ...REACT_EVENT_TARGET_PROPERTIES, "current"].includes(
        node.name.text,
      )
    ) {
      inspection =
        node.name.text === "style"
          ? "motion"
          : !isRefCallback &&
              isReactSafeEventTargetScalarRead(
                node,
                callbackParameterNames,
                body,
                eventTargetNames,
              )
            ? "safe"
            : "unknown";
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      ["style", ...REACT_EVENT_TARGET_PROPERTIES, "current"].includes(
        node.argumentExpression.text,
      )
    ) {
      inspection =
        node.argumentExpression.text === "style"
          ? "motion"
          : !isRefCallback &&
              isReactSafeEventTargetScalarRead(
                node,
                callbackParameterNames,
                body,
                eventTargetNames,
              )
            ? "safe"
            : "unknown";
      return;
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.some(
        (argument) =>
          containsReactCallbackParameterReference(
            argument,
            callbackParameterNames,
          ) &&
          !isReactSafeEventTargetScalarValue(
            argument,
            callbackParameterNames,
            body,
            eventTargetNames,
            eventTargetScalarNames,
          ),
      )
    ) {
      inspection = "unknown";
      return;
    }

    ts.forEachChild(node, visit);
  };
  visit(body);
  return inspection;
}

function inspectReactLifecycleHelperCall(
  call: TypeScript.CallExpression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
  capturedMotionRefNames: ReadonlySet<string>,
): ReactStyleInspection {
  if (call.arguments.length > 0) return "unknown";
  const callee = unwrapReactMotionExpression(call.expression);
  if (!ts.isIdentifier(callee)) return "unknown";
  return inspectReactStyleMutationCallback(
    callee,
    sourceFile,
    resolving,
    false,
    capturedMotionRefNames,
    true,
  );
}

function isReactGlobalDocumentReference(
  node: TypeScript.Node,
  sourceFile: TypeScript.SourceFile,
  resolving = new Set<string>(),
): boolean {
  if (ts.isIdentifier(node) && node.text === "document") {
    return !isReactStaticPropertyName(node);
  }

  const propertyAccess = ts.isPropertyAccessExpression(node) ? node : null;
  const elementAccess = ts.isElementAccessExpression(node) ? node : null;
  const receiver =
    propertyAccess?.expression ?? elementAccess?.expression ?? null;
  const propertyName = propertyAccess
    ? propertyAccess.name.text
    : elementAccess?.argumentExpression &&
        ts.isStringLiteralLike(elementAccess.argumentExpression)
      ? elementAccess.argumentExpression.text
      : null;
  if (
    propertyName === "document" &&
    receiver !== null &&
    isReactGlobalObjectReference(receiver, sourceFile, resolving)
  ) {
    return true;
  }

  if (!ts.isIdentifier(node) || isReactStaticPropertyName(node)) return false;
  const resolved = resolveReactStyleExpression(node, sourceFile);
  if (!resolved) return false;
  const declarationKey = `${resolved.start}:${resolved.end}`;
  if (resolving.has(declarationKey)) return true;
  resolving.add(declarationKey);

  let found = false;
  const visit = (current: TypeScript.Node): void => {
    if (found) return;
    if (isReactGlobalDocumentReference(current, sourceFile, resolving)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(resolved.expression);
  resolving.delete(declarationKey);
  return found;
}

function isReactGlobalObjectReference(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (!ts.isIdentifier(expression) || isReactStaticPropertyName(expression)) {
    return false;
  }
  if (
    ["globalThis", "self", "window"].includes(expression.text) &&
    !hasReactStyleParameterShadow(expression, sourceFile, expression.text) &&
    !resolveReactStyleExpression(expression, sourceFile)
  ) {
    return true;
  }

  const resolved = resolveReactStyleExpression(expression, sourceFile);
  if (!resolved) return false;
  const declarationKey = `${resolved.start}:${resolved.end}`;
  if (resolving.has(declarationKey)) return false;
  resolving.add(declarationKey);
  const isGlobal = isReactGlobalObjectReference(
    resolved.expression,
    sourceFile,
    resolving,
  );
  resolving.delete(declarationKey);
  return isGlobal;
}

function isReactLifecycleEffectCall(
  call: TypeScript.CallExpression,
  sourceFile: TypeScript.SourceFile,
): boolean {
  return isReactLifecycleEffectExpression(call.expression, sourceFile);
}

function isReactLifecycleEffectExpression(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving = new Set<string>(),
): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return ["useEffect", "useLayoutEffect", "useInsertionEffect"].includes(
      expression.name.text,
    );
  }
  if (!ts.isIdentifier(expression)) return false;
  if (
    ["useEffect", "useLayoutEffect", "useInsertionEffect"].includes(
      expression.text,
    )
  ) {
    return true;
  }

  const importedReactHook = sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "react"
    ) {
      return false;
    }
    const namedBindings = statement.importClause?.namedBindings;
    return (
      !!namedBindings &&
      ts.isNamedImports(namedBindings) &&
      namedBindings.elements.some(
        (element) =>
          element.name.text === expression.text &&
          ["useEffect", "useLayoutEffect", "useInsertionEffect"].includes(
            element.propertyName?.text ?? element.name.text,
          ),
      )
    );
  });
  if (importedReactHook) return true;

  const resolved = resolveReactStyleExpression(expression, sourceFile);
  if (!resolved) return false;
  const declarationKey = `${resolved.start}:${resolved.end}`;
  if (resolving.has(declarationKey)) return false;
  resolving.add(declarationKey);
  const isEffect = isReactLifecycleEffectExpression(
    resolved.expression,
    sourceFile,
    resolving,
  );
  resolving.delete(declarationKey);
  return isEffect;
}

function inspectReactJsxSpreadExpression(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
  capturedMotionRefNames: ReadonlySet<string> = new Set(),
): ReactStyleInspection {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (!ts.isObjectLiteralExpression(expression)) {
    const resolved = resolveReactStyleExpression(expression, sourceFile);
    if (!resolved) return "unknown";
    const declarationKey = `${resolved.start}:${resolved.end}`;
    if (resolving.has(declarationKey)) return "unknown";
    resolving.add(declarationKey);
    const result = inspectReactJsxSpreadExpression(
      resolved.expression,
      sourceFile,
      resolving,
      capturedMotionRefNames,
    );
    resolving.delete(declarationKey);
    return result;
  }

  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      const inspection = inspectReactJsxSpreadExpression(
        property.expression,
        sourceFile,
        resolving,
        capturedMotionRefNames,
      );
      if (inspection !== "safe") return inspection;
      continue;
    }

    const name =
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property)
        ? property.name
        : null;
    if (!name) return "unknown";
    const propertyName =
      ts.isIdentifier(name) || ts.isStringLiteral(name)
        ? name.text
        : ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)
          ? name.expression.text
          : null;
    if (!propertyName) return "unknown";

    const value = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : null;
    if (!value) return "unknown";

    let inspection: ReactStyleInspection;
    if (propertyName === "style") {
      inspection = inspectReactStyleExpression(value, sourceFile, new Set());
    } else if (propertyName === "css" || propertyName === "sx") {
      inspection = inspectReactCssExpression(
        value,
        sourceFile,
        new Set(),
        true,
      );
    } else if (propertyName === "ref" || /^on[A-Z]/.test(propertyName)) {
      inspection = inspectReactStyleMutationCallback(
        value,
        sourceFile,
        new Set(),
        propertyName === "ref",
        capturedMotionRefNames,
      );
    } else if (
      ["class", "className", "children", "dangerouslySetInnerHTML"].includes(
        propertyName,
      )
    ) {
      inspection = "unknown";
    } else {
      inspection = isStaticReactJsxSpreadValue(value) ? "safe" : "unknown";
    }
    if (inspection !== "safe") return inspection;
  }

  return "safe";
}

function isStaticReactJsxSpreadValue(
  expression: TypeScript.Expression,
): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  return (
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
  );
}

function isReactRefTargetMethodCall(
  call: TypeScript.CallExpression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
): boolean {
  const callee = call.expression;
  const propertyAccess = ts.isPropertyAccessExpression(callee) ? callee : null;
  const elementAccess = ts.isElementAccessExpression(callee) ? callee : null;
  const receiver =
    propertyAccess?.expression ?? elementAccess?.expression ?? null;
  if (
    !receiver ||
    !isReactCallbackParameterDerivedExpression(
      receiver,
      callbackParameterNames,
      body,
      new Set(),
    )
  ) {
    return false;
  }

  const argumentExpression = elementAccess?.argumentExpression;
  const methodName = propertyAccess
    ? propertyAccess.name.text
    : argumentExpression && ts.isStringLiteralLike(argumentExpression)
      ? argumentExpression.text
      : null;
  return !methodName || !REACT_REF_READ_METHODS.has(methodName);
}

function isReactRefTargetMemberAccess(
  node: TypeScript.Node,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
): boolean {
  const propertyAccess = ts.isPropertyAccessExpression(node) ? node : null;
  const elementAccess = ts.isElementAccessExpression(node) ? node : null;
  const receiver =
    propertyAccess?.expression ?? elementAccess?.expression ?? null;
  if (
    !receiver ||
    !isReactCallbackParameterDerivedExpression(
      receiver,
      callbackParameterNames,
      body,
      new Set(),
    )
  ) {
    return false;
  }

  const argumentExpression = elementAccess?.argumentExpression;
  const propertyName = propertyAccess
    ? propertyAccess.name.text
    : argumentExpression && ts.isStringLiteralLike(argumentExpression)
      ? argumentExpression.text
      : null;
  return !propertyName || !REACT_REF_READ_METHODS.has(propertyName);
}

function isReactRefTargetMemberAssignment(
  assignment: TypeScript.BinaryExpression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
): boolean {
  if (!isReactAssignmentOperator(assignment.operatorToken.getText())) {
    return false;
  }

  const left = assignment.left;
  const receiver = ts.isPropertyAccessExpression(left)
    ? left.expression
    : ts.isElementAccessExpression(left)
      ? left.expression
      : null;
  return (
    receiver !== null &&
    isReactCallbackParameterDerivedExpression(
      receiver,
      callbackParameterNames,
      body,
      new Set(),
    )
  );
}

function isReactSafeEventTargetScalarRead(
  node:
    | TypeScript.PropertyAccessExpression
    | TypeScript.ElementAccessExpression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
  eventTargetNames: Set<string>,
): boolean {
  const parent = getReactMemberAccessFollowing(node);
  const propertyName = parent
    ? ts.isPropertyAccessExpression(parent)
      ? parent.name.text
      : parent.argumentExpression &&
          ts.isStringLiteralLike(parent.argumentExpression)
        ? parent.argumentExpression.text
        : null
    : null;
  return (
    propertyName !== null &&
    REACT_EVENT_TARGET_SCALAR_PROPERTIES.has(propertyName) &&
    isReactEventTargetBaseAccess(
      node,
      callbackParameterNames,
      body,
      eventTargetNames,
    )
  );
}

function isReactSafeEventTargetScalarValue(
  expression: TypeScript.Expression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
  eventTargetNames: Set<string>,
  eventTargetScalarNames: Set<string>,
): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (
    ts.isIdentifier(expression) &&
    eventTargetScalarNames.has(expression.text)
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      REACT_EVENT_TARGET_SCALAR_PROPERTIES.has(expression.name.text) &&
      isReactEventTargetBaseAccess(
        expression.expression,
        callbackParameterNames,
        body,
        eventTargetNames,
      )
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    const propertyName = expression.argumentExpression;
    return (
      !!propertyName &&
      ts.isStringLiteralLike(propertyName) &&
      REACT_EVENT_TARGET_SCALAR_PROPERTIES.has(propertyName.text) &&
      isReactEventTargetBaseAccess(
        expression.expression,
        callbackParameterNames,
        body,
        eventTargetNames,
      )
    );
  }
  if (ts.isCallExpression(expression) && expression.arguments.length === 0) {
    const callee = unwrapReactMotionExpression(expression.expression);
    return (
      ts.isPropertyAccessExpression(callee) &&
      REACT_EVENT_TARGET_SCALAR_METHODS.has(callee.name.text) &&
      isReactSafeEventTargetScalarValue(
        callee.expression,
        callbackParameterNames,
        body,
        eventTargetNames,
        eventTargetScalarNames,
      )
    );
  }
  return false;
}

function isReactEventTargetBaseAccess(
  expression: TypeScript.Expression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
  eventTargetNames: Set<string>,
): boolean {
  expression = unwrapReactMotionExpression(expression);
  if (ts.isIdentifier(expression) && eventTargetNames.has(expression.text)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      REACT_EVENT_TARGET_PROPERTIES.has(expression.name.text) &&
      isReactCallbackParameterDerivedExpression(
        expression.expression,
        callbackParameterNames,
        body,
        new Set(),
      )
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    const propertyName = expression.argumentExpression;
    return (
      !!propertyName &&
      ts.isStringLiteralLike(propertyName) &&
      REACT_EVENT_TARGET_PROPERTIES.has(propertyName.text) &&
      isReactCallbackParameterDerivedExpression(
        expression.expression,
        callbackParameterNames,
        body,
        new Set(),
      )
    );
  }
  return false;
}

function getReactMemberAccessFollowing(
  node: TypeScript.Node,
):
  | TypeScript.PropertyAccessExpression
  | TypeScript.ElementAccessExpression
  | null {
  let current: TypeScript.Node = node;
  let parent = current.parent;
  while (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)) &&
    parent.expression === current
  ) {
    current = parent;
    parent = current.parent;
  }
  return (ts.isPropertyAccessExpression(parent) ||
    ts.isElementAccessExpression(parent)) &&
    parent.expression === current
    ? parent
    : null;
}

function unwrapReactMotionExpression(
  expression: TypeScript.Expression,
): TypeScript.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isReactEventTargetMutation(
  node: TypeScript.Node,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
  eventTargetNames: Set<string>,
): boolean {
  if (ts.isBinaryExpression(node)) {
    return (
      isReactAssignmentOperator(node.operatorToken.getText()) &&
      containsReactEventTargetBaseAccess(
        node.left,
        callbackParameterNames,
        body,
        eventTargetNames,
      )
    );
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return (
      [
        ts.SyntaxKind.DeleteKeyword,
        ts.SyntaxKind.PlusPlusToken,
        ts.SyntaxKind.MinusMinusToken,
      ].includes(node.operator) &&
      containsReactEventTargetBaseAccess(
        node.operand,
        callbackParameterNames,
        body,
        eventTargetNames,
      )
    );
  }
  if (ts.isPostfixUnaryExpression(node)) {
    return (
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
        node.operator,
      ) &&
      containsReactEventTargetBaseAccess(
        node.operand,
        callbackParameterNames,
        body,
        eventTargetNames,
      )
    );
  }
  return false;
}

function containsReactEventTargetBaseAccess(
  expression: TypeScript.Expression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
  eventTargetNames: Set<string>,
): boolean {
  expression = unwrapReactMotionExpression(expression);
  if (
    isReactEventTargetBaseAccess(
      expression,
      callbackParameterNames,
      body,
      eventTargetNames,
    )
  ) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return containsReactEventTargetBaseAccess(
      expression.expression,
      callbackParameterNames,
      body,
      eventTargetNames,
    );
  }
  return false;
}

function isReactAssignmentOperator(operator: string): boolean {
  return [
    "=",
    "+=",
    "-=",
    "*=",
    "**=",
    "/=",
    "%=",
    "<<=",
    ">>=",
    ">>>=",
    "&=",
    "|=",
    "^=",
    "&&=",
    "||=",
    "??=",
  ].includes(operator);
}

function isReactCallbackParameterDerivedExpression(
  expression: TypeScript.Expression,
  callbackParameterNames: Set<string>,
  body: TypeScript.ConciseBody,
  resolving: Set<string>,
): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (ts.isIdentifier(expression)) {
    if (callbackParameterNames.has(expression.text)) return true;
    if (resolving.has(expression.text)) return false;

    const assignments: TypeScript.Expression[] = [];
    const visit = (node: TypeScript.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === expression.text &&
        node.initializer
      ) {
        assignments.push(node.initializer);
      } else if (
        ts.isBinaryExpression(node) &&
        ts.isIdentifier(node.left) &&
        node.left.text === expression.text &&
        isReactAssignmentOperator(node.operatorToken.getText())
      ) {
        assignments.push(node.right);
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    if (assignments.length === 0) return false;

    resolving.add(expression.text);
    const derived = assignments.some((assignment) =>
      isReactCallbackParameterDerivedExpression(
        assignment,
        callbackParameterNames,
        body,
        resolving,
      ),
    );
    resolving.delete(expression.text);
    return derived;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return isReactCallbackParameterDerivedExpression(
      expression.expression,
      callbackParameterNames,
      body,
      resolving,
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    return isReactCallbackParameterDerivedExpression(
      expression.expression,
      callbackParameterNames,
      body,
      resolving,
    );
  }
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    const receiver = ts.isPropertyAccessExpression(callee)
      ? callee.expression
      : ts.isElementAccessExpression(callee)
        ? callee.expression
        : null;
    return (
      receiver !== null &&
      isReactCallbackParameterDerivedExpression(
        receiver,
        callbackParameterNames,
        body,
        resolving,
      )
    );
  }
  return false;
}

function containsReactCallbackParameterReference(
  node: TypeScript.Node,
  callbackParameterNames: Set<string>,
): boolean {
  let found = false;
  const visit = (current: TypeScript.Node): void => {
    if (found) return;
    if (
      ts.isIdentifier(current) &&
      callbackParameterNames.has(current.text) &&
      !isReactStaticPropertyName(current)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isReactStaticPropertyName(node: TypeScript.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
      parent.name === node &&
      !ts.isComputedPropertyName(parent.name))
  );
}

function isReactBindingNameIdentifier(node: TypeScript.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node)
  );
}

function getReactCallbackParameterNames(
  parameters: TypeScript.NodeArray<TypeScript.ParameterDeclaration>,
): Set<string> {
  const names = new Set<string>();
  const addBindingNames = (bindingName: TypeScript.BindingName): void => {
    if (ts.isIdentifier(bindingName)) {
      names.add(bindingName.text);
      return;
    }
    if (ts.isObjectBindingPattern(bindingName)) {
      for (const element of bindingName.elements) {
        addBindingNames(element.name);
      }
      return;
    }
    for (const element of bindingName.elements) {
      if (!ts.isOmittedExpression(element)) addBindingNames(element.name);
    }
  };

  for (const parameter of parameters) addBindingNames(parameter.name);
  return names;
}

interface ReactCallbackEventTargetBindings {
  targetNames: Set<string>;
  scalarNames: Set<string>;
}

function getReactCallbackEventTargetBindings(
  parameters: TypeScript.NodeArray<TypeScript.ParameterDeclaration>,
  body: TypeScript.ConciseBody,
  callbackParameterNames: Set<string>,
): ReactCallbackEventTargetBindings {
  const targetNames = new Set<string>();
  const scalarNames = new Set<string>();
  const eventObjectNames = new Set(
    parameters.flatMap((parameter) =>
      ts.isIdentifier(parameter.name) ? [parameter.name.text] : [],
    ),
  );
  const localDeclarations: TypeScript.VariableDeclaration[] = [];
  const addBindingNames = (
    bindingName: TypeScript.BindingName,
    into: Set<string>,
  ): boolean => {
    if (ts.isIdentifier(bindingName)) {
      const previousSize = into.size;
      into.add(bindingName.text);
      return into.size !== previousSize;
    }
    let changed = false;
    if (ts.isObjectBindingPattern(bindingName)) {
      for (const element of bindingName.elements) {
        changed = addBindingNames(element.name, into) || changed;
      }
      return changed;
    }
    for (const element of bindingName.elements) {
      if (!ts.isOmittedExpression(element)) {
        changed = addBindingNames(element.name, into) || changed;
      }
    }
    return changed;
  };

  const addTargetObjectBinding = (
    bindingName: TypeScript.BindingName,
  ): boolean => {
    if (!ts.isObjectBindingPattern(bindingName)) {
      return addBindingNames(bindingName, targetNames);
    }
    let changed = false;
    for (const element of bindingName.elements) {
      const propertyName = element.propertyName
        ? getReactStaticBindingPropertyName(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null;
      if (
        !element.dotDotDotToken &&
        propertyName &&
        REACT_EVENT_TARGET_SCALAR_PROPERTIES.has(propertyName) &&
        ts.isIdentifier(element.name)
      ) {
        const previousSize = scalarNames.size;
        scalarNames.add(element.name.text);
        changed = scalarNames.size !== previousSize || changed;
      } else {
        changed = addBindingNames(element.name, targetNames) || changed;
      }
    }
    return changed;
  };

  const addEventObjectBinding = (
    bindingName: TypeScript.BindingName,
  ): boolean => {
    if (!ts.isObjectBindingPattern(bindingName)) {
      return addBindingNames(bindingName, targetNames);
    }
    let changed = false;
    for (const element of bindingName.elements) {
      const propertyName = element.propertyName
        ? getReactStaticBindingPropertyName(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null;
      if (
        !element.dotDotDotToken &&
        propertyName &&
        REACT_EVENT_TARGET_PROPERTIES.has(propertyName)
      ) {
        if (ts.isIdentifier(element.name)) {
          const previousSize = targetNames.size;
          targetNames.add(element.name.text);
          changed = targetNames.size !== previousSize || changed;
        } else {
          changed = addTargetObjectBinding(element.name) || changed;
        }
      } else if (element.dotDotDotToken) {
        changed = addBindingNames(element.name, targetNames) || changed;
      }
    }
    return changed;
  };

  for (const parameter of parameters) {
    if (!ts.isObjectBindingPattern(parameter.name)) continue;
    addEventObjectBinding(parameter.name);
  }

  const collectDeclarations = (node: TypeScript.Node): void => {
    if (ts.isVariableDeclaration(node)) localDeclarations.push(node);
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(body);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of localDeclarations) {
      if (!declaration.initializer) continue;
      const initializer = unwrapReactMotionExpression(declaration.initializer);
      if (
        ts.isIdentifier(declaration.name) &&
        ts.isIdentifier(initializer) &&
        eventObjectNames.has(initializer.text)
      ) {
        const previousSize = eventObjectNames.size;
        eventObjectNames.add(declaration.name.text);
        changed = eventObjectNames.size !== previousSize || changed;
        continue;
      }
      if (
        ts.isObjectBindingPattern(declaration.name) &&
        ts.isIdentifier(initializer) &&
        eventObjectNames.has(initializer.text)
      ) {
        changed = addEventObjectBinding(declaration.name) || changed;
        continue;
      }
      if (
        ts.isObjectBindingPattern(declaration.name) &&
        isReactEventTargetBaseAccess(
          initializer,
          callbackParameterNames,
          body,
          targetNames,
        )
      ) {
        changed = addTargetObjectBinding(declaration.name) || changed;
      }
    }
  }
  return { targetNames, scalarNames };
}

function getReactStaticBindingPropertyName(
  name: TypeScript.PropertyName,
): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
    ? name.expression.text
    : null;
}

function inspectReactStyleExpression(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
): ReactStyleInspection {
  if (hasDynamicCodeExecution(sourceFile)) return "unknown";
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword) return "safe";
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) return "unknown";
      const name = ts.isPropertyAssignment(property)
        ? property.name
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : null;
      const text = name
        ? ts.isIdentifier(name) || ts.isStringLiteral(name)
          ? name.text
          : null
        : null;
      if (text && isReactMotionStylePropName(text)) return "motion";
      if (!text) return "unknown";
    }
    return "safe";
  }

  const resolved = resolveReactStyleExpression(expression, sourceFile);
  if (!resolved) return "unknown";
  const declarationKey = `${resolved.start}:${resolved.end}`;
  if (resolving.has(declarationKey)) return "unknown";
  resolving.add(declarationKey);
  const result = inspectReactStyleExpression(
    resolved.expression,
    sourceFile,
    resolving,
  );
  resolving.delete(declarationKey);
  return result;
}

function inspectReactCssExpression(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving: Set<string>,
  inspectRootCssString = false,
): ReactStyleInspection {
  if (hasDynamicCodeExecution(sourceFile)) return "unknown";
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  if (inspectRootCssString && isReactCssStringLiteral(expression)) {
    return inspectReactCssString(expression.text);
  }
  if (isStaticReactCssValueExpression(expression)) return "safe";
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) return "unknown";
      if (
        !ts.isPropertyAssignment(property) &&
        !ts.isShorthandPropertyAssignment(property)
      ) {
        return "unknown";
      }
      const name = property.name;
      const text =
        ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
      if (!text) return "unknown";
      if (isReactMotionStylePropName(text)) return "motion";
      const valueExpression = ts.isPropertyAssignment(property)
        ? property.initializer
        : property.name;
      if (!isStaticReactCssValueExpression(valueExpression)) {
        const nested = inspectReactCssExpression(
          valueExpression,
          sourceFile,
          resolving,
        );
        if (nested !== "safe") return nested;
      }
    }
    return "safe";
  }

  const resolved = resolveReactStyleExpression(expression, sourceFile);
  if (!resolved) return "unknown";
  const declarationKey = `${resolved.start}:${resolved.end}`;
  if (resolving.has(declarationKey)) return "unknown";
  resolving.add(declarationKey);
  const result = inspectReactCssExpression(
    resolved.expression,
    sourceFile,
    resolving,
    inspectRootCssString,
  );
  resolving.delete(declarationKey);
  return result;
}

function hasDynamicCodeExecution(sourceFile: TypeScript.SourceFile): boolean {
  let found = false;
  const visit = (node: TypeScript.Node): void => {
    if (found) return;
    const dynamicCodeReference =
      ts.isIdentifier(node) &&
      (node.text === "Function" || node.text === "eval") &&
      isDynamicCodeExecutionReference(node);
    const dynamicCodeProperty =
      (ts.isPropertyAccessExpression(node) &&
        ["Function", "eval"].includes(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        ["Function", "eval"].includes(node.argumentExpression.text));
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const directEval = ts.isIdentifier(callee) && callee.text === "eval";
      const functionConstructor =
        ts.isIdentifier(callee) && callee.text === "Function";
      const timerName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      const timerCode = node.arguments[0];
      const dynamicTimer =
        ["setTimeout", "setInterval"].includes(timerName ?? "") &&
        timerCode !== undefined &&
        isStaticallyStringExpression(timerCode, sourceFile);
      if (
        directEval ||
        functionConstructor ||
        dynamicCodeReference ||
        dynamicCodeProperty ||
        dynamicTimer
      ) {
        found = true;
        return;
      }
    }
    if (dynamicCodeReference || dynamicCodeProperty) {
      found = true;
      return;
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Function"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isDynamicCodeExecutionReference(node: TypeScript.Identifier): boolean {
  let child: TypeScript.Node = node;
  for (
    let parent = node.parent;
    parent;
    child = parent, parent = parent.parent
  ) {
    if (ts.isTypeNode(parent)) return false;
    if (
      (ts.isVariableDeclaration(parent) && parent.name === child) ||
      (ts.isFunctionDeclaration(parent) && parent.name === child) ||
      (ts.isFunctionExpression(parent) && parent.name === child) ||
      (ts.isClassDeclaration(parent) && parent.name === child) ||
      (ts.isClassExpression(parent) && parent.name === child) ||
      (ts.isParameter(parent) && parent.name === child) ||
      (ts.isTypeAliasDeclaration(parent) && parent.name === child) ||
      (ts.isInterfaceDeclaration(parent) && parent.name === child)
    ) {
      return false;
    }
  }
  return true;
}

function isStaticallyStringExpression(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  resolving = new Set<string>(),
): boolean {
  if (ts.isStringLiteralLike(expression)) return true;
  if (ts.isParenthesizedExpression(expression)) {
    return isStaticallyStringExpression(
      expression.expression,
      sourceFile,
      resolving,
    );
  }
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return isStaticallyStringExpression(
      expression.expression,
      sourceFile,
      resolving,
    );
  }
  if (!ts.isIdentifier(expression) || resolving.has(expression.text)) {
    return false;
  }

  const nextResolving = new Set(resolving).add(expression.text);
  let found = false;
  const visit = (node: TypeScript.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === expression.text &&
      node.initializer
    ) {
      found = isStaticallyStringExpression(
        node.initializer,
        sourceFile,
        nextResolving,
      );
      if (found) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function resolveReactStyleExpression(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
): { expression: TypeScript.Expression; start: number; end: number } | null {
  const name = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : null;
  if (!name) return null;

  if (
    hasReactStyleParameterShadow(expression, sourceFile, name) ||
    hasReactStyleDeclarationShadow(expression, sourceFile, name)
  ) {
    return null;
  }

  const matches: TypeScript.VariableDeclaration[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      reactBindingNameContains(node.name, name)
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (matches.length !== 1) return null;
  const declaration = matches[0]!;
  if (!ts.isIdentifier(declaration.name)) return null;
  const declarationList = declaration.parent;
  if (
    !ts.isVariableDeclarationList(declarationList) ||
    (declarationList.flags & ts.NodeFlags.Const) === 0
  ) {
    return null;
  }
  const scope = reactVariableDeclarationScope(declaration);
  if (!scope || !isReactNodeWithinScope(scope, expression)) return null;
  const initializer = declaration.initializer;
  if (
    initializer &&
    !isStaticReactCssValueExpression(initializer) &&
    !hasSingleReactStyleAliasReference(name, declaration, sourceFile)
  ) {
    return null;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const objectInitializer = initializer
      ? unwrapReactMotionExpression(initializer)
      : null;
    if (
      !ts.isIdentifier(expression.expression) ||
      !objectInitializer ||
      !ts.isObjectLiteralExpression(objectInitializer)
    ) {
      return null;
    }
    const propertyName = expression.name.text;
    const properties = objectInitializer.properties.filter(
      (property): property is TypeScript.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) &&
          property.name.text === propertyName) ||
          (ts.isStringLiteral(property.name) &&
            property.name.text === propertyName)),
    );
    if (properties.length !== 1) return null;
    return {
      expression: properties[0]!.initializer,
      start: properties[0]!.getStart(sourceFile),
      end: properties[0]!.end,
    };
  }
  return initializer
    ? {
        expression: initializer,
        start: initializer.getStart(sourceFile),
        end: initializer.end,
      }
    : null;
}

function hasSingleReactStyleAliasReference(
  name: string,
  declaration: TypeScript.VariableDeclaration,
  sourceFile: TypeScript.SourceFile,
): boolean {
  let references = 0;
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      !isReactNodeWithinScope(declaration.name, node)
    ) {
      references += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references === 1;
}

function hasReactStyleParameterShadow(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  name: string,
): boolean {
  for (
    let node: TypeScript.Node | undefined = expression.parent;
    node && node !== sourceFile;
    node = node.parent
  ) {
    if (
      ts.isFunctionLike(node) &&
      node.parameters.some((parameter) =>
        reactBindingNameContains(parameter.name, name),
      )
    ) {
      return true;
    }
  }
  return false;
}

function hasReactStyleDeclarationShadow(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  name: string,
): boolean {
  for (
    let node: TypeScript.Node | undefined = expression.parent;
    node && node !== sourceFile;
    node = node.parent
  ) {
    if (
      ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
        node.name?.text === name) ||
      ((ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) &&
        node.statements.some(
          (statement) =>
            (ts.isFunctionDeclaration(statement) ||
              ts.isClassDeclaration(statement)) &&
            statement.name?.text === name,
        ))
    ) {
      return true;
    }
  }
  return false;
}

function reactBindingNameContains(
  bindingName: TypeScript.BindingName,
  name: string,
): boolean {
  if (ts.isIdentifier(bindingName)) return bindingName.text === name;
  if (ts.isObjectBindingPattern(bindingName)) {
    return bindingName.elements.some((element) =>
      reactBindingNameContains(element.name, name),
    );
  }
  return bindingName.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) &&
      reactBindingNameContains(element.name, name),
  );
}

function reactVariableDeclarationScope(
  declaration: TypeScript.VariableDeclaration,
): TypeScript.Node | null {
  for (
    let node: TypeScript.Node | undefined = declaration.parent;
    node;
    node = node.parent
  ) {
    if (
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isSourceFile(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)
    ) {
      return node;
    }
  }
  return null;
}

function isReactNodeWithinScope(
  scope: TypeScript.Node,
  node: TypeScript.Node,
): boolean {
  for (
    let current: TypeScript.Node | undefined = node;
    current;
    current = current.parent
  ) {
    if (current === scope) return true;
  }
  return false;
}

function isReactMotionStylePropName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/-/g, "");
  return (
    /^(?:webkit|moz|ms|o)?animation(?:name|duration|delay|timingfunction|fillmode|iterationcount|direction|playstate|composition|timeline|range(?:start|end)?)?$/.test(
      normalized,
    ) ||
    /^(?:webkit|moz|ms|o)?transition(?:property|duration|delay|timingfunction|behavior)?$/.test(
      normalized,
    )
  );
}

function isReactCssStringLiteral(
  expression: TypeScript.Expression,
): expression is
  | TypeScript.StringLiteral
  | TypeScript.NoSubstitutionTemplateLiteral {
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  );
}

function inspectReactCssString(css: string): ReactStyleInspection {
  const inspected = maskReactCssCommentsAndStrings(css);
  if (inspected.includes("\\")) return "unknown";
  const declarations = inspected.matchAll(/(?:^|[;{}\s])\s*([\w-]+)\s*:/g);
  let foundDeclaration = false;
  for (const declaration of declarations) {
    foundDeclaration = true;
    if (isReactMotionStylePropName(declaration[1]!)) return "motion";
  }
  if (foundDeclaration || inspected.trim().length === 0) return "safe";
  return "unknown";
}

function maskReactCssCommentsAndStrings(css: string): string {
  let result = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < css.length; index++) {
    const character = css[index]!;
    if (quote) {
      if (character === "\\") {
        result += " ";
        const escaped = css[index + 1];
        if (escaped !== undefined) {
          result += escaped === "\n" ? "\n" : " ";
          index++;
        }
      } else {
        if (character === quote) quote = null;
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (character === "/" && css[index + 1] === "*") {
      result += "  ";
      index++;
      while (
        index + 1 < css.length &&
        !(css[index] === "*" && css[index + 1] === "/")
      ) {
        index++;
        result += css[index] === "\n" ? "\n" : " ";
      }
      if (index + 1 < css.length) {
        result += "  ";
        index++;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      result += " ";
      continue;
    }
    result += character;
  }
  return result;
}

function isStaticReactCssValueExpression(
  expression: TypeScript.Expression,
): boolean {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  );
}

function readStaticReactStyleContent(
  sourceFile: TypeScript.SourceFile,
  style: TypeScript.JsxElement,
): { css: string; start: number } | null {
  const bodyStart = style.openingElement.end;
  const bodyEnd = style.closingElement.getStart(sourceFile);
  const substantiveChildren = style.children.filter((child) => {
    if (ts.isJsxText(child)) return child.getText(sourceFile).trim() !== "";
    return !(ts.isJsxExpression(child) && !child.expression);
  });
  if (substantiveChildren.length !== 1) return null;

  const child = substantiveChildren[0]!;
  if (ts.isJsxText(child)) {
    const raw = sourceFile.text.slice(bodyStart, bodyEnd);
    if (raw !== child.getText(sourceFile) || raw !== child.text) return null;
    return { css: raw, start: bodyStart };
  }
  if (!ts.isJsxExpression(child) || !child.expression) return null;
  const expression = child.expression;
  if (
    !ts.isStringLiteral(expression) &&
    !ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return null;
  }

  const rawLiteral = expression.getText(sourceFile);
  const delimiter = ts.isStringLiteral(expression) ? rawLiteral[0] : "`";
  if (
    rawLiteral.length < 2 ||
    (delimiter !== '"' && delimiter !== "'" && delimiter !== "`") ||
    rawLiteral[0] !== delimiter ||
    rawLiteral[rawLiteral.length - 1] !== delimiter
  ) {
    return null;
  }
  const cssStart = expression.getStart(sourceFile) + 1;
  const cssEnd = expression.end - 1;
  const before = sourceFile.text.slice(bodyStart, child.getStart(sourceFile));
  const after = sourceFile.text.slice(child.end, bodyEnd);
  const raw = sourceFile.text.slice(cssStart, cssEnd);
  if (
    !/^\s*$/.test(before) ||
    !/^\s*$/.test(after) ||
    raw !== expression.text
  ) {
    return null;
  }
  return { css: raw, start: cssStart };
}

function assertSupportedAuthoredReactStyle(
  sourceFile: TypeScript.SourceFile,
  style: TypeScript.JsxElement,
): void {
  for (const attribute of style.openingElement.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        "React inline style animations with spread or conditional style attributes are unsupported.",
      );
    }
    const name = attribute.name.getText(sourceFile).toLowerCase();
    if (["media", "disabled", "title", "scoped"].includes(name)) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        "React inline style animations with conditional or alternate stylesheet attributes are unsupported.",
      );
    }
    if (name === "type") {
      const value = readStaticJsxAttributeValue(attribute);
      if (
        value.status !== "static" ||
        !/^\s*(?:text\/css)?\s*$/i.test(value.value)
      ) {
        throw new MotionReactSourceError(
          "unsupported-authored-motion",
          "React inline style animations require a static CSS style element.",
        );
      }
    }
  }

  let root: TypeScript.JsxElement | TypeScript.JsxFragment;
  try {
    root = findComponentRoot(sourceFile, style);
  } catch (error) {
    throw new MotionReactSourceError(
      "unsupported-authored-motion",
      error instanceof Error
        ? error.message
        : "React inline style animations must belong to one static component root.",
    );
  }
  for (
    let current: TypeScript.Node | undefined = style.parent;
    current;
    current = current.parent
  ) {
    if (current === root) return;
    if (ts.isJsxExpression(current) && current.expression) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        "React inline style animations inside conditional or mapped JSX are unsupported.",
      );
    }
  }
  throw new MotionReactSourceError(
    "unsupported-authored-motion",
    "React inline style animation is outside its component's returned JSX root.",
  );
}

function findReactAuthoredHosts(
  sourceFile: TypeScript.SourceFile,
): ReactAuthoredHost[] {
  const hosts: ReactAuthoredHost[] = [];
  let ordinal = 0;
  const visit = (node: TypeScript.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName;
      if (ts.isIdentifier(tag) && isMotionSourceHostElementTag(tag.text)) {
        hosts.push({
          element: node,
          ordinal,
          tagName: tag.text.toLowerCase(),
          isInsideConditionalOrMappedExpression:
            isInsideConditionalOrMappedExpression(node),
        });
        ordinal += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hosts;
}

function resolveAuthoredReactTarget(
  selector: string,
  hosts: readonly ReactAuthoredHost[],
  modulePath: string | undefined,
  sourceFile: TypeScript.SourceFile,
  styleRoot: TypeScript.JsxElement | TypeScript.JsxFragment,
): MotionAuthoredCssTargetResolution {
  const parsed = parseMotionAuthoredCssSimpleSelector(selector);
  if (!parsed) return { status: "unresolved" };
  if (parsed.kind !== "id") {
    return {
      status: "unsupported",
      reason:
        "React inline CSS animations can be mapped safely only from a static id selector; type, class, and attribute selectors can also affect elements in other modules.",
    };
  }
  const relevantAttribute = "id";
  const matches: string[] = [];
  for (const host of hosts) {
    const attributes = jsxAttributes(host.element);
    const hasSpread = attributes.some(ts.isJsxSpreadAttribute);
    if (relevantAttribute && hasSpread) return { status: "ambiguous" };
    let matchesSelector = false;
    let hasDynamicSelectorAttribute = false;
    for (const attribute of attributes) {
      if (ts.isJsxSpreadAttribute(attribute)) continue;
      const sourceName = attribute.name.getText();
      const domName = normalizeReactDomAttributeName(sourceName);
      const isRelevant = relevantAttribute === domName;
      if (!isRelevant) continue;
      const value = readStaticJsxAttributeValue(attribute);
      if (value.status !== "static") {
        hasDynamicSelectorAttribute = true;
        continue;
      }
      if (matchesReactSelectorAttribute(parsed, domName, value.value)) {
        matchesSelector = true;
      }
    }
    if (hasDynamicSelectorAttribute) return { status: "ambiguous" };
    if (!matchesSelector) continue;
    if (host.isInsideConditionalOrMappedExpression) {
      return {
        status: "unsupported",
        reason:
          "React inline CSS animations cannot target elements inside conditional or mapped JSX expressions.",
      };
    }

    try {
      if (findComponentRoot(sourceFile, host.element) !== styleRoot) {
        return {
          status: "unsupported",
          reason:
            "React inline CSS animations can only be adopted when the matching target belongs to the same component as the style element.",
        };
      }
    } catch {
      return {
        status: "unsupported",
        reason:
          "React inline CSS animations cannot be adopted when the matching target has no static component root.",
      };
    }

    const identity = readReactAuthoredNodeId(host, modulePath);
    if (identity.status !== "resolved") return identity;
    matches.push(identity.targetNodeId);
  }
  if (matches.length === 0) return { status: "unresolved" };
  if (matches.length !== 1) return { status: "ambiguous" };
  return { status: "resolved", targetNodeId: matches[0]! };
}

function readReactAuthoredNodeId(
  host: ReactAuthoredHost,
  modulePath: string | undefined,
): MotionAuthoredCssTargetResolution {
  const attributes = jsxAttributes(host.element);
  if (attributes.some(ts.isJsxSpreadAttribute)) return { status: "ambiguous" };
  const identityAttributes = attributes.filter(
    (attribute): attribute is TypeScript.JsxAttribute =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText() === NODE_ID_ATTRIBUTE,
  );
  if (identityAttributes.length > 1) return { status: "ambiguous" };
  if (identityAttributes.length === 1) {
    const identity = readStaticJsxAttributeValue(identityAttributes[0]!);
    if (
      identity.status !== "static" ||
      !/^[A-Za-z0-9_-]+$/.test(identity.value)
    ) {
      return { status: "ambiguous" };
    }
    return { status: "resolved", targetNodeId: identity.value };
  }
  if (!modulePath) return { status: "unresolved" };
  return {
    status: "resolved",
    targetNodeId: generatedMotionNodeId(modulePath, host.ordinal),
  };
}

function readStaticJsxAttributeValue(
  attribute: TypeScript.JsxAttribute,
): { status: "static"; value: string } | { status: "dynamic" } {
  if (!attribute.initializer) return { status: "static", value: "" };
  if (ts.isStringLiteral(attribute.initializer)) {
    return { status: "static", value: attribute.initializer.text };
  }
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    (ts.isStringLiteral(attribute.initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(attribute.initializer.expression))
  ) {
    return {
      status: "static",
      value: attribute.initializer.expression.text,
    };
  }
  return { status: "dynamic" };
}

function normalizeReactDomAttributeName(name: string): string {
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  return name.toLowerCase();
}

function matchesReactSelectorAttribute(
  selector: MotionAuthoredCssSimpleSelector,
  attributeName: string,
  value: string,
): boolean {
  if (selector.kind === "type") return false;
  if (selector.kind === "id") {
    return attributeName === "id" && value === selector.value;
  }
  if (selector.kind === "class") {
    return (
      attributeName === "class" &&
      value.split(/[\t\n\f\r ]+/).includes(selector.value)
    );
  }
  if (attributeName !== selector.name) return false;
  return selector.value === undefined || value === selector.value;
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
  const requestedNodeIds = new Set(targetNodeIds);
  const elements = new Map<
    string,
    Array<{
      element: TypeScript.JsxElement | TypeScript.JsxSelfClosingElement;
      needsAuthoredNodeId: boolean;
      isInsideConditionalOrMappedExpression: boolean;
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
        const conditionalOrMappedExpression =
          isInsideConditionalOrMappedExpression(node);
        if (conditionalOrMappedExpression && requestedNodeIds.has(nodeId)) {
          throw new MotionReactSourceError(
            "unsupported-authored-motion",
            "React Motion targets inside conditional or mapped JSX expressions are unsupported.",
          );
        }
        const matches = elements.get(nodeId) ?? [];
        matches.push({
          element: node,
          needsAuthoredNodeId: !hasStaticId,
          isInsideConditionalOrMappedExpression: conditionalOrMappedExpression,
        });
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
    const {
      element,
      needsAuthoredNodeId,
      isInsideConditionalOrMappedExpression,
    } = matches[0];
    if (isInsideConditionalOrMappedExpression) {
      throw new MotionReactSourceError(
        "unsupported-authored-motion",
        "React Motion targets inside conditional or mapped JSX expressions are unsupported.",
      );
    }
    return {
      nodeId,
      element,
      needsAuthoredNodeId,
    };
  });
}

function isInsideConditionalOrMappedExpression(node: TypeScript.Node): boolean {
  for (
    let current: TypeScript.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (ts.isConditionalExpression(current)) return true;
    if (
      ts.isBinaryExpression(current) &&
      (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return true;
    }
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "map"
    ) {
      return true;
    }
  }
  return false;
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
      // JSX has no source-version marker, so omitted whitespace settings keep the legacy default.
      const decoded = normalizeReactMotionTextDocument({
        version: MOTION_TEXT_SOURCE_VERSION,
        animations: animationValues.map((animation) => {
          if (
            animation === null ||
            typeof animation !== "object" ||
            Array.isArray(animation) ||
            "ignoreSpaces" in animation
          ) {
            return animation;
          }
          return { ...animation, ignoreSpaces: true };
        }),
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
