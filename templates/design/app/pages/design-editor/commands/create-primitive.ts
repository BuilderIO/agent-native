import { buildCodeLayerProjection } from "@shared/code-layer";
import { shouldUseLiveFileContent } from "@shared/html-content";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import type {
  CanvasPrimitiveInsert,
  ScreenProjectionNodeIdentity,
} from "@/components/design/multi-screen/types";
import type { RuntimeStructureInsertRequest } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  appendCanvasPrimitiveToHtml,
  blankScreenHtml,
  canvasPrimitiveInsertionHostNodeId,
  extractCanvasPrimitiveHtml,
  uniqueLayerId,
} from "@/pages/design-editor/canvas-primitive-insert";
import { parsePenPathFromSerializedD } from "@/pages/design-editor/canvas-primitives";
import { setPenNodesAttributeOnElement } from "@/pages/design-editor/clone-and-pen-edit";
import { prepareLayerNodeIdentities } from "@/pages/design-editor/commands/layer-node-identity";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { isStandaloneHttpUrl } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryEntry,
  PendingTextCreationHistory,
} from "@/pages/design-editor/history";
import {
  getLivePreviewDocument,
  isFlowDisplay,
} from "@/pages/design-editor/live-layer-move-layout";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface CreatePrimitiveArgs {
  activeBreakpointWidthState?: number;
  activeContent: string;
  activeFile: DesignFile;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  boardFileId: string | undefined;
  /** Effective canvas colour, stored or themed — the board's visible surface. */
  canvasBackground: string | null | undefined;
  canEditDesign: boolean;
  collabContentFileIdRef: RefObject<string | null>;
  collabContentRef: RefObject<string | null>;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options: {
      expectedVersionHash: string;
      syncCollab?: boolean;
      immediate?: boolean;
    },
  ) => void;
  files: DesignFile[];
  id: string | undefined;
  isSynced: boolean;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
  ) => void;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  pendingTextCreationHistoryRef: RefObject<PendingTextCreationHistory | null>;
  pendingTextEditNodeIdRef: RefObject<string | null>;
  overviewScreens?: readonly OverviewScreen[];
  queryClient: QueryClient;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
  ydoc: Y.Doc | null;
}

type PrimitiveCreationHostLayout =
  | "flow"
  | "freeform"
  | "unavailable"
  | "stale";

function resolvePrimitiveCreationHostLayout(args: {
  activeBreakpointWidthState?: number;
  activeFileId?: string;
  boardFileId?: string;
  content: string;
  fileId: string;
  overviewScreens?: readonly OverviewScreen[];
  primitive: CanvasPrimitiveInsert;
}): PrimitiveCreationHostLayout {
  const preview = getLivePreviewDocument({
    activeBreakpointWidthState: args.activeBreakpointWidthState,
    activeFileId: args.activeFileId,
    boardFileId: args.boardFileId,
    fileId: args.fileId,
    overviewScreens: args.overviewScreens,
  });
  if (preview.status === "unavailable") return "unavailable";
  if (preview.status === "stale" || !preview.document.body) return "stale";

  const host = canvasPrimitiveInsertionHostNodeId(
    args.content,
    args.primitive,
    args.fileId === args.boardFileId,
  );
  if (!host) return "stale";

  let liveHost: Element | null = preview.document.body;
  if (host.kind === "frame") {
    const source = new DOMParser().parseFromString(args.content, "text/html");
    const sourceMatches = Array.from(
      source.querySelectorAll("[data-agent-native-node-id]"),
    ).filter(
      (element) =>
        element.getAttribute("data-agent-native-node-id") === host.nodeId,
    );
    const liveMatches = Array.from(
      preview.document.querySelectorAll("[data-agent-native-node-id]"),
    ).filter(
      (element) =>
        element.getAttribute("data-agent-native-node-id") === host.nodeId,
    );
    if (
      sourceMatches.length !== 1 ||
      liveMatches.length !== 1 ||
      sourceMatches[0]?.localName !== liveMatches[0]?.localName
    ) {
      return "stale";
    }
    liveHost = liveMatches[0] ?? null;
  }
  const view = preview.document.defaultView;
  if (!liveHost || !view) return "stale";
  try {
    return isFlowDisplay(view.getComputedStyle(liveHost).display)
      ? "flow"
      : "freeform";
  } catch {
    return "stale";
  }
}

export function runCreatePrimitive(
  {
    activeBreakpointWidthState,
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    boardFileId,
    canvasBackground,
    canEditDesign,
    collabContentFileIdRef,
    collabContentRef,
    files,
    id,
    isSynced,
    markPendingLocalFileContent,
    pendingLocalFileContentsRef,
    pendingTextCreationHistoryRef,
    pendingTextEditNodeIdRef,
    overviewScreens,
    queryClient,
    queueFileContentSave,
    recordContentHistoryEntry,
    runtimeStructureInsertRevisionRef,
    setRuntimeStructureInsertRequest,
    t,
    viewModeRef,
    ydoc,
  }: CreatePrimitiveArgs,
  screenId: string,
  primitive: CanvasPrimitiveInsert,
  options?: { reparentTargetIdentity?: ScreenProjectionNodeIdentity },
) {
  if (!canEditDesign) return false;
  const targetFile = files.find((file) => file.id === screenId);
  if (!targetFile) return false;
  const pendingContent = pendingLocalFileContentsRef.current.get(
    targetFile.id,
  )?.content;
  const storedContent = targetFile.content ?? "";
  const baseContent =
    pendingContent ??
    (targetFile.id === activeFile?.id
      ? (() => {
          const liveContent =
            ydoc && isSynced
              ? ydoc.getText("content").toJSON()
              : ((collabContentFileIdRef.current === activeFile.id
                  ? collabContentRef.current
                  : null) ?? activeContent);
          return shouldUseLiveFileContent({
            liveContent,
            storedContent,
            fileType: targetFile.fileType,
          })
            ? liveContent
            : storedContent;
        })()
      : storedContent);
  const reparentTargetIdentity = options?.reparentTargetIdentity;
  let insertionBaseContent = baseContent;
  let preparedTargetNodeId: string | undefined;
  if (reparentTargetIdentity) {
    const source = reparentTargetIdentity.projection.source;
    if (source.kind !== "design-file" || source.fileId !== targetFile.id) {
      return false;
    }
    const hitTarget = reparentTargetIdentity.projection.nodes.find(
      (node) => node.id === reparentTargetIdentity.nodeId,
    );
    if (
      !hitTarget ||
      hitTarget.dataAttributes["data-agent-native-node-id"] !==
        reparentTargetIdentity.authoredNodeId
    ) {
      return false;
    }
    const prepared = prepareLayerNodeIdentities({
      content: baseContent,
      nodes: [hitTarget],
      renderedProjection: reparentTargetIdentity.projection,
    });
    preparedTargetNodeId = prepared.nodeIds.get(hitTarget.id);
    if (!preparedTargetNodeId) return false;
    insertionBaseContent = prepared.content;
  }
  const insertionPrimitive =
    reparentTargetIdentity && !primitive.nodeId
      ? {
          ...primitive,
          nodeId: uniqueLayerId(primitive.kind || "primitive"),
        }
      : primitive;
  // A localhost screen's stored content is its route URL, not an editable
  // document. Keep that URL intact and send one serialized primitive
  // through the same live insert bridge used by board-to-screen drops.
  // The bridge echo records the pending source handoff and owns the
  // optimistic DOM/history lifecycle (selection, Layers, undo, and redo).
  if (isStandaloneHttpUrl(baseContent)) {
    if (reparentTargetIdentity) return false;
    const nodeId =
      primitive.nodeId ?? uniqueLayerId(primitive.kind || "primitive");
    const livePrimitive = { ...primitive, nodeId };
    const temporaryDocument = appendCanvasPrimitiveToHtml(
      blankScreenHtml("Live insert"),
      livePrimitive,
    );
    if (!temporaryDocument) {
      toast.error(t("designEditor.toasts.primitiveInsertFailed"));
      return false;
    }
    const enrichedDocument =
      primitive.kind === "path" && primitive.pathData
        ? (() => {
            const reconstructed = parsePenPathFromSerializedD(
              primitive.pathData!,
            );
            return reconstructed
              ? setPenNodesAttributeOnElement(
                  temporaryDocument,
                  nodeId,
                  reconstructed,
                )
              : temporaryDocument;
          })()
        : temporaryDocument;
    const insertedHtml = extractCanvasPrimitiveHtml(enrichedDocument, nodeId);
    if (!insertedHtml) {
      toast.error(t("designEditor.toasts.primitiveInsertFailed"));
      return false;
    }
    pendingTextEditNodeIdRef.current =
      primitive.kind === "text" ? nodeId : null;
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: targetFile.id,
      html: insertedHtml,
      anchor: { selector: "body" },
      placement: "inside",
    });
    return nodeId;
  }
  const hostLayout = resolvePrimitiveCreationHostLayout({
    activeBreakpointWidthState,
    activeFileId: activeFile?.id,
    boardFileId,
    content: insertionBaseContent,
    fileId: targetFile.id,
    overviewScreens,
    primitive: insertionPrimitive,
  });
  if (hostLayout === "stale") {
    toast.error(t("designEditor.toasts.primitiveInsertFailed"));
    return false;
  }
  const insertedContent = appendCanvasPrimitiveToHtml(
    insertionBaseContent,
    insertionPrimitive,
    {
      preserveNegativePosition: targetFile.id === boardFileId,
      isBoardTarget: targetFile.id === boardFileId,
      boardBackground: canvasBackground,
      positioning: hostLayout === "flow" ? "flow" : "absolute",
    },
  );
  if (!insertedContent) {
    toast.error(t("designEditor.toasts.primitiveInsertFailed"));
    return false;
  }
  // Vector-edit foundations: stash the structured pen path (nodes +
  // handles) alongside the flattened `d` so a later double-click/Enter
  // can re-hydrate it into an editable path instead of only having the
  // already-flattened curve. `primitive.pathData` is the only carrier of
  // pen geometry that crosses the MultiScreenCanvas -> DesignEditor
  // boundary for an OVERVIEW-drawn pen path (see
  // parsePenPathFromSerializedD's doc comment for why this reconstructs
  // rather than receives the structured path directly).
  const rawNextContent =
    insertionPrimitive.kind === "path" &&
    insertionPrimitive.pathData &&
    insertionPrimitive.nodeId
      ? (() => {
          const reconstructed = parsePenPathFromSerializedD(
            insertionPrimitive.pathData!,
          );
          return reconstructed
            ? setPenNodesAttributeOnElement(
                insertedContent,
                insertionPrimitive.nodeId!,
                reconstructed,
              )
            : insertedContent;
        })()
      : insertedContent;
  let canonicalPreparation: ReturnType<typeof prepareCanonicalSourceContent>;
  try {
    canonicalPreparation = prepareCanonicalSourceContent(rawNextContent, {
      fileId: targetFile.id,
      fileType: targetFile.fileType,
    });
  } catch {
    toast.error(t("designEditor.toasts.primitiveInsertFailed"));
    return false;
  }
  const nextContent = canonicalPreparation.content;
  const projectionSource = reparentTargetIdentity?.projection.source ?? {
    kind: "design-file" as const,
    fileId: targetFile.id,
  };
  const nextProjection = buildCodeLayerProjection(nextContent, {
    source: projectionSource,
  });
  const projectedNodeId = insertionPrimitive.nodeId
    ? nextProjection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] ===
          insertionPrimitive.nodeId,
      )?.id
    : null;
  let preparedTargetIdentity: ScreenProjectionNodeIdentity | undefined;
  if (preparedTargetNodeId) {
    const preparedTargets = nextProjection.nodes.filter(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        preparedTargetNodeId,
    );
    if (preparedTargets.length !== 1) return false;
    const [preparedTarget] = preparedTargets;
    if (preparedTarget) {
      preparedTargetIdentity = {
        projection: nextProjection,
        nodeId: preparedTarget.id,
        authoredNodeId: preparedTargetNodeId,
      };
    }
  }

  pendingTextCreationHistoryRef.current =
    insertionPrimitive.kind === "text" &&
    insertionPrimitive.nodeId &&
    viewModeRef.current === "overview"
      ? {
          fileId: targetFile.id,
          nodeId: insertionPrimitive.nodeId,
          before: baseContent,
          created: nextContent,
        }
      : null;

  let acceptedPublication: {
    status: "accepted";
    content: string;
    nodeIdMap: ReadonlyMap<string, string>;
  } = {
    status: "accepted",
    content: nextContent,
    nodeIdMap: new Map(nextProjection.nodes.map((node) => [node.id, node.id])),
  };
  if (targetFile.id === activeFile?.id) {
    const publication = applyLocalContentUpdate(nextContent, {
      forcePreviewFullDocument: true,
      historyBeforeContent: baseContent,
      immediateSave: true,
    });
    if (publication.status !== "accepted") return false;
    acceptedPublication = publication;
  } else {
    recordContentHistoryEntry({
      fileId: targetFile.id,
      before: baseContent,
      after: nextContent,
    });
    // Stamp the server-clock base the same way applyFileContentUpdate
    // does. Without it the reconcile effect reads the optimistic cache
    // write below as a server acknowledgement and retires the pending
    // entry immediately, leaving that cache the only carrier of the
    // insert — so any get-design response already in flight (the board
    // file's own lazy migration invalidates on success, so one usually
    // is) overwrites it with pre-insert content and the primitive
    // disappears from the canvas until a reload.
    markPendingLocalFileContent(
      targetFile.id,
      nextContent,
      targetFile.updatedAt,
    );
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
        return old;
      }
      return {
        ...old,
        files: old.files.map((file: DesignFile) =>
          file.id === targetFile.id ? { ...file, content: nextContent } : file,
        ),
      };
    });
    queueFileContentSave(targetFile.id, nextContent, {
      expectedVersionHash: sourceContentHash(baseContent),
      immediate: true,
    });
  }

  const acceptedProjection = projectAcceptedSource(
    acceptedPublication,
    projectionSource,
  );
  if (preparedTargetNodeId) {
    const acceptedTargets = acceptedProjection.nodes.filter(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        preparedTargetNodeId,
    );
    if (acceptedTargets.length !== 1) return false;
    const [acceptedTarget] = acceptedTargets;
    if (!acceptedTarget) return false;
    preparedTargetIdentity = {
      projection: acceptedProjection,
      nodeId: acceptedTarget.id,
      authoredNodeId: preparedTargetNodeId,
    };
  }
  const submittedNode = projectedNodeId
    ? nextProjection.nodes.find((node) => node.id === projectedNodeId)
    : null;
  const acceptedNode = mapAcceptedSelectionNode(
    acceptedPublication,
    acceptedProjection,
    submittedNode,
  );
  const result = acceptedNode?.id ?? false;

  // Record the nodeId when a TEXT primitive is created so the next
  // handlePrimitiveCreated (or handleBoardDrawPrimitive) can immediately
  // enter text-edit mode — fixing the "click to add text should let me
  // type immediately" bug. The ref is read once and cleared.
  if (insertionPrimitive.kind === "text") {
    pendingTextEditNodeIdRef.current = acceptedNode
      ? (acceptedNode.dataAttributes["data-agent-native-node-id"] ?? null)
      : null;
  } else {
    pendingTextEditNodeIdRef.current = null;
  }

  if (preparedTargetNodeId && preparedTargetIdentity) {
    const nodeId =
      typeof result === "string" ? result : insertionPrimitive.nodeId;
    return nodeId
      ? { nodeId, preparedTargetNodeId, preparedTargetIdentity }
      : false;
  }
  return result;
}
