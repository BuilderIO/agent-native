import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

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
import type { PendingTextCreationHistory } from "@/pages/design-editor/history";
import {
  getLivePreviewDocument,
  isFlowDisplay,
} from "@/pages/design-editor/live-layer-move-layout";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface CreatePrimitiveArgs {
  activeBreakpointWidthState?: number;
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      forcePreviewFullDocument?: boolean;
      historyBeforeContent?: string;
    },
  ) => ApplyFileContentUpdateResult;
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
  canvasBackground: string | null | undefined;
  canEditDesign: boolean;
  files: DesignFile[];
  getScreenContent: (fileId: string) => string;
  pendingTextCreationHistoryRef: RefObject<PendingTextCreationHistory | null>;
  pendingTextEditNodeIdRef: RefObject<string | null>;
  overviewScreens?: readonly OverviewScreen[];
  runtimeStructureInsertRevisionRef: RefObject<number>;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
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
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    boardFileId,
    canvasBackground,
    canEditDesign,
    files,
    getScreenContent,
    pendingTextCreationHistoryRef,
    pendingTextEditNodeIdRef,
    overviewScreens,
    runtimeStructureInsertRevisionRef,
    setRuntimeStructureInsertRequest,
    t,
    viewModeRef,
  }: CreatePrimitiveArgs,
  screenId: string,
  primitive: CanvasPrimitiveInsert,
  options?: { reparentTargetIdentity?: ScreenProjectionNodeIdentity },
) {
  if (!canEditDesign) return false;
  const targetFile = files.find((file) => file.id === screenId);
  if (!targetFile) return false;
  const baseContent = getScreenContent(targetFile.id);
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
      primitive.kind === "path" && (primitive.penPath || primitive.pathData)
        ? (() => {
            const penPath =
              primitive.penPath ??
              parsePenPathFromSerializedD(primitive.pathData!);
            return penPath
              ? setPenNodesAttributeOnElement(
                  temporaryDocument,
                  nodeId,
                  penPath,
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
  const rawNextContent =
    insertionPrimitive.kind === "path" && insertionPrimitive.nodeId
      ? (() => {
          const penPath =
            insertionPrimitive.penPath ??
            (insertionPrimitive.pathData
              ? parsePenPathFromSerializedD(insertionPrimitive.pathData)
              : null);
          return penPath
            ? setPenNodesAttributeOnElement(
                insertedContent,
                insertionPrimitive.nodeId!,
                penPath,
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
    const publication = applyFileContentUpdate(targetFile.id, nextContent, {
      forcePreviewFullDocument: true,
      historyBeforeContent: baseContent,
    });
    if (publication.status !== "accepted") return false;
    acceptedPublication = publication;
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
