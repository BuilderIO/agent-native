import { stripBoardSurfaceOffsetFromCoord } from "@shared/board-file";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import { normalizeDesignSourceType } from "@shared/source-mode";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import { dndHostLog } from "@/components/design/dnd-debug";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  isAbsoluteCodeLayerNode,
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
  setFlowPositioningOverrideForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import type { DesignFile } from "@/pages/design-editor/types";

export interface ScreenVisualStructureChangeArgs {
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getScreenContent: (screenId: string) => string;
  handleVisualStructureChange: (
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
    },
  ) => boolean | "pending";
  overviewScreens: OverviewScreen[];
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
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runScreenVisualStructureChange(
  {
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    designSourceType,
    getScreenContent,
    handleVisualStructureChange,
    overviewScreens,
    recordPendingLiveStructureEdit,
    setActiveFileId,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
  }: ScreenVisualStructureChangeArgs,
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
    /** Markup this change introduced; the subject does not exist in the
     * screen's source yet, so it must be added rather than relocated. */
    insertedHtml?: string;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
  },
) {
  if (screenId === activeFile?.id) {
    return handleVisualStructureChange(
      selector,
      anchorSelector,
      placement,
      elementInfo,
      details,
    );
  }
  if (!canEditDesign) return false;
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType =
    normalizeDesignSourceType(overviewScreen?.sourceType) ?? designSourceType;
  if (screenSourceType === "localhost") {
    recordPendingLiveStructureEdit(
      screenId,
      selector,
      anchorSelector,
      placement,
      elementInfo,
      details,
    );
    return "pending";
  }
  const baseContent = getScreenContent(screenId);
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
    target: targetNode ? { nodeId: targetNode.id } : { selector },
    anchor: anchorNode
      ? { nodeId: anchorNode.id }
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
  // Same board-surface offset-poison guard as handleVisualStructureChange
  // above: strip the 65536 fingerprint from the bridge's rect-space
  // offset before persisting, and refresh the preview when it fired so
  // the bridge's equally-off optimistic placement gets corrected.
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
  applyFileContentUpdate(
    screenId,
    nextContent,
    absoluteOffsetWasPoisoned
      ? { forcePreviewFullDocument: true }
      : { skipPreview: true },
  );
  const movedNode =
    (movedNodeAttrId
      ? nextProjection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] ===
            movedNodeAttrId,
        )
      : null) ??
    resolveCodeLayerNodeFromBridge(
      nextProjection,
      selector,
      details?.sourceId ??
        elementInfo?.sourceId ??
        (targetNode ? bridgeSourceIdForCodeLayerNode(targetNode) : undefined),
    );
  if (movedNode) {
    setActiveFileId(screenId);
    setSelectedLayerIdsState([movedNode.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(movedNode));
  } else {
    setSelectedElement(null);
  }
  return true;
}
