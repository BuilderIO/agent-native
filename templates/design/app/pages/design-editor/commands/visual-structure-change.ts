import { stripBoardSurfaceOffsetFromCoord } from "@shared/board-file";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import { dndHostLog } from "@/components/design/dnd-debug";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  preferredCodeLayerSelector,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import {
  isAbsoluteCodeLayerNode,
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
  setFlowPositioningOverrideForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import type { DesignFile } from "@/pages/design-editor/types";

export interface VisualStructureChangeArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
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
  ) => void;
  canEditDesign: boolean;
  getFreshActiveContent: () => string;
  recordPendingLiveStructureEdit: (
    screenId: string,
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    elementInfo?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      insertedHtml?: string;
      replaced?: true;
      replacementSelector?: string;
      replacementSourceId?: string;
      removed?: true;
    },
  ) => void;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runVisualStructureChange(
  {
    activeCanvasSourceType,
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    getFreshActiveContent,
    recordPendingLiveStructureEdit,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
  }: VisualStructureChangeArgs,
  selector: string,
  anchorSelector: string,
  placement: "before" | "after" | "inside",
  elementInfo?: ElementInfo,
  details?: {
    sourceId?: string;
    anchorSourceId?: string;
    anchorElementInfo?: ElementInfo;
    requestId?: string;
    dropMode?: "flow-insert" | "absolute-container";
    forceFlowPositionOverride?: boolean;
    sourceRect?: { x: number; y: number; width: number; height: number };
    anchorRect?: { x: number; y: number; width: number; height: number };
    /** Markup this change introduced; the subject does not exist in the
     * screen's source yet, so it must be added rather than relocated. */
    insertedHtml?: string;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
  },
) {
  dndHostLog("persist:begin", {
    selector,
    anchorSelector,
    placement,
    dropMode: details?.dropMode,
    source: activeCanvasSourceType,
  });
  if (!canEditDesign) return false;
  if (!activeFile) return false;
  if (activeCanvasSourceType === "localhost") {
    recordPendingLiveStructureEdit(
      activeFile.id,
      selector,
      anchorSelector,
      placement,
      elementInfo,
      details,
    );
    return "pending";
  }
  const baseContent = getFreshActiveContent();
  const projection = buildCodeLayerProjection(baseContent);
  const resolveBridgeNode = (targetSelector: string, sourceId?: string) =>
    resolveCodeLayerNodeFromBridge(projection, targetSelector, sourceId);
  const targetInfo = elementInfo
    ? {
        ...elementInfo,
        selector,
        sourceId: details?.sourceId ?? elementInfo.sourceId,
      }
    : null;
  const targetNode = targetInfo
    ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
    : resolveBridgeNode(selector, details?.sourceId);
  const anchorNode = resolveBridgeNode(anchorSelector, details?.anchorSourceId);
  const patch = applyVisualEdit(baseContent, {
    kind: "moveNode",
    // Keep the bridge's stable source id on the fallback: resolving by
    // selector alone fails for stamped nodes, and the resolver tries
    // nodeId first before falling back to the selector anyway.
    target: targetNode
      ? { nodeId: targetNode.id }
      : details?.sourceId
        ? { nodeId: details.sourceId, selector }
        : { selector },
    anchor: anchorNode
      ? { nodeId: anchorNode.id }
      : details?.anchorSourceId
        ? { nodeId: details.anchorSourceId, selector: anchorSelector }
        : { selector: anchorSelector },
    placement,
  });
  dndHostLog("persist:rewrite", {
    status: patch.result.status,
    message: patch.result.message,
  });
  if (patch.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        patch.result.message,
        t("designEditor.toasts.layerMoveFailed"),
      ),
      { duration: 4000 },
    );
    return false;
  }
  const movedNodeAttrId =
    targetNode?.dataAttributes["data-agent-native-node-id"] ??
    details?.sourceId ??
    elementInfo?.sourceId ??
    (patch.result.after?.nodeId
      ? patch.projection.nodes.find(
          (node) => node.id === patch.result.after?.nodeId,
        )?.dataAttributes["data-agent-native-node-id"]
      : undefined);
  // Absolute-container drops persist sourceRect − anchorRect (both
  // measured in-iframe by the bridge AFTER its optimistic DOM move). On
  // the BOARD surface, top-level elements carry the content-offset
  // translate (+65536 — see embeddedContentOffsetStyle in
  // DesignCanvas.tsx) while nested ones do not, and the bridge's
  // rect-space delta math doesn't model that translate — the measured
  // offset for a board nest comes out exactly one surface offset
  // (65536px) away from the true parent-relative value and, persisted
  // verbatim, parks the nested child off-world. Strip that fingerprint
  // before persisting (a no-op for screens and for sane offsets), and
  // when it fired, ALSO refresh the preview: the bridge's optimistic
  // in-iframe placement was off by the same 65536, so the iframe must be
  // re-rendered from the corrected content instead of being trusted.
  const rawAbsoluteContainerOffset =
    details?.dropMode === "absolute-container" &&
    details.sourceRect &&
    details.anchorRect
      ? {
          x: details.sourceRect.x - details.anchorRect.x,
          y: details.sourceRect.y - details.anchorRect.y,
        }
      : null;
  const absoluteContainerOffset = rawAbsoluteContainerOffset
    ? {
        x: stripBoardSurfaceOffsetFromCoord(rawAbsoluteContainerOffset.x),
        y: stripBoardSurfaceOffsetFromCoord(rawAbsoluteContainerOffset.y),
      }
    : null;
  const absoluteOffsetWasPoisoned = Boolean(
    rawAbsoluteContainerOffset &&
    absoluteContainerOffset &&
    (rawAbsoluteContainerOffset.x !== absoluteContainerOffset.x ||
      rawAbsoluteContainerOffset.y !== absoluteContainerOffset.y),
  );
  const nextContent =
    movedNodeAttrId && details?.dropMode === "absolute-container"
      ? absoluteContainerOffset
        ? setAbsolutePositioningForNodeInHtml(
            patch.content,
            movedNodeAttrId,
            absoluteContainerOffset,
          )
        : patch.content
      : movedNodeAttrId &&
          details?.dropMode === "flow-insert" &&
          details.forceFlowPositionOverride
        ? setFlowPositioningOverrideForNodeInHtml(
            patch.content,
            movedNodeAttrId,
          )
        : isAbsoluteCodeLayerNode(targetNode) && movedNodeAttrId
          ? removeAbsolutePositioningFromNodeInHtml(
              patch.content,
              movedNodeAttrId,
            )
          : patch.content;
  const nextProjection = buildCodeLayerProjection(nextContent);
  const movedNode =
    (movedNodeAttrId
      ? nextProjection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] ===
            movedNodeAttrId,
        )
      : null) ??
    (patch.result.after?.nodeId
      ? nextProjection.nodes.find(
          (node) => node.id === patch.result.after?.nodeId,
        )
      : null) ??
    resolveCodeLayerNodeFromBridge(
      nextProjection,
      selector,
      details?.sourceId ??
        elementInfo?.sourceId ??
        (targetNode ? bridgeSourceIdForCodeLayerNode(targetNode) : undefined),
    );
  applyLocalContentUpdate(
    nextContent,
    absoluteOffsetWasPoisoned
      ? { forcePreviewFullDocument: true }
      : { skipPreview: true },
  );
  if (movedNode) setSelectedLayerIdsState([movedNode.id]);
  if (elementInfo) {
    setSelectedElement({
      ...elementInfo,
      sourceId: movedNode
        ? bridgeSourceIdForCodeLayerNode(movedNode)
        : elementInfo.sourceId,
      selector: movedNode
        ? preferredCodeLayerSelector(movedNode)
        : elementInfo.selector,
    });
  }
  return true;
}
