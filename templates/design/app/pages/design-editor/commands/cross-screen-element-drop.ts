import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  moveNodeBetweenDocuments,
  resolveCodeLayerTarget,
} from "@shared/code-layer";
import { resolveSourceNodeProvenance } from "@shared/preview-source-provenance";
import { isRunningAppSourceType } from "@shared/source-mode";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import { dndHostLog } from "@/components/design/dnd-debug";
import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import { validateCrossScreenSourceHtmlSnapshot } from "@/components/design/multi-screen/cross-screen-drop";
import { getPrimaryIframeId } from "@/components/design/multi-screen/iframe-targeting";
import type {
  ElementInfo,
  PortableStyleSnapshot,
  RuntimeStructureDeleteRequest,
  RuntimeStructureInsertRequest,
  RuntimeStructureRollbackRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSelectorAliases,
  codeLayerSelectorMatches,
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromBridge,
} from "@/pages/design-editor/code-layer-state";
import { adaptAutoTextColorForCrossScreenNode } from "@/pages/design-editor/cross-screen-text-color";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  captureContentUndoStackTop,
  stampContentHistorySelectionAfter,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";
import {
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import { applyPortableStyleSnapshotToHtml } from "@/pages/design-editor/portable-style";
import { resolveRuntimeStructureMoveExecutionMode } from "@/pages/design-editor/react-semantic-handoff";

import {
  insertClonedHtmlLayers,
  prepareClonedHtmlLayersForLiveInsert,
} from "../clone-and-pen-edit";
import { prepareAcceptedSourceContent } from "../source-publication";
import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { FileContentSaveCompletion } from "./save-file-content";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

/** Empty generated screens strip absolute positioning, so a flow-insert
 * into an empty body parks the node at 0,0. Drop at the pointer instead. */
export function shouldAbsolutePlaceOnEmptyScreen({
  destHtml,
  targetLocalPoint,
}: {
  destHtml: string;
  targetLocalPoint?: { x: number; y: number } | null;
}): boolean {
  if (!targetLocalPoint) return false;
  if (typeof DOMParser === "undefined") return false;
  // Live-app destinations store a URL, not HTML — do not treat that as empty.
  if (!/<body[\s>]/i.test(destHtml)) return false;
  const doc = new DOMParser().parseFromString(destHtml, "text/html");
  return (doc.body?.children.length ?? 0) === 0;
}

function absoluteDropPoint(
  targetLocalPoint: { x: number; y: number },
  targetAnchorRect?: { left: number; top: number } | null,
): { x: number; y: number } {
  if (!targetAnchorRect) return targetLocalPoint;
  return {
    x: targetLocalPoint.x - targetAnchorRect.left,
    y: targetLocalPoint.y - targetAnchorRect.top,
  };
}

/** Empty-screen drops must keep pointer coords. A leftover hit-test rect
 * would subtract the previous screen's origin and park the layer at 0,0. */
export function absolutePlacePointForDrop(args: {
  placeAbsoluteOnEmptyScreen: boolean;
  targetAnchorRect?: { left: number; top: number } | null;
  targetLocalPoint: { x: number; y: number };
}): { x: number; y: number } {
  if (args.placeAbsoluteOnEmptyScreen) return args.targetLocalPoint;
  return absoluteDropPoint(args.targetLocalPoint, args.targetAnchorRect);
}

export function releaseCrossScreenDropAdmission(
  pendingTransactionRef: RefObject<string | null> | undefined,
  transactionId: string | undefined,
): boolean {
  if (
    !transactionId ||
    !pendingTransactionRef ||
    pendingTransactionRef.current !== transactionId
  ) {
    return false;
  }
  pendingTransactionRef.current = null;
  return true;
}

export function resolveCrossScreenMoveFailureRecovery(args: {
  reason: string;
  transactionId: string;
  insertRequest: (RuntimeStructureInsertRequest & { screenId: string }) | null;
  sourceDeleteRequest:
    | (RuntimeStructureDeleteRequest & { screenId: string })
    | null;
  rollbackRequestId: string;
  pendingTransactionRef?: RefObject<string | null>;
}): {
  admissionReleased: boolean;
  rollbackRequest:
    | (RuntimeStructureRollbackRequest & { screenId: string })
    | null;
  sourceDeleteRequest:
    | (RuntimeStructureDeleteRequest & { screenId: string })
    | null
    | undefined;
} {
  const insertRequest =
    args.insertRequest?.transactionId === args.transactionId
      ? args.insertRequest
      : null;
  const sourceDeleteRequest =
    args.sourceDeleteRequest?.transactionId === args.transactionId
      ? args.sourceDeleteRequest
      : null;
  const needsRollback =
    args.reason === "board-drop-timeout" ||
    args.reason === "cross-screen-insert-timeout" ||
    args.reason === "target-canvas-unmounted" ||
    args.reason === "target-document-replaced" ||
    Boolean(sourceDeleteRequest?.rollbackSelector);
  const rollbackScreenId =
    sourceDeleteRequest?.rollbackScreenId ?? insertRequest?.screenId;
  const rollbackRequest =
    needsRollback && rollbackScreenId
      ? {
          screenId: rollbackScreenId,
          requestId: args.rollbackRequestId,
          transactionId: args.transactionId,
          selector: sourceDeleteRequest?.rollbackSelector ?? "",
          sourceId: sourceDeleteRequest?.rollbackSourceId,
          idempotent: true,
        }
      : null;
  const sourceWasRemoved = Boolean(
    sourceDeleteRequest &&
    (sourceDeleteRequest.cancelRequested ||
      sourceDeleteRequest.waitForInsertTransaction !== true ||
      sourceDeleteRequest.rollbackSelector),
  );

  return {
    admissionReleased: rollbackRequest
      ? false
      : releaseCrossScreenDropAdmission(
          args.pendingTransactionRef,
          args.transactionId,
        ),
    rollbackRequest,
    sourceDeleteRequest: sourceDeleteRequest
      ? sourceWasRemoved
        ? {
            ...sourceDeleteRequest,
            cancelRequested: true,
            rollbackSelector: undefined,
            rollbackSourceId: undefined,
          }
        : null
      : undefined,
  };
}

export interface CrossScreenElementDropArgs {
  getCurrentFileSnapshot?: (fileId: string) => {
    content: string;
    updatedAt?: string | null;
  };
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      awaitSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      sourceBaseContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  canEditLiveScreen?: (screenId: string) => boolean;
  canEditLiveBoard?: boolean;
  clearPendingOverviewLayerSelectionTimer: () => void;
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
  designSourceType: "inline" | "localhost" | "fusion";
  fileSaveOperationRevisionRef?: RefObject<Record<string, number>>;
  fileHistoryMutationPendingRef?: RefObject<boolean>;
  getScreenContent: (screenId: string) => string;
  getCurrentSelectionFingerprint?: () => string;
  id: string | undefined;
  overviewScreens: OverviewScreen[];
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  contentUndoStackRef?: RefObject<ContentHistoryEntry[]>;
  contentHistorySelectionAfterRef?: RefObject<ContentHistorySelectionAfterMap>;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  clearPendingHistory?: () => void;
  syncUndoRedoState?: () => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  runtimeStructurePendingTransactionRef?: RefObject<string | null>;
  sendRuntimeLayerMoveSemanticHandoff: (
    subjectLayerId: string,
    targetLayerId: string,
    placement: "before" | "after" | "inside",
  ) => boolean;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  setRuntimeStructureDeleteRequest?: Dispatch<
    SetStateAction<
      (RuntimeStructureDeleteRequest & { screenId: string }) | null
    >
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runCrossScreenElementDrop(
  {
    applyFileContentUpdate,
    boardFileId,
    canEditDesign,
    canEditLiveScreen,
    canEditLiveBoard = false,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeIdRef,
    designSourceType,
    fileHistoryMutationPendingRef,
    getCurrentFileSnapshot,
    fileSaveOperationRevisionRef,
    getScreenContent,
    getCurrentSelectionFingerprint,
    id,
    overviewScreens,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    contentUndoStackRef,
    contentHistorySelectionAfterRef,
    recordContentHistoryEntry,
    clearPendingHistory,
    syncUndoRedoState,
    runtimeStructureInsertRevisionRef,
    runtimeStructurePendingTransactionRef,
    sendRuntimeLayerMoveSemanticHandoff,
    setActiveFileId,
    setCreatedOverviewLayerSelection,
    setOverviewSelectedScreenIds,
    setRuntimeStructureInsertRequest,
    setRuntimeStructureDeleteRequest,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    viewModeRef,
  }: CrossScreenElementDropArgs,
  {
    sourceSelector,
    sourceNodeId,
    sourceDeleteRequestId,
    sourceScreenId,
    targetScreenId,
    targetAnchorNodeId,
    targetAnchorPendingNodeId,
    targetAnchorSelector,
    targetAnchorPlacement,
    targetDropMode,
    targetAnchorRect,
    targetLocalPoint,
    sourcePointerOffset,
    sourceComputedSize,
    sourceHtmlSnapshot,
    sourceProvenance,
    targetAnchorProvenance,
    duplicate,
    sourceCloneHtml,
    styleSnapshot,
    styleSnapshotCaptureFailed,
  }: {
    sourceSelector: string;
    sourceNodeId?: string;
    sourceDeleteRequestId?: string;
    sourceScreenId: string;
    targetScreenId: string;
    targetAnchorNodeId?: string;
    targetAnchorPendingNodeId?: string;
    targetAnchorSelector?: string;
    targetAnchorPlacement?: "before" | "after" | "inside";
    targetDropMode?: "flow-insert" | "absolute-container";
    targetAnchorRect?: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    targetCanvasPoint?: { x: number; y: number };
    targetLocalPoint?: { x: number; y: number };
    sourcePointerOffset?: { x: number; y: number };
    sourceComputedSize?: { width?: number; height?: number };
    sourceHtmlSnapshot?: string;
    sourceProvenance?: unknown;
    targetAnchorProvenance?: unknown;
    duplicate?: boolean;
    sourceCloneHtml?: string;
    styleSnapshot?: PortableStyleSnapshot;
    styleSnapshotCaptureFailed?: boolean;
  },
) {
  dndHostLog("persist:cross-screen", {
    sourceScreenId,
    targetScreenId,
    targetAnchorPlacement,
    targetDropMode,
  });
  // The bridge could not measure the bare-tag probe for this move — a
  // class-only appearance (color/background/etc. authored only by a
  // stylesheet rule, never inline) would be silently dropped once this node
  // lands in a destination screen without that rule. Refuse the whole move
  // at this boundary: source untouched, destination untouched. Distinct from
  // a legitimately absent snapshot (`styleSnapshot === undefined`, nothing to
  // carry), which must keep working — see collectPortableStyleSnapshot.
  if (styleSnapshotCaptureFailed) {
    trace("drop", "refused", {
      reason:
        "portable style capture failed — refusing to lose class-only appearance",
      from: sourceScreenId,
      to: targetScreenId,
      node: sourceNodeId ?? sourceSelector,
    });
    dndHostLog("persist:cross-screen-refused", {
      reason: "style-capture-failed",
      sourceScreenId,
      targetScreenId,
    });
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }
  trace("drop", "cross-screen-persist", {
    from: sourceScreenId,
    to: targetScreenId,
    mode: targetDropMode,
    placement: targetAnchorPlacement,
    anchor: targetAnchorNodeId ?? targetAnchorSelector ?? null,
    node: sourceNodeId ?? sourceSelector,
    blocked: !canEditDesign
      ? "read-only design"
      : sourceScreenId === targetScreenId
        ? "same screen — nothing to move"
        : null,
  });
  if (sourceScreenId === targetScreenId) return;

  const findLayerOwner = (
    screenId: string,
    nodeId: string | undefined,
    selector: string | undefined,
  ) => {
    const screenOwners = Array.from(
      codeLayerOwnerByNodeIdRef.current.entries(),
    ).filter(([, owner]) => owner.fileId === screenId);
    const idMatches = nodeId
      ? screenOwners.filter(
          ([candidateId, owner]) =>
            candidateId === nodeId ||
            bridgeSourceIdForCodeLayerNode(owner.node) === nodeId,
        )
      : [];
    if (idMatches.length === 1) return idMatches[0];
    if (idMatches.length > 1) {
      const selectorMatches = selector
        ? idMatches.filter(([, owner]) =>
            codeLayerSelectorMatches(owner.node, selector),
          )
        : [];
      return selectorMatches.length === 1 ? selectorMatches[0] : undefined;
    }
    const selectorMatches = selector
      ? screenOwners.filter(([, owner]) =>
          codeLayerSelectorMatches(owner.node, selector),
        )
      : [];
    return selectorMatches.length === 1 ? selectorMatches[0] : undefined;
  };
  const sourceOwnerEntry = findLayerOwner(
    sourceScreenId,
    sourceNodeId,
    sourceSelector,
  );
  const targetOwnerEntry = findLayerOwner(
    targetScreenId,
    targetAnchorNodeId,
    targetAnchorSelector,
  );
  const targetScreen = overviewScreens.find(
    (screen) => screen.id === targetScreenId,
  );
  const sourceScreen = overviewScreens.find(
    (screen) => screen.id === sourceScreenId,
  );
  const componentLinks =
    id && targetScreen
      ? {
          sourceFileIds: [sourceScreenId],
          targetSource: {
            kind: "design-file" as const,
            designId: id,
            fileId: targetScreen.id,
            filename: targetScreen.filename,
          },
          documents: [
            ...overviewScreens.map((screen) => ({
              id: screen.id,
              filename: screen.filename,
            })),
            ...(boardFileId &&
            !overviewScreens.some((screen) => screen.id === boardFileId)
              ? [{ id: boardFileId, filename: "__board__.html" }]
              : []),
          ].map((file) => ({
            source: {
              kind: "design-file" as const,
              designId: id,
              fileId: file.id,
              filename: file.filename,
            },
            content: getScreenContent(file.id),
          })),
        }
      : undefined;
  const targetScreenIsLive =
    Boolean(targetScreen) &&
    isRunningAppSourceType(
      resolveOverviewScreenSourceType(targetScreen, designSourceType),
    );
  const targetScreenIsBoard =
    Boolean(boardFileId) && targetScreenId === boardFileId;
  const sourceScreenIsBoard =
    Boolean(boardFileId) && sourceScreenId === boardFileId;
  const sourceScreenIsLive =
    Boolean(sourceScreen) &&
    isRunningAppSourceType(
      resolveOverviewScreenSourceType(sourceScreen, designSourceType),
    );
  const canEditLiveCrossScreen =
    sourceScreenIsLive &&
    targetScreenIsLive &&
    Boolean(canEditLiveScreen?.(sourceScreenId)) &&
    Boolean(canEditLiveScreen?.(targetScreenId));
  const canEditLiveBoardDrop =
    canEditLiveBoard &&
    ((sourceScreenIsLive &&
      targetScreenIsBoard &&
      Boolean(canEditLiveScreen?.(sourceScreenId))) ||
      (sourceScreenIsBoard &&
        targetScreenIsLive &&
        Boolean(canEditLiveScreen?.(targetScreenId))));
  const canEditLiveBoardMove =
    canEditLiveBoard &&
    sourceScreenIsLive &&
    targetScreenIsBoard &&
    Boolean(canEditLiveScreen?.(sourceScreenId));
  if (!canEditDesign && !canEditLiveCrossScreen && !canEditLiveBoardDrop)
    return;

  const beginRuntimeStructureTransaction = () => {
    if (runtimeStructurePendingTransactionRef?.current) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return null;
    }
    const transactionId = `cross-screen-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (runtimeStructurePendingTransactionRef) {
      runtimeStructurePendingTransactionRef.current = transactionId;
    }
    return transactionId;
  };

  // Duplicate intent must be resolved before live/semantic move routing. A
  // fresh clone cannot resolve to a source owner, so those paths would reject
  // the copy or treat it as a move without consuming sourceCloneHtml.
  if ((canEditLiveCrossScreen || canEditLiveBoardMove) && !duplicate) {
    const subjectNodeId =
      sourceNodeId ??
      (sourceProvenance as { uniqueNodeId?: string } | undefined)?.uniqueNodeId;
    const sourceOwner = sourceOwnerEntry?.[1];
    const sourceHtml = sourceHtmlSnapshot ?? sourceCloneHtml;
    const validatedSourceHtmlSnapshot =
      subjectNodeId && sourceHtml
        ? validateCrossScreenSourceHtmlSnapshot(sourceHtml, subjectNodeId)
        : undefined;
    if (!sourceOwner || !subjectNodeId || !validatedSourceHtmlSnapshot) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const hasAnchor = Boolean(
      targetAnchorNodeId || targetAnchorPendingNodeId || targetAnchorSelector,
    );
    const placeAbsolute =
      Boolean(targetLocalPoint) &&
      (!hasAnchor || targetDropMode === "absolute-container");
    const absolutePosition =
      placeAbsolute && targetLocalPoint
        ? absolutePlacePointForDrop({
            placeAbsoluteOnEmptyScreen: false,
            targetAnchorRect,
            targetLocalPoint,
          })
        : undefined;
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      targetScreenIsBoard
        ? "http://agent-native-board.local/"
        : getScreenContent(targetScreenId),
      [validatedSourceHtmlSnapshot],
      {
        preserveIncomingNodeIds: true,
        positions: absolutePosition
          ? [
              {
                x: absolutePosition.x - (sourcePointerOffset?.x ?? 0),
                y: absolutePosition.y - (sourcePointerOffset?.y ?? 0),
                space: "visual",
              },
            ]
          : undefined,
        stripRootPosition:
          hasAnchor &&
          !placeAbsolute &&
          targetDropMode !== "absolute-container",
        styleSnapshots: [styleSnapshot],
      },
    );
    const insertedHtml = prepared?.htmlFragments[0];
    if (!insertedHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    if (!setRuntimeStructureDeleteRequest) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const transactionId = beginRuntimeStructureTransaction();
    if (!transactionId) return;
    const deleteRequestId = sourceDeleteRequestId ?? `${transactionId}:source`;
    const deleteSelectorCandidates = Array.from(
      new Set([sourceSelector, ...codeLayerSelectorAliases(sourceOwner.node)]),
    ).filter(Boolean);
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      transactionId,
      screenId: targetScreenId,
      sourceScreenId,
      remintCollidingNodeIds: true,
      html: insertedHtml,
      anchor: {
        selector: targetAnchorSelector ?? "",
        sourceId: targetAnchorNodeId,
        pendingNodeId: targetAnchorPendingNodeId,
      },
      placement: targetAnchorPlacement ?? "inside",
    });
    setRuntimeStructureDeleteRequest({
      requestId: deleteRequestId,
      transactionId,
      screenId: sourceScreenId,
      selector: sourceSelector,
      waitForInsertTransaction: true,
      rollbackScreenId: targetScreenId,
      selectorCandidates: deleteSelectorCandidates,
    });
    return;
  }

  if (duplicate) {
    if (!sourceCloneHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return;
    }
    if (targetScreenIsLive || (targetScreenIsBoard && canEditLiveBoardDrop)) {
      const liveDestinationContent = getScreenContent(targetScreenId);
      const hasAnchor = Boolean(
        targetAnchorNodeId || targetAnchorPendingNodeId || targetAnchorSelector,
      );
      const placeAbsolute =
        Boolean(targetLocalPoint) &&
        (!hasAnchor || targetDropMode === "absolute-container");
      const absolutePosition =
        placeAbsolute && targetLocalPoint
          ? absolutePlacePointForDrop({
              placeAbsoluteOnEmptyScreen: false,
              targetAnchorRect,
              targetLocalPoint,
            })
          : undefined;
      const prepared = prepareClonedHtmlLayersForLiveInsert(
        targetScreenIsBoard
          ? "http://agent-native-board.local/"
          : liveDestinationContent,
        [sourceCloneHtml],
        {
          positions: absolutePosition
            ? [
                {
                  x: absolutePosition.x - (sourcePointerOffset?.x ?? 0),
                  y: absolutePosition.y - (sourcePointerOffset?.y ?? 0),
                  space: "visual",
                },
              ]
            : undefined,
          stripRootPosition:
            hasAnchor &&
            !placeAbsolute &&
            targetDropMode !== "absolute-container",
          styleSnapshots: [styleSnapshot],
        },
      );
      const insertedHtml = prepared?.htmlFragments[0];
      if (!insertedHtml) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return;
      }
      const transactionId = beginRuntimeStructureTransaction();
      if (!transactionId) return;
      runtimeStructureInsertRevisionRef.current += 1;
      setRuntimeStructureInsertRequest({
        requestId: runtimeStructureInsertRevisionRef.current,
        transactionId,
        screenId: targetScreenId,
        sourceScreenId,
        remintCollidingNodeIds: true,
        html: insertedHtml,
        anchor: {
          selector: targetAnchorSelector ?? "",
          sourceId: targetAnchorNodeId,
          pendingNodeId: targetAnchorPendingNodeId,
        },
        placement: targetAnchorPlacement ?? "inside",
      });
      return;
    }
    const sourceContent = getScreenContent(sourceScreenId);
    const rawDestContent = getScreenContent(targetScreenId);
    if (!sourceContent || !rawDestContent) return;
    const anchorWasRequested = Boolean(
      targetAnchorNodeId || targetAnchorPendingNodeId || targetAnchorSelector,
    );
    const anchorProvenance = anchorWasRequested
      ? resolveSourceNodeProvenance(rawDestContent, targetAnchorProvenance)
      : undefined;
    if (anchorWasRequested && !anchorProvenance) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return;
    }
    const provenTargetAnchorNodeId =
      anchorProvenance?.uniqueNodeId ??
      (anchorProvenance?.allowSelector ? targetAnchorNodeId : undefined);
    const provenTargetAnchorSelector =
      !anchorProvenance?.uniqueNodeId && anchorProvenance?.allowSelector
        ? targetAnchorSelector
        : undefined;
    const targetResolution = anchorWasRequested
      ? resolveCodeLayerTarget(
          rawDestContent,
          {
            nodeId: provenTargetAnchorNodeId,
            selector: provenTargetAnchorSelector,
          },
          { source: { kind: "design-file", fileId: targetScreenId } },
        ).resolution
      : undefined;
    const targetAnchor =
      targetResolution?.status === "resolved" ? targetResolution.node : null;
    if (anchorWasRequested && !targetAnchor) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return;
    }
    const anchorSelectors = provenTargetAnchorSelector
      ? [provenTargetAnchorSelector]
      : targetAnchor
        ? codeLayerSelectorAliases(targetAnchor)
        : [];
    // A duplicate leaves the source alive: insertClonedHtmlLayers's
    // preserveIncomingNodeIds only reserves ids already present in
    // rawDestContent (a different document), so without this the copy
    // silently keeps the source's own data-agent-native-node-id — two live
    // elements in two files sharing one id, breaking every id-keyed lookup
    // (selection, nudge, the cross-file code-layer owner map) on either.
    // A localhost/fusion screen's persisted content is a route URL, not
    // markup, so its projection contributes no ids; reserve the live clone's
    // already-stamped subtree ids as well.
    const sourceNodeIds = [
      ...buildCodeLayerProjection(sourceContent)
        .nodes.map((node) => node.dataAttributes["data-agent-native-node-id"])
        .filter((value): value is string => Boolean(value)),
      ...Array.from(
        new DOMParser()
          .parseFromString(
            `<template>${sourceCloneHtml}</template>`,
            "text/html",
          )
          .querySelector("template")
          ?.content.querySelectorAll("[data-agent-native-node-id]") ?? [],
      )
        .map((node) => node.getAttribute("data-agent-native-node-id"))
        .filter((value): value is string => Boolean(value)),
    ];
    const hasAnchor = anchorSelectors.length > 0;
    const placeAbsolute =
      Boolean(targetLocalPoint) &&
      (!hasAnchor || targetDropMode === "absolute-container");
    const absolutePosition =
      placeAbsolute && targetLocalPoint
        ? absolutePlacePointForDrop({
            placeAbsoluteOnEmptyScreen: false,
            targetAnchorRect,
            targetLocalPoint,
          })
        : undefined;
    const nextContent = insertClonedHtmlLayers(
      rawDestContent,
      [sourceCloneHtml],
      {
        targetSelectors: anchorSelectors,
        anchorSelectors,
        placement: targetAnchorPlacement ?? "inside",
        positions: absolutePosition
          ? [
              {
                x: absolutePosition.x - (sourcePointerOffset?.x ?? 0),
                y: absolutePosition.y - (sourcePointerOffset?.y ?? 0),
                space: "visual",
              },
            ]
          : undefined,
        stripRootPosition:
          hasAnchor &&
          !placeAbsolute &&
          targetDropMode !== "absolute-container",
        styleSnapshots: [styleSnapshot],
        preserveIncomingNodeIds: true,
        additionalReservedNodeIds: sourceNodeIds,
        componentLinks,
      },
    );
    if (!nextContent) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const nextDestContent = nextContent.content;
    if (isShaderWriteInFlight(targetScreenId)) {
      toast.error(t("designEditor.toasts.saveConflict"));
      return;
    }
    const publication = applyFileContentUpdate(
      targetScreenId,
      nextDestContent,
      {
        recordHistory: false,
        refreshPreview: false,
        forcePreviewFullDocument: true,
        historyBeforeContent: rawDestContent,
      },
    );
    if (publication.status !== "accepted") return;
    recordContentHistoryEntry({
      changes: [
        {
          fileId: targetScreenId,
          before: rawDestContent,
          after: publication.content,
        },
      ],
    });
    pendingOverviewScreenSelectionRef.current =
      targetScreenId === boardFileId ? null : targetScreenId;
    pendingOverviewLayerSelectionRef.current =
      nextContent.rootNodeIds[0] ?? null;
    clearPendingOverviewLayerSelectionTimer();
    setActiveFileId(targetScreenId);
    const submittedProjection = buildCodeLayerProjection(nextDestContent, {
      source: { kind: "design-file", fileId: targetScreenId },
    });
    const copiedNodeCandidate = submittedProjection.nodes.find(
      (node) =>
        node.id === nextContent.rootNodeIds[0] ||
        node.dataAttributes["data-agent-native-node-id"] ===
          nextContent.rootNodeIds[0],
    );
    const copiedNode = mapAcceptedSelectionNode(
      publication,
      projectAcceptedSource(publication, {
        kind: "design-file",
        fileId: targetScreenId,
      }),
      copiedNodeCandidate,
    );
    if (copiedNode) {
      setCreatedOverviewLayerSelection({
        screenId: targetScreenId,
        layerId: copiedNode.id,
      });
      setSelectedLayerIdsState([copiedNode.id]);
      setSelectedElement(elementInfoFromCodeLayerNode(copiedNode));
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(
          targetScreenId === boardFileId ? [] : [targetScreenId],
        );
      }
    }
    return;
  }

  // A live app destination has no editable stored document — its
  // stored "content" is the bridge URL — so the source-edit path below
  // would write a whole HTML document over that URL and never reach the
  // running app. Key off the destination SCREEN's source type: a live
  // anchor normally has no stored layer owner at all, so both runtimeOnly
  // flags read false and the drop looks like an ordinary source move.
  const crossScreenExecutionMode = resolveRuntimeStructureMoveExecutionMode({
    subjectRuntimeOnly: Boolean(sourceOwnerEntry?.[1].runtimeOnly),
    targetRuntimeOnly: Boolean(targetOwnerEntry?.[1].runtimeOnly),
    sourceScreenId,
    targetScreenId,
    // Only a board primitive may be reinterpreted as an insert; a real
    // screen's element dropped into a live app is a move, and inserting it
    // would leave a duplicate behind in its own screen.
    sourceScreenIsBoard,
    targetScreenIsLive,
  });
  if (crossScreenExecutionMode === "screen-bridge-insert") {
    const boardContent = getScreenContent(sourceScreenId);
    const sourceHtml = sourceHtmlSnapshot ?? sourceCloneHtml;
    if (!boardContent && !sourceHtml) return;
    const boardProjection = buildCodeLayerProjection(boardContent, {
      source: { kind: "design-file", fileId: sourceScreenId },
    });
    const subjectNode = resolveCodeLayerNodeFromBridge(
      boardProjection,
      sourceSelector,
      sourceNodeId,
    );
    // A live layer dragged onto the canvas is present in the board iframe's
    // transient DOM, but it is intentionally not persisted into the board
    // document. Prefer the id and outerHTML captured from that iframe. The
    // stored board projection remains the fallback for ordinary board
    // primitives that were already in the document.
    const subjectNodeId =
      sourceNodeId ?? subjectNode?.dataAttributes["data-agent-native-node-id"];
    const validatedSourceHtmlSnapshot =
      subjectNodeId && sourceHtml
        ? validateCrossScreenSourceHtmlSnapshot(sourceHtml, subjectNodeId)
        : undefined;
    if (sourceHtml && !validatedSourceHtmlSnapshot) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    // Reuse the stored-document transforms instead of slicing the source
    // span: they already own absolute/flow semantics. The portable style
    // snapshot is always inlined (no sourceContent argument) — a live app
    // never shares the board's stylesheet head, so the node would land
    // unstyled otherwise.
    const insertedHtml = subjectNodeId
      ? (() => {
          const styled = applyPortableStyleSnapshotToHtml(
            validatedSourceHtmlSnapshot ?? boardContent,
            subjectNodeId,
            styleSnapshot,
          );
          const destHtml = getScreenContent(targetScreenId);
          const placeAbsoluteOnEmptyScreen = shouldAbsolutePlaceOnEmptyScreen({
            destHtml,
            targetLocalPoint,
          });
          const positioned =
            targetLocalPoint &&
            (placeAbsoluteOnEmptyScreen ||
              (targetDropMode === "absolute-container" && targetAnchorRect))
              ? setAbsolutePositioningForNodeInHtml(
                  styled,
                  subjectNodeId,
                  absolutePlacePointForDrop({
                    placeAbsoluteOnEmptyScreen,
                    targetAnchorRect,
                    targetLocalPoint,
                  }),
                  sourcePointerOffset,
                  sourceComputedSize,
                )
              : removeAbsolutePositioningFromNodeInHtml(styled, subjectNodeId);
          return new DOMParser()
            .parseFromString(positioned, "text/html")
            .querySelector(
              `[data-agent-native-node-id="${CSS.escape(subjectNodeId)}"]`,
            )?.outerHTML;
        })()
      : undefined;
    if (!insertedHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const transactionId = beginRuntimeStructureTransaction();
    if (!transactionId) return;
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      transactionId,
      screenId: targetScreenId,
      sourceScreenId,
      remintCollidingNodeIds: true,
      html: insertedHtml,
      anchor: {
        selector: targetAnchorSelector ?? "",
        sourceId: targetAnchorNodeId,
        pendingNodeId: targetAnchorPendingNodeId,
      },
      placement: targetAnchorPlacement ?? "inside",
    });
    // The board keeps its copy until the pending live edit is applied.
    // Removing it here would commit the board file immediately while the
    // destination is still only a pending live edit, and undo pops whichever
    // stack is newer — one Cmd+Z would revert half the gesture, and a drop
    // that is never applied would lose the primitive entirely.
    return;
  }
  if (crossScreenExecutionMode === "semantic-handoff") {
    if (!sourceOwnerEntry || !targetOwnerEntry) {
      // A runtime/source cross-screen drop without an exact target (for
      // example, dropping on the bare screen root) cannot satisfy the
      // semantic handoff's two-anchor contract. Do not fall through to a
      // selector guess or mutate stored wrapper HTML that does not own the
      // runtime React node.
      toast.error(t("designEditor.toasts.reactSourceAnchorsLoading"));
      return;
    }
    sendRuntimeLayerMoveSemanticHandoff(
      sourceOwnerEntry[0],
      targetOwnerEntry[0],
      targetAnchorPlacement ?? "inside",
    );
    return;
  }

  const sourceContent = getScreenContent(sourceScreenId);
  const rawDestContent = getScreenContent(targetScreenId);
  if (!sourceContent || !rawDestContent) return;

  const sourceProvenanceForContent = resolveSourceNodeProvenance(
    sourceContent,
    sourceProvenance,
  );
  if (!sourceProvenanceForContent) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }
  const targetAnchorWasRequested = Boolean(
    targetAnchorNodeId || targetAnchorPendingNodeId || targetAnchorSelector,
  );
  const targetProvenanceForContent = targetAnchorWasRequested
    ? resolveSourceNodeProvenance(rawDestContent, targetAnchorProvenance)
    : undefined;
  if (targetAnchorWasRequested && !targetProvenanceForContent) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }
  const provenSourceNodeId =
    sourceProvenanceForContent.uniqueNodeId ??
    (sourceProvenanceForContent.allowSelector ? sourceNodeId : undefined);
  const provenSourceSelector =
    !sourceProvenanceForContent.uniqueNodeId &&
    sourceProvenanceForContent.allowSelector
      ? sourceSelector
      : undefined;
  const provenTargetAnchorNodeId =
    targetProvenanceForContent?.uniqueNodeId ??
    (targetProvenanceForContent?.allowSelector
      ? targetAnchorNodeId
      : undefined);
  const provenTargetAnchorSelector =
    !targetProvenanceForContent?.uniqueNodeId &&
    targetProvenanceForContent?.allowSelector
      ? targetAnchorSelector
      : undefined;

  // Id-on-demand handshake (two-step, mirroring the element-select
  // persist-on-select path above): AI-generated/duplicated screens often
  // carry ZERO data-agent-native-node-id attributes, so the hit-test
  // bridge can't return an anchor id — it mints a pendingNodeId (stamped
  // on the LIVE dest DOM as data-an-pending-node-id) plus a
  // source-equivalent structural anchorSelector. Persist that pending id
  // as the anchor's real node id in the STORED dest document first, then
  // resolve the drop against it — otherwise every flow-insert into an
  // id-less screen silently degrades to absolute placement even though
  // the hit-test found a valid before/after/inside slot. applyVisualEdit
  // resolves the selector STRICTLY (unique match or conflict), so a
  // selector that can't be honestly mapped to one source element (e.g.
  // Alpine template instances) leaves the absolute fallback untouched
  // rather than ever stamping the wrong node.
  let destContent = rawDestContent;
  let effectiveAnchorNodeId = provenTargetAnchorNodeId;
  if (
    !effectiveAnchorNodeId &&
    targetAnchorPendingNodeId &&
    provenTargetAnchorSelector
  ) {
    const stamped = applyVisualEdit(
      rawDestContent,
      {
        kind: "attribute",
        target: { selector: provenTargetAnchorSelector },
        name: "data-agent-native-node-id",
        value: targetAnchorPendingNodeId,
      },
      {
        source: {
          kind: "design-file",
          designId: id,
          fileId: targetScreenId,
        },
      },
    );
    if (
      stamped.result.status === "applied" &&
      stamped.content !== rawDestContent
    ) {
      destContent = stamped.content;
      effectiveAnchorNodeId = targetAnchorPendingNodeId;
    } else {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
  }

  // Resolve against the authored tree: projection aliases alone cannot match
  // a positional selector when duplicated IDs appear in the projection path.
  const sourceResolution = resolveCodeLayerTarget(
    sourceContent,
    { nodeId: provenSourceNodeId, selector: provenSourceSelector },
    { source: { kind: "design-file", fileId: sourceScreenId } },
  ).resolution;
  const resolvedSourceNode =
    sourceResolution.status === "resolved" ? sourceResolution.node : null;
  if (!resolvedSourceNode) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }
  const nodeAttrId =
    sourceProvenanceForContent.uniqueNodeId ??
    resolvedSourceNode?.dataAttributes["data-agent-native-node-id"] ??
    provenSourceNodeId ??
    provenSourceSelector ??
    resolvedSourceNode.path;
  const targetResolution =
    effectiveAnchorNodeId || provenTargetAnchorSelector
      ? resolveCodeLayerTarget(
          destContent,
          {
            nodeId: effectiveAnchorNodeId,
            selector: provenTargetAnchorSelector,
          },
          { source: { kind: "design-file", fileId: targetScreenId } },
        ).resolution
      : undefined;
  const resolvedTargetAnchor =
    targetResolution?.status === "resolved" ? targetResolution.node : null;
  const targetAnchorAttrId =
    resolvedTargetAnchor?.dataAttributes["data-agent-native-node-id"];
  // Projection paths omit :nth-of-type(1); preserve the proven selector so
  // the strict move resolver still distinguishes the first authored sibling.
  const resolvedSourceSelector =
    provenSourceSelector ?? resolvedSourceNode.path;
  const anchorWasRequested = Boolean(
    effectiveAnchorNodeId ||
    (targetProvenanceForContent?.allowSelector && targetAnchorPendingNodeId) ||
    provenTargetAnchorSelector,
  );
  const resolvedAnchorNodeId =
    targetAnchorAttrId ?? effectiveAnchorNodeId ?? targetAnchorPendingNodeId;
  const resolvedAnchorSelector =
    provenTargetAnchorSelector ?? resolvedTargetAnchor?.path;

  // Use hit-test anchor when the canvas supplied one; fall back to
  // top-level body append ("inside" with no anchor = existing behaviour).
  const result = moveNodeBetweenDocuments(sourceContent, destContent, {
    nodeId: nodeAttrId,
    ...(resolvedSourceSelector
      ? { sourceSelector: resolvedSourceSelector }
      : {}),
    ...(anchorWasRequested
      ? {
          ...(resolvedAnchorNodeId
            ? { anchorNodeId: resolvedAnchorNodeId }
            : {}),
          ...(resolvedAnchorSelector
            ? { anchorSelector: resolvedAnchorSelector }
            : {}),
          placement: targetAnchorPlacement ?? "inside",
        }
      : { placement: "inside" }),
  });
  if (result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        result.message,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
      { duration: 4000 },
    );
    return;
  }
  // Finding 8: see the same-screen move's identical handling above —
  // the anchor placement was redirected out of a <template> interior to
  // right after the enclosing template's close instead of failing or
  // teleporting to doc end.
  if (result.anchorRedirected) {
    toast(t("designEditor.toasts.layerMoveRedirected"), {
      duration: 4000,
    });
  }

  // Hit-test anchors are emitted only for auto-layout insertion targets. If
  // there is no anchor, preserve absolute mode and rebase left/top to the
  // release point so screen↔board moves behave like Figma absolute layers.
  const destNodeAttrId = result.movedNodeId ?? nodeAttrId;
  const styleSnapshotDest = applyPortableStyleSnapshotToHtml(
    result.destHtml,
    destNodeAttrId,
    styleSnapshot,
  );
  // Finding 8: board/screen text carrying the auto-applied white default
  // (see BOARD_TEXT_AUTO_COLOR_MARKER / defaultCanvasTextColor) must not
  // keep that forced white when it lands cross-screen in a light
  // destination — otherwise it renders invisible white-on-white. The
  // in-screen drag path already adapts via the bridge's
  // adaptAutoTextColorForNest; this is the cross-screen mirror, applied
  // host-side now that the node has actually been re-parented into
  // destContent.
  const liveDestIframe = document.querySelector<HTMLIFrameElement>(
    `[data-screen-iframe-id="${CSS.escape(getPrimaryIframeId(targetScreenId))}"]`,
  );
  const stylePreservedDest = adaptAutoTextColorForCrossScreenNode(
    styleSnapshotDest,
    destNodeAttrId,
    liveDestIframe?.contentDocument ?? null,
  );
  const placeAbsoluteOnEmptyScreen = shouldAbsolutePlaceOnEmptyScreen({
    destHtml: destContent,
    targetLocalPoint,
  });
  // One decision, one label: the branch name in the trace is the branch that
  // ran, so a bug report cannot disagree with the code.
  const placed = ((): { content: string; branch: string } => {
    const absolute = (point: { x: number; y: number }, branch: string) => ({
      content: setAbsolutePositioningForNodeInHtml(
        stylePreservedDest,
        destNodeAttrId,
        point,
        sourcePointerOffset,
        sourceComputedSize,
      ),
      branch,
    });
    const flowInsert = {
      content: removeAbsolutePositioningFromNodeInHtml(
        stylePreservedDest,
        destNodeAttrId,
      ),
      branch: "anchored-flow-insert",
    };
    if (!targetLocalPoint) {
      // No release point: nothing can be placed. Keeping the layer's previous
      // position beats writing it with none, which read as lost.
      if (targetAnchorAttrId && targetDropMode !== "absolute-container") {
        return flowInsert;
      }
      return { content: stylePreservedDest, branch: "rooted-no-point" };
    }
    if (placeAbsoluteOnEmptyScreen) {
      return absolute(targetLocalPoint, "empty-screen-absolute");
    }
    if (!targetAnchorAttrId) {
      return absolute(targetLocalPoint, "rooted-absolute");
    }
    if (targetDropMode === "absolute-container") {
      if (!targetAnchorRect) {
        return {
          content: stylePreservedDest,
          branch: "anchored-absolute-missing-geometry",
        };
      }
      return absolute(
        absolutePlacePointForDrop({
          placeAbsoluteOnEmptyScreen,
          targetAnchorRect,
          targetLocalPoint,
        }),
        "anchored-absolute",
      );
    }
    return flowInsert;
  })();
  const point = (value: { x: number; y: number } | undefined) =>
    value ? `${Math.round(value.x)},${Math.round(value.y)}` : "none";
  // Flat string, not an object: a console paste collapses objects to "{…}".
  trace(
    "drop",
    "placement",
    `${placed.branch} node=${destNodeAttrId} target=${targetScreenId}` +
      ` anchor=${targetAnchorAttrId ?? "none"} mode=${targetDropMode ?? "none"}` +
      ` local=${point(targetLocalPoint)}` +
      ` anchorRect=${targetAnchorRect ? `${Math.round(targetAnchorRect.left)},${Math.round(targetAnchorRect.top)}` : "none"}` +
      ` grab=${point(sourcePointerOffset)}`,
  );
  const nextDestContent = placed.content;

  // Both halves of a cross-screen move must pass the exact publication
  // integrity boundary before either file or the history stack is changed.
  // Otherwise a valid source removal can commit before an Alpine/runtime
  // integrity failure rejects the destination insertion.
  try {
    prepareAcceptedSourceContent(result.sourceHtml, {
      fileId: sourceScreenId,
      previousContent: sourceContent,
    });
    prepareAcceptedSourceContent(nextDestContent, {
      fileId: targetScreenId,
      previousContent: rawDestContent,
    });
  } catch {
    toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    return;
  }

  const publicationFileIds = new Set<string>();
  if (result.sourceHtml !== sourceContent) {
    publicationFileIds.add(sourceScreenId);
  }
  if (nextDestContent !== rawDestContent) {
    publicationFileIds.add(targetScreenId);
  }
  if ([...publicationFileIds].some(isShaderWriteInFlight)) {
    toast.error(t("designEditor.toasts.saveConflict"));
    return;
  }

  const contentUndoStackTopBeforeMove = contentUndoStackRef
    ? captureContentUndoStackTop(contentUndoStackRef.current)
    : undefined;
  const crossScreenHistoryChanges = [
    {
      fileId: sourceScreenId,
      before: sourceContent,
      after: result.sourceHtml,
    },
    {
      fileId: targetScreenId,
      before: destContent,
      after: nextDestContent,
    },
  ];
  if (fileHistoryMutationPendingRef?.current) return;
  const releasePendingHistory = () => {
    if (!fileHistoryMutationPendingRef) return;
    fileHistoryMutationPendingRef.current = false;
    syncUndoRedoState?.();
  };
  if (fileHistoryMutationPendingRef) {
    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState?.();
  }
  const targetPublication = applyFileContentUpdate(
    targetScreenId,
    nextDestContent,
    {
      recordHistory: false,
      refreshPreview: false,
      forcePreviewFullDocument: true,
      immediateSave: true,
      historyBeforeContent: rawDestContent,
      awaitSave: true,
    },
  );
  if (targetPublication.status !== "accepted") {
    releasePendingHistory();
    return;
  }

  const sourcePublication = applyFileContentUpdate(
    sourceScreenId,
    result.sourceHtml,
    {
      recordHistory: false,
      refreshPreview: false,
      forcePreviewFullDocument: true,
      immediateSave: true,
      historyBeforeContent: sourceContent,
      awaitSave: true,
    },
  );
  if (sourcePublication.status !== "accepted") {
    const rollback = applyFileContentUpdate(targetScreenId, rawDestContent, {
      recordHistory: false,
      refreshPreview: false,
      forcePreviewFullDocument: true,
      historyBeforeContent: targetPublication.content,
      awaitSave: true,
    });
    if (rollback.status !== "accepted") {
      toast.error(t("designEditor.toasts.saveConflict"));
      clearPendingHistory?.();
      releasePendingHistory();
      return;
    }
    if (!rollback.saveCompletion) {
      clearPendingHistory?.();
      releasePendingHistory();
      return;
    }
    void rollback.saveCompletion.then(
      (status) => {
        if (status !== "persisted") {
          toast.error(t("designEditor.toasts.saveConflict"));
        }
        clearPendingHistory?.();
        releasePendingHistory();
      },
      () => {
        toast.error(t("designEditor.toasts.saveConflict"));
        clearPendingHistory?.();
        releasePendingHistory();
      },
    );
    return;
  }

  // Capture after both publications so synchronous bridge/state updates caused
  // by this move are part of the operation rather than mistaken for a newer
  // selection.
  const selectionFingerprintAtPublication = getCurrentSelectionFingerprint?.();
  const saveOperationRevisionsAtPublication = {
    [targetScreenId]: fileSaveOperationRevisionRef?.current[targetScreenId],
    [sourceScreenId]: fileSaveOperationRevisionRef?.current[sourceScreenId],
  };
  const serverSnapshotsAtPublication = getCurrentFileSnapshot
    ? {
        [targetScreenId]: getCurrentFileSnapshot(targetScreenId),
        [sourceScreenId]: getCurrentFileSnapshot(sourceScreenId),
      }
    : undefined;
  const isCurrentPublication = (
    fileId: string,
    publication: Extract<ApplyFileContentUpdateResult, { status: "accepted" }>,
  ) => {
    const expectedRevision = saveOperationRevisionsAtPublication[fileId];
    if (expectedRevision !== undefined && fileSaveOperationRevisionRef) {
      if (fileSaveOperationRevisionRef.current[fileId] !== expectedRevision) {
        return false;
      }
    }
    const serverSnapshot = getCurrentFileSnapshot?.(fileId);
    const initialServerSnapshot = serverSnapshotsAtPublication?.[fileId];
    const currentContent = getScreenContent(fileId);
    // A refetch can repaint stale bytes after the optimistic overlay retires;
    // an unchanged server revision is still the same publication. A changed
    // server revision with different bytes is an authoritative peer update.
    if (
      serverSnapshot &&
      initialServerSnapshot &&
      serverSnapshot.updatedAt !== initialServerSnapshot.updatedAt &&
      serverSnapshot.content !== publication.content
    ) {
      return false;
    }
    return (
      currentContent === publication.content ||
      serverSnapshot?.content === publication.content ||
      Boolean(
        serverSnapshot &&
        initialServerSnapshot &&
        serverSnapshot.updatedAt === initialServerSnapshot.updatedAt,
      )
    );
  };
  const canFinalizePublication = () => {
    const targetCurrent = isCurrentPublication(
      targetScreenId,
      targetPublication,
    );
    const sourceCurrent = isCurrentPublication(
      sourceScreenId,
      sourcePublication,
    );
    return targetCurrent && sourceCurrent;
  };

  const finalizePublication = () => {
    // Save completion is asynchronous. Do not append stale whole-document
    // history; selection restoration is guarded separately below.
    if (!canFinalizePublication()) return;
    // History must replay the bytes the publisher accepted. Canonical identity
    // publication may stamp IDs into submitted HTML, and the post-action
    // selection snapshot must resolve against those same final documents.
    crossScreenHistoryChanges[0].after = sourcePublication.content;
    crossScreenHistoryChanges[1].after = targetPublication.content;
    recordContentHistoryEntry({ changes: crossScreenHistoryChanges });

    const selectionStillCurrent =
      selectionFingerprintAtPublication === undefined ||
      selectionFingerprintAtPublication === getCurrentSelectionFingerprint?.();
    if (!selectionStillCurrent) return;

    // Switch active screen to the target and select the moved node; viewMode
    // stays "overview" (no setViewMode call).
    pendingOverviewScreenSelectionRef.current =
      targetScreenId === boardFileId ? null : targetScreenId;
    pendingOverviewLayerSelectionRef.current = destNodeAttrId;
    clearPendingOverviewLayerSelectionTimer();
    setActiveFileId(targetScreenId);
    const submittedProjection = buildCodeLayerProjection(nextDestContent, {
      source: { kind: "design-file", fileId: targetScreenId },
    });
    const movedNodeCandidate = submittedProjection.nodes.find(
      (n) => n.dataAttributes["data-agent-native-node-id"] === destNodeAttrId,
    );
    const movedNodeFinal = mapAcceptedSelectionNode(
      targetPublication,
      projectAcceptedSource(targetPublication, {
        kind: "design-file",
        fileId: targetScreenId,
      }),
      movedNodeCandidate,
    );
    if (movedNodeFinal) {
      setCreatedOverviewLayerSelection({
        screenId: targetScreenId,
        layerId: movedNodeFinal.id,
      });
      setSelectedLayerIdsState([movedNodeFinal.id]);
      setSelectedElement(elementInfoFromCodeLayerNode(movedNodeFinal));
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(
          targetScreenId === boardFileId ? [] : [targetScreenId],
        );
      }
      if (contentUndoStackRef && contentHistorySelectionAfterRef) {
        stampContentHistorySelectionAfter(
          contentUndoStackRef.current,
          contentHistorySelectionAfterRef.current,
          contentUndoStackTopBeforeMove,
          {
            activeFileId: targetScreenId,
            overviewSelectedScreenIds:
              targetScreenId === boardFileId ? [] : [targetScreenId],
            selectedLayerIds: [movedNodeFinal.id],
          },
        );
      }
    }
  };

  const rollbackAfterSaveConflict = (
    publication: typeof targetPublication,
    fileId: string,
    content: string,
  ): Promise<FileContentSaveCompletion> => {
    if (!isCurrentPublication(fileId, publication)) {
      return Promise.resolve<FileContentSaveCompletion>("failed");
    }
    const rollback = applyFileContentUpdate(fileId, content, {
      recordHistory: false,
      refreshPreview: false,
      forcePreviewFullDocument: true,
      historyBeforeContent: publication.content,
      sourceBaseContent: publication.content,
      immediateSave: true,
      awaitSave: true,
    });
    if (rollback.status !== "accepted") {
      return Promise.resolve<FileContentSaveCompletion>("failed");
    }
    return (
      rollback.saveCompletion ??
      Promise.resolve<FileContentSaveCompletion>("persisted")
    );
  };

  const restoreRetryablePublication = (
    publication: typeof targetPublication,
    fileId: string,
    content: string,
  ): boolean => {
    // Offline saves remain in the outbox, but a two-file move has no safe way
    // to finalize one history entry when only a later replay succeeds. Restore
    // both optimistic files and cancel only the publication still visible in
    // the editor; a newer edit must remain untouched.
    if (!isCurrentPublication(fileId, publication)) return true;
    return (
      applyFileContentUpdate(fileId, content, {
        recordHistory: false,
        refreshPreview: false,
        forcePreviewFullDocument: true,
        persist: false,
        historyBeforeContent: publication.content,
      }).status === "accepted"
    );
  };

  const targetSave = targetPublication.saveCompletion;
  const sourceSave = sourcePublication.saveCompletion;
  if (!targetSave && !sourceSave) {
    finalizePublication();
    releasePendingHistory();
    return;
  }

  void Promise.allSettled([
    targetSave ?? Promise.resolve<FileContentSaveCompletion>("persisted"),
    sourceSave ?? Promise.resolve<FileContentSaveCompletion>("persisted"),
  ]).then(async ([targetResult, sourceResult]) => {
    const targetSaved =
      targetResult.status === "fulfilled" && targetResult.value === "persisted";
    const sourceSaved =
      sourceResult.status === "fulfilled" && sourceResult.value === "persisted";
    const targetRetryable =
      targetResult.status === "fulfilled" && targetResult.value === "retryable";
    const sourceRetryable =
      sourceResult.status === "fulfilled" && sourceResult.value === "retryable";
    const retryableSave = targetRetryable || sourceRetryable;
    const saveConflict =
      (targetResult.status === "fulfilled" &&
        targetResult.value === "conflict") ||
      (sourceResult.status === "fulfilled" &&
        sourceResult.value === "conflict");
    const saveFailed =
      targetResult.status === "rejected" || sourceResult.status === "rejected";
    if (targetSaved && sourceSaved) {
      finalizePublication();
      releasePendingHistory();
      return;
    }
    if (retryableSave) {
      const rollbackResults: Promise<FileContentSaveCompletion>[] = [];
      const localRestores: boolean[] = [];
      if (targetSaved) {
        rollbackResults.push(
          rollbackAfterSaveConflict(
            targetPublication,
            targetScreenId,
            rawDestContent,
          ),
        );
      } else if (targetRetryable) {
        localRestores.push(
          restoreRetryablePublication(
            targetPublication,
            targetScreenId,
            rawDestContent,
          ),
        );
      }
      if (sourceSaved) {
        rollbackResults.push(
          rollbackAfterSaveConflict(
            sourcePublication,
            sourceScreenId,
            sourceContent,
          ),
        );
      } else if (sourceRetryable) {
        localRestores.push(
          restoreRetryablePublication(
            sourcePublication,
            sourceScreenId,
            sourceContent,
          ),
        );
      }
      const rollbackFailed = (await Promise.all(rollbackResults)).some(
        (status) => status !== "persisted",
      );
      if (rollbackFailed || localRestores.some((restored) => !restored)) {
        toast.error(t("designEditor.toasts.saveConflict"));
      }
      clearPendingHistory?.();
      releasePendingHistory();
      return;
    }
    const rollbackResults: Promise<FileContentSaveCompletion>[] = [];
    if (targetSaved && !sourceSaved) {
      rollbackResults.push(
        rollbackAfterSaveConflict(
          targetPublication,
          targetScreenId,
          rawDestContent,
        ),
      );
    }
    if (sourceSaved && !targetSaved) {
      rollbackResults.push(
        rollbackAfterSaveConflict(
          sourcePublication,
          sourceScreenId,
          sourceContent,
        ),
      );
    }
    const rollbackFailed = (await Promise.all(rollbackResults)).some(
      (status) => status !== "persisted",
    );
    if (saveFailed || saveConflict || rollbackFailed) {
      toast.error(t("designEditor.toasts.saveConflict"));
    }
    clearPendingHistory?.();
    releasePendingHistory();
  });
}
