import { buildCodeLayerProjection } from "@shared/code-layer";
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
import type { GeometryHistorySelection } from "@/pages/design-editor/history";
import { captureHistorySelectionSources } from "@/pages/design-editor/history-identity";
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
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
  getScreenContent: (screenId: string) => string;
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
      placement?: "before" | "after" | "inside";
    },
  ) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runScreenVisualDuplicateChange(
  {
    activeFile,
    applyLinkedComponentEdit,
    applyFileContentUpdate,
    canEditDesign,
    componentLinksForFile,
    getScreenContent,
    handleVisualDuplicateChange,
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
    placement?: "before" | "after" | "inside";
  },
) {
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
  if (!canEditDesign) return false;
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
  // See the matching guard in visual-duplicate-change.ts: a same-row
  // flow-reorder can resolve its own drop anchor onto the source node or a
  // descendant of it, nesting the copy inside the element it was copied
  // from — a structure assertDesignHtmlEditIntegrity rejects outright.
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
  applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
  return true;
}
