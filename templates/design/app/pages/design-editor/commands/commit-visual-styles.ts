import type { CodeLayerProjection } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import type { InteractionState } from "@shared/interaction-states";
import { isRunningAppSourceType } from "@shared/source-mode";
import { sourceContentHash } from "@shared/source-workspace";
import { isVectorEndpointProperty } from "@shared/vector-endpoints";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import {
  clearAuthoredSizeStylesForCommit,
  patchAuthoredInlineStyles,
} from "@/components/design/edit-panel/interaction-state-helpers";
import {
  isShaderWriteInFlight,
  waitForShaderWriteToSettle,
} from "@/components/design/inspector/GlslShaderPanel";
import type { ElementInfo } from "@/components/design/types";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  codeLayerSelectorAliases,
  codeLayerSelectorMatches,
  elementInfoIsRuntimeOnly,
  ensureGoogleFontLinkInHtml,
  isClientRenderedMountShell,
  preferredCodeLayerSelector,
  resolveCodeLayerTargetFromBridge,
  resolveCodeLayerTargetFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import {
  canWriteCollabText,
  writeCollabText,
} from "@/pages/design-editor/collab-sync";
import type {
  LiveScreenSnapshot,
  PatchProofState,
  ResponsiveEditScope,
} from "@/pages/design-editor/command-types";
import { clearAutoTextColorMarkerOnExplicitColorCommit } from "@/pages/design-editor/cross-screen-text-color";
import {
  LOCAL_EDIT_ORIGIN,
  TAB_ID,
} from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import {
  isStandaloneHttpUrl,
  previewContentReplaceNeedsRenderFallback,
  shouldReplacePreviewAfterVisualStyleCommit,
} from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
} from "@/pages/design-editor/history";
import {
  applyScopedVisualStyleEdit,
  replayPendingVisualStyleRuntimePatch,
  resolveVisualStyleCommitContent,
  runtimeStyleTarget,
} from "@/pages/design-editor/pending-edits";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import { applyInlineStylesToHtml } from "@/pages/design-editor/screen-command-utils";
import type { DesignFile } from "@/pages/design-editor/types";

import { prepareCanonicalSourceContent } from "../source-publication";

export interface CommitVisualStylesArgs {
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeCodeLayerProjection: CodeLayerProjection;
  activeFile: DesignFile;
  activeProjectionContent: string;
  canEditDesign: boolean;
  canApplyContentEdit: (fileId: string) => boolean;
  onNoRenderedBox?: () => void;
  applyLinkedComponentEdit?: (
    fileId: string,
    nodeId: string,
    edit: { kind: "styleBatch"; values: Record<string, string> },
  ) => void;
  commitVisualStyles: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      runtimeApplied?: boolean;
      elementInfo?: ElementInfo;
      originalStyles?: Record<string, string>;
      pendingUndoGestureId?: string;
      preserveSelection?: boolean;
      routePath?: string;
    },
  ) => void;
  isSynced: boolean;
  getScreenContent: (fileId: string) => string;
  lastDuplicateTransformRef: RefObject<{
    rootNodeIds: string[];
    dx: number;
    dy: number;
  } | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options: {
      expectedVersionHash: string;
      syncCollab?: boolean;
      immediate?: boolean;
    },
  ) => void;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  recordLocalContentHistoryChangeFallback: (
    change: ContentHistoryChange,
  ) => void;
  recordLocalContentHistoryEntry: (change: ContentHistoryChange) => void;
  recordPendingVisualStyleEdit: (
    screenId: string,
    selector: string,
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    metadata?: {
      originalStyles?: Record<string, string>;
      interactionState?: InteractionState;
      pendingUndoGestureId?: string;
      preserveSelection?: boolean;
      routePath?: string;
    },
  ) => void;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  selectedElement: ElementInfo | null;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setPatchProof: Dispatch<SetStateAction<PatchProofState | null>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  suppressContentHistoryRef: RefObject<boolean>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  upsertMotionKeyframesFromStyles: (
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    selector?: string,
  ) => void;
  viewModeRef: RefObject<"single" | "overview">;
  ydoc: Y.Doc | null;
}

export function styleWriteIsRetargeted(
  selector: unknown,
  selectedElement: ElementInfo | null | undefined,
): boolean {
  return (
    typeof selector === "string" &&
    selector.length > 0 &&
    typeof selectedElement?.selector === "string" &&
    selectedElement.selector.length > 0 &&
    selector !== selectedElement.selector
  );
}

export function runCommitVisualStyles(
  {
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthStateRef,
    activeCanvasSourceType,
    activeCodeLayerProjection,
    activeFile,
    activeProjectionContent,
    applyLinkedComponentEdit,
    canApplyContentEdit,
    canEditDesign,
    commitVisualStyles,
    getScreenContent,
    isSynced,
    lastDuplicateTransformRef,
    lastLocalContentRef,
    latestActiveContentRef,
    liveScreenSnapshotsById,
    onNoRenderedBox,
    queueFileContentSave,
    recordContentHistoryEntry,
    recordLocalContentHistoryChangeFallback,
    recordLocalContentHistoryEntry,
    recordPendingVisualStyleEdit,
    replacePreviewContent,
    responsiveEditScopeRef,
    selectedElement,
    setCollabContent,
    setCollabContentFileId,
    setContentRenderRevision,
    setPatchProof,
    setSelectedElement,
    setSelectedLayerIdsState,
    suppressContentHistoryRef,
    t,
    undoManagerRef,
    updateLiveScreenSnapshotContent,
    upsertMotionKeyframesFromStyles,
    viewModeRef,
    ydoc,
  }: CommitVisualStylesArgs,
  selector: string,
  styles: Record<string, string>,
  options: {
    runtimeApplied?: boolean;
    elementInfo?: ElementInfo;
    originalStyles?: Record<string, string>;
    pendingUndoGestureId?: string;
    preserveSelection?: boolean;
    routePath?: string;
  } = {},
) {
  trace("persist", "commit-styles", {
    selector: typeof selector === "string" ? selector : null,
    props: Object.keys(styles ?? {}),
  });
  if (!activeFile || !canEditDesign) return;
  if (!canApplyContentEdit(activeFile.id)) return;
  if (isShaderWriteInFlight(activeFile.id)) {
    void waitForShaderWriteToSettle(activeFile.id).then(() => {
      commitVisualStyles(selector, styles, options);
    });
    return;
  }
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return;
  const liveTargetInfo = isRunningAppSourceType(activeCanvasSourceType)
    ? (options.elementInfo ?? selectedElement ?? undefined)
    : undefined;
  if (
    liveTargetInfo &&
    (liveTargetInfo.boundingRect.width <= 0 ||
      liveTargetInfo.boundingRect.height <= 0)
  ) {
    if (options.runtimeApplied && options.originalStyles) {
      const runtimePatch = {
        screenId: activeFile.id,
        selector,
        sourceId: liveTargetInfo.sourceId,
        runtimeSelector: liveTargetInfo.runtimeSelector,
        runtimeSourceId: liveTargetInfo.runtimeSourceId,
        ...(options.routePath ? { routePath: options.routePath } : {}),
        styles: options.originalStyles,
      };
      const sendStyleChangeForScreen = (window as any)
        .__designCanvasSendStyleForScreen;
      const sendStyleChange = (window as any).__designCanvasSendStyle;
      if (typeof sendStyleChangeForScreen === "function") {
        replayPendingVisualStyleRuntimePatch(
          runtimePatch,
          sendStyleChangeForScreen,
        );
      } else if (typeof sendStyleChange === "function") {
        const target = runtimeStyleTarget(runtimePatch);
        Object.entries(runtimePatch.styles).forEach(([property, value]) => {
          sendStyleChange(target.selector, property, value, {
            selectorCandidates: target.selectorCandidates,
            nodeId: target.nodeId,
          });
        });
      }
    }
    onNoRenderedBox?.();
    return;
  }
  upsertMotionKeyframesFromStyles(styles, options.elementInfo, selector);
  if (isRunningAppSourceType(activeCanvasSourceType)) {
    const targetInfo = liveTargetInfo;
    if (
      !options.runtimeApplied &&
      activeBreakpointUpperBoundPx == null &&
      typeof (window as any).__designCanvasSendStyleForScreen === "function"
    ) {
      replayPendingVisualStyleRuntimePatch(
        {
          screenId: activeFile.id,
          selector,
          sourceId: targetInfo?.runtimeSourceId ?? targetInfo?.sourceId ?? null,
          routePath: options.routePath,
          styles: Object.fromEntries(entries),
        },
        (window as any).__designCanvasSendStyleForScreen,
      );
    }
    recordPendingVisualStyleEdit(activeFile.id, selector, styles, targetInfo, {
      originalStyles: options.originalStyles,
      pendingUndoGestureId: options.pendingUndoGestureId,
      preserveSelection: options.preserveSelection,
      routePath: options.routePath,
    });
    return;
  }
  const activeLiveSnapshot = isRunningAppSourceType(activeCanvasSourceType)
    ? activeFile
      ? liveScreenSnapshotsById[activeFile.id]
      : undefined
    : undefined;
  const baseContent = getScreenContent(activeFile.id);
  if (isStandaloneHttpUrl(baseContent)) {
    toast.error(t("designEditor.patchProof.snapshotNotLoaded"), {
      duration: 4000,
    });
    return;
  }
  const [firstProperty, firstValue] = entries[0];
  const projection =
    baseContent === activeProjectionContent
      ? activeCodeLayerProjection
      : buildCodeLayerProjection(baseContent, {
          source: activeCodeLayerProjection.source,
        });
  const carriedInfo = options.elementInfo ?? selectedElement;
  const targetInfo = styleWriteIsRetargeted(selector, carriedInfo)
    ? null
    : carriedInfo;
  const targetResolution = targetInfo
    ? resolveCodeLayerTargetFromElementInfo(projection, targetInfo)
    : resolveCodeLayerTargetFromBridge(projection, selector);
  const targetNode =
    targetResolution.status === "resolved" ? targetResolution.node : null;
  const sendStyleChange = (window as any).__designCanvasSendStyle;
  const targetIsSvg =
    (targetNode?.tag ?? targetInfo?.tagName)?.toLowerCase() === "svg";
  const runtimeStyleApplied =
    !entries.some(
      ([property]) =>
        property === "--an-vector-stroke-position" ||
        isVectorEndpointProperty(property) ||
        (targetIsSvg &&
          /^border(-[a-z]+)*-radius$|^border\w*Radius$/.test(property)) ||
        (targetIsSvg &&
          (property === "width" || property === "height") &&
          targetNode?.dataAttributes["data-figma-node-id"] !== undefined &&
          targetNode.attributes["preserveaspectratio"] === undefined),
    ) &&
    !options.runtimeApplied &&
    activeBreakpointUpperBoundPx == null &&
    typeof sendStyleChange === "function";
  const sendRuntimeStylePreview = (): void => {
    if (!runtimeStyleApplied) return;
    const selectorCandidates = targetNode
      ? codeLayerSelectorAliases(targetNode)
      : Array.from(
          new Set(
            [
              selector,
              targetInfo?.runtimeSelector,
              targetInfo?.selector,
            ].filter((candidate): candidate is string => Boolean(candidate)),
          ),
        );
    const nodeId = targetNode
      ? bridgeSourceIdForCodeLayerNode(targetNode)
      : (targetInfo?.runtimeSourceId ?? targetInfo?.sourceId);
    entries.forEach(([property, value]) => {
      sendStyleChange(selector, property, value, {
        selectorCandidates,
        nodeId,
      });
    });
  };

  if (targetNode && linkedComponentRootForNode(targetNode, projection)) {
    const durableNodeId =
      targetNode.dataAttributes["data-agent-native-node-id"];
    const lowerBoundPx =
      responsiveEditScopeRef.current === "only"
        ? (activeBreakpointWidthStateRef.current ?? null)
        : null;
    if (activeBreakpointUpperBoundPx !== null || lowerBoundPx !== null) {
      toast.error(
        t("designEditor.componentInstances.linkedEditScopeUnsupported"),
        { duration: 4000 },
      );
      return;
    }
    if (!durableNodeId) {
      toast.error(t("designEditor.patchProof.selectorMissing"), {
        duration: 4000,
      });
      return;
    }
    if (!applyLinkedComponentEdit) {
      toast.error(
        t("designEditor.componentInstances.linkedEditSourceUnsupported"),
        { duration: 4000 },
      );
      return;
    }
    sendRuntimeStylePreview();
    applyLinkedComponentEdit(activeFile.id, durableNodeId, {
      kind: "styleBatch",
      values: Object.fromEntries(entries),
    });
    return;
  }

  if (targetNode && lastDuplicateTransformRef.current) {
    const nodeId =
      targetNode.dataAttributes["data-agent-native-node-id"] ?? targetNode.id;
    if (lastDuplicateTransformRef.current.rootNodeIds.includes(nodeId)) {
      const nextLeft = parseFloat(styles.left ?? "");
      const nextTop = parseFloat(styles.top ?? "");
      const prevLeft = parseFloat(targetNode.style.left ?? "");
      const prevTop = parseFloat(targetNode.style.top ?? "");
      if (
        Number.isFinite(nextLeft) &&
        Number.isFinite(nextTop) &&
        Number.isFinite(prevLeft) &&
        Number.isFinite(prevTop)
      ) {
        lastDuplicateTransformRef.current = {
          ...lastDuplicateTransformRef.current,
          dx: nextLeft - prevLeft,
          dy: nextTop - prevTop,
        };
      }
    }
  }
  const capability =
    selectedElement?.editCapabilities?.find((item) =>
      item.kind.startsWith("deterministic"),
    ) ?? selectedElement?.editCapabilities?.[0];
  const proofId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (!targetNode && elementInfoIsRuntimeOnly(targetInfo)) {
    const resolutionFailure =
      targetResolution.status === "ambiguous"
        ? t("designEditor.patchProof.selectorAmbiguous", {
            count: targetResolution.candidates.length,
          })
        : isClientRenderedMountShell(projection)
          ? t("designEditor.patchProof.clientRenderedShell")
          : t("designEditor.patchProof.selectorMissing");
    toast.error(resolutionFailure, {
      duration: 4000,
    });
    setPatchProof({
      id: proofId,
      fileId: activeFile.id,
      filename: activeFile.filename,
      selector,
      sourceId: targetInfo?.sourceId,
      property:
        entries.length === 1
          ? firstProperty
          : entries.map(([property]) => property).join(", "),
      previousValue: targetInfo?.computedStyles?.[firstProperty],
      nextValue:
        entries.length === 1
          ? firstValue
          : entries
              .map(([property, value]) => `${property}: ${value}`)
              .join("; "),
      previousContent: baseContent,
      capability: "unsupported",
      confidence: 0.3,
      status: "failed",
      error: resolutionFailure,
      createdAt: Date.now(),
    });
    return;
  }
  setPatchProof({
    id: proofId,
    fileId: activeFile.id,
    filename: activeFile.filename,
    selector,
    sourceId: selectedElement?.sourceId,
    property:
      entries.length === 1
        ? firstProperty
        : entries.map(([property]) => property).join(", "),
    previousValue: selectedElement?.computedStyles?.[firstProperty],
    nextValue:
      entries.length === 1
        ? firstValue
        : entries
            .map(([property, value]) => `${property}: ${value}`)
            .join("; "),
    previousContent: baseContent,
    capability: capability?.kind ?? "deterministic-style-edit",
    confidence: capability?.confidence ?? 0.92,
    status: "runtime",
    createdAt: Date.now(),
  });
  sendRuntimeStylePreview();

  const nextContent = applyInlineStylesToHtml(baseContent, selector, {
    ...Object.fromEntries(entries),
  });
  // guard:allow-raw-color - prose naming CSS value kinds, not a color literal
  const stylePatch = entries.reduce<{
    content: string;
    failed: string | null;
  }>(
    (current, [property, value]) => {
      if (current.failed) return current;
      const patch = applyScopedVisualStyleEdit({
        content: current.content,
        target: targetNode ? { nodeId: targetNode.id } : { selector },
        property,
        value,
        source: projection.source,
        upperBoundPx: activeBreakpointUpperBoundPx,
        lowerBoundPx:
          responsiveEditScopeRef.current === "only"
            ? activeBreakpointWidthStateRef.current
            : null,
      });
      if (patch.result.status !== "applied") {
        return {
          content: current.content,
          failed: codeLayerPatchMessage(
            patch.result.message,
            t("designEditor.patchProof.selectorMissing"),
          ),
        };
      }
      return { content: patch.content, failed: null };
    },
    { content: baseContent, failed: null },
  );
  const commitResolution = resolveVisualStyleCommitContent({
    scopedContent: stylePatch.content,
    scopedFailure: stylePatch.failed,
    legacyFallbackContent: nextContent,
    breakpointScoped: activeBreakpointUpperBoundPx != null,
  });
  if ("error" in commitResolution) {
    const failureMessage = codeLayerPatchMessage(
      commitResolution.error,
      t("designEditor.patchProof.selectorMissing"),
    );
    toast.error(failureMessage, { duration: 4000 });
    setPatchProof((prev) =>
      prev?.id === proofId
        ? { ...prev, status: "failed", error: failureMessage }
        : prev,
    );
    return;
  }
  const resolvedNextContentBeforeFontLink = commitResolution.content;

  const fontFamilyValue = Object.fromEntries(entries).fontFamily;
  const resolvedNextContentAfterFontLink = fontFamilyValue
    ? ensureGoogleFontLinkInHtml(
        resolvedNextContentBeforeFontLink,
        fontFamilyValue,
      )
    : resolvedNextContentBeforeFontLink;

  const committedNodeId =
    targetNode?.dataAttributes["data-agent-native-node-id"];
  const unpreparedNextContent =
    "color" in Object.fromEntries(entries) && committedNodeId
      ? clearAutoTextColorMarkerOnExplicitColorCommit(
          resolvedNextContentAfterFontLink,
          committedNodeId,
        )
      : resolvedNextContentAfterFontLink;
  const resolvedNextContent = prepareCanonicalSourceContent(
    unpreparedNextContent,
    {
      fileId: activeFile.id,
      fileType: activeFile.fileType,
    },
  ).content;

  try {
    assertDesignHtmlEditIntegrity({
      previousContent: baseContent,
      nextContent: resolvedNextContent,
      fileType: activeFile.fileType,
    });
  } catch (error) {
    const message = designSaveErrorMessage(error) ?? t("common.genericError");
    toast.error(message, {
      id: `design-source-integrity:${activeFile.id}`,
    });
    setPatchProof((previous) =>
      previous?.id === proofId
        ? { ...previous, status: "failed", error: message }
        : previous,
    );
    return;
  }

  const nextProjection = buildCodeLayerProjection(resolvedNextContent, {
    source: projection.source,
  });
  const resolvedNode = selectedElement
    ? nextProjection.nodes.find((node) => {
        const aliases = codeLayerSelectorAliases(node);
        return (
          (selectedElement.sourceId &&
            (node.id === selectedElement.sourceId ||
              node.dataAttributes["data-agent-native-node-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-code-layer-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-layer-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-builder-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-loc"] === selectedElement.sourceId ||
              node.attributes.id === selectedElement.sourceId)) ||
          aliases.includes(selector) ||
          codeLayerSelectorMatches(node, selector)
        );
      })
    : null;
  const liveSnapshotUpdated = activeLiveSnapshot
    ? updateLiveScreenSnapshotContent(activeFile.id, resolvedNextContent)
    : false;
  if (liveSnapshotUpdated) {
    setPatchProof((prev) =>
      prev?.id === proofId ? { ...prev, status: "queued" } : prev,
    );
    if (!runtimeStyleApplied) {
      setContentRenderRevision((revision) => revision + 1);
    }
  } else {
    const writeLiveDoc = canWriteCollabText(ydoc, isSynced, baseContent);
    const yjsHistoryAvailable = Boolean(
      viewModeRef.current !== "overview" &&
      writeLiveDoc &&
      undoManagerRef.current,
    );
    if (
      !yjsHistoryAvailable &&
      !suppressContentHistoryRef.current &&
      baseContent !== resolvedNextContent
    ) {
      const change = {
        fileId: activeFile.id,
        before: baseContent,
        after: resolvedNextContent,
      };
      if (viewModeRef.current === "overview") {
        recordContentHistoryEntry(change);
      } else {
        recordLocalContentHistoryEntry(change);
      }
    } else if (
      yjsHistoryAvailable &&
      !suppressContentHistoryRef.current &&
      baseContent !== resolvedNextContent
    ) {
      recordLocalContentHistoryChangeFallback({
        fileId: activeFile.id,
        before: baseContent,
        after: resolvedNextContent,
      });
    }

    setCollabContent(resolvedNextContent);
    setCollabContentFileId(activeFile.id);
    setPatchProof((prev) =>
      prev?.id === proofId ? { ...prev, status: "queued" } : prev,
    );
    lastLocalContentRef.current = resolvedNextContent;
    latestActiveContentRef.current = resolvedNextContent;
    if (ydoc && writeLiveDoc) {
      const ytext = ydoc.getText("content");
      if (ytext.toJSON() !== resolvedNextContent) {
        if (!yjsHistoryAvailable) {
          undoManagerRef.current?.clear(true, false);
        }
        writeCollabText(
          ydoc,
          ytext,
          resolvedNextContent,
          yjsHistoryAvailable ? LOCAL_EDIT_ORIGIN : TAB_ID,
        );
      }
    }
    queueFileContentSave(activeFile.id, resolvedNextContent, {
      expectedVersionHash: sourceContentHash(baseContent),
      syncCollab: !writeLiveDoc,
    });
    if (
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: options.runtimeApplied,
        runtimeStyleApplied,
      }) &&
      previewContentReplaceNeedsRenderFallback(
        replacePreviewContent(resolvedNextContent, selector),
      )
    ) {
      setContentRenderRevision((revision) => revision + 1);
    }
  }
  if (options.preserveSelection) return;
  if (resolvedNode) {
    setSelectedLayerIdsState((current) =>
      current.includes(resolvedNode.id) ? current : [resolvedNode.id],
    );
  }
  setSelectedElement((prev) => {
    const committed = Object.fromEntries(entries);
    if (options.elementInfo) {
      return {
        ...options.elementInfo,
        computedStyles: {
          ...options.elementInfo.computedStyles,
          ...committed,
        },
        inlineStyles: patchAuthoredInlineStyles(
          options.elementInfo.inlineStyles,
          committed,
        ),
        authoredSizeStyles: clearAuthoredSizeStylesForCommit(
          options.elementInfo.authoredSizeStyles,
          committed,
        ),
      };
    }
    if (!prev) return prev;
    const stablePatch = resolvedNode
      ? {
          sourceId: bridgeSourceIdForCodeLayerNode(resolvedNode),
          selector: preferredCodeLayerSelector(resolvedNode),
          classes: resolvedNode.classes,
        }
      : {};
    return {
      ...prev,
      ...stablePatch,
      computedStyles: { ...prev.computedStyles, ...committed },
      inlineStyles: patchAuthoredInlineStyles(prev.inlineStyles, committed),
      authoredSizeStyles: clearAuthoredSizeStylesForCommit(
        prev.authoredSizeStyles,
        committed,
      ),
    };
  });
}
