import { buildCodeLayerProjection } from "@shared/code-layer";
import { isRunningAppSourceType } from "@shared/source-mode";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  insertClonedHtmlLayer,
  planLinkedComponentStructureClone,
  type ComponentCloneBatchContext,
} from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerSelectorAliases,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import { isCodeLayerNodeOrDescendant } from "@/pages/design-editor/commands/visual-duplicate-change";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { GeometryHistorySelection } from "@/pages/design-editor/history";
import { captureHistorySelectionSources } from "@/pages/design-editor/history-identity";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLinkedComponentEdit } from "./linked-component-structure";

export interface ScreenVisualDuplicateChangeArgs {
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  componentLinksForFile?: (fileId: string) => ComponentCloneBatchContext;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
  canEditLiveScreen?: (screenId: string) => boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getScreenContent: (screenId: string) => string;
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
    },
  ) => void;
  remapMotionTracksForClone?: (
    nodeIdMap: Map<string, string>,
    targetFileId: string,
  ) => void;
  selectionBefore?: GeometryHistorySelection;
  handleVisualDuplicateChange: (
    selector: string,
    cloneHtml: string,
    elementInfo?: ElementInfo,
    details?: {
      sourceId?: string;
      sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
      anchorSelector?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      placement?: "before" | "after" | "inside";
    },
  ) => boolean | "pending";
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runScreenVisualDuplicateChange(
  {
    activeFile,
    applyLinkedComponentEdit,
    applyFileContentUpdate,
    canEditDesign,
    canEditLiveScreen,
    componentLinksForFile,
    designSourceType,
    getScreenContent,
    handleVisualDuplicateChange,
    overviewScreens,
    recordPendingLiveStructureEdit,
    remapMotionTracksForClone,
    selectionBefore,
    t,
  }: ScreenVisualDuplicateChangeArgs,
  screenId: string,
  selector: string,
  cloneHtml: string,
  elementInfo?: ElementInfo,
  details?: {
    sourceId?: string;
    sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
    anchorSelector?: string;
    anchorSourceId?: string;
    anchorElementInfo?: ElementInfo;
    requestId?: string;
    dropMode?: "flow-insert" | "absolute-container";
    forceFlowPositionOverride?: boolean;
    sourceRect?: { x: number; y: number; width: number; height: number };
    anchorRect?: { x: number; y: number; width: number; height: number };
    placement?: "before" | "after" | "inside";
  },
) {
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType = resolveOverviewScreenSourceType(
    overviewScreen,
    designSourceType,
  );
  const canEditScreen =
    canEditDesign ||
    (screenSourceType === "localhost" && canEditLiveScreen?.(screenId));
  if (!canEditScreen) return false;
  if (isRunningAppSourceType(screenSourceType)) {
    recordPendingLiveStructureEdit(
      screenId,
      elementInfo?.runtimeSelector ?? elementInfo?.selector ?? selector,
      details?.anchorSelector ?? selector,
      details?.placement ?? "after",
      elementInfo,
      {
        sourceId: elementInfo?.runtimeSourceId || elementInfo?.sourceId,
        anchorSourceId: details?.anchorSourceId || details?.sourceId,
        anchorElementInfo: details?.anchorElementInfo,
        requestId: details?.requestId,
        dropMode: details?.dropMode,
        forceFlowPositionOverride: details?.forceFlowPositionOverride,
        sourceRect: details?.sourceRect,
        anchorRect: details?.anchorRect,
        insertedHtml: cloneHtml,
      },
    );
    return "pending";
  }
  if (screenId === activeFile?.id) {
    return (
      handleVisualDuplicateChange(selector, cloneHtml, elementInfo, details) !==
      false
    );
  }
  let structureUnsupported = false;
  const onUnsupportedStructure = () => {
    structureUnsupported = true;
    toast.error(
      t("designEditor.componentInstances.linkedStructureUnsupported"),
    );
  };
  const baseContent = getScreenContent(screenId);
  const source = { kind: "design-file" as const, fileId: screenId };
  const projection = buildCodeLayerProjection(baseContent, { source });
  const targetInfo = elementInfo
    ? {
        ...elementInfo,
        selector,
        sourceId: details?.sourceId ?? elementInfo.sourceId,
      }
    : null;
  const targetNode = targetInfo
    ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
    : resolveCodeLayerNodeFromBridge(projection, selector, details?.sourceId);
  const anchorNode = resolveCodeLayerNodeFromBridge(
    projection,
    details?.anchorSelector,
    details?.anchorSourceId,
  );
  const anchorNestedInTarget =
    targetNode &&
    anchorNode &&
    isCodeLayerNodeOrDescendant(projection, anchorNode.id, targetNode.id);
  const effectiveAnchorNode = anchorNestedInTarget ? targetNode : anchorNode;
  const effectivePlacement = anchorNestedInTarget
    ? "after"
    : (details?.placement ?? "after");
  const cloneOptions = {
    onUnsupportedStructure,
    targetSelectors: targetNode
      ? codeLayerSelectorAliases(targetNode)
      : [selector],
    anchorSelectors: effectiveAnchorNode
      ? codeLayerSelectorAliases(effectiveAnchorNode)
      : details?.anchorSelector
        ? [details.anchorSelector]
        : undefined,
    placement: effectivePlacement,
    preserveIncomingNodeIds: true,
    componentLinks: componentLinksForFile
      ? {
          ...componentLinksForFile(screenId),
          sourceNodeIdMaps: [details?.sourceNodeIdMap],
        }
      : undefined,
  };
  const linkedPlan = applyLinkedComponentEdit
    ? planLinkedComponentStructureClone(baseContent, [cloneHtml], cloneOptions)
    : null;
  if (linkedPlan && applyLinkedComponentEdit) {
    const linkedSelectionBefore =
      targetNode && selectionBefore
        ? captureHistorySelectionSources(
            {
              ...selectionBefore,
              activeFileId: screenId,
              selectedLayerIds: [targetNode.id],
            },
            {
              ...selectionBefore.sourceContentByFileId,
              [screenId]: baseContent,
            },
          )
        : selectionBefore;
    applyLinkedComponentEdit(
      screenId,
      linkedPlan.targetNodeId,
      {
        kind: "structure",
        before: linkedPlan.mainBefore,
        after: linkedPlan.mainAfter,
        selectionNodeIds: linkedPlan.selectionNodeIds,
      },
      linkedSelectionBefore,
      remapMotionTracksForClone
        ? () => remapMotionTracksForClone(linkedPlan.nodeIdMap, screenId)
        : undefined,
    );
    return true;
  }
  const nextContent = insertClonedHtmlLayer(
    baseContent,
    cloneHtml,
    cloneOptions,
  );
  if (structureUnsupported) return false;
  if (!nextContent) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return false;
  }
  applyFileContentUpdate(screenId, nextContent, {
    skipPreview: true,
    historyBeforeContent: baseContent,
  });
  return true;
}
