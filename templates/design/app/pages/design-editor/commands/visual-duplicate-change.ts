import {
  buildCodeLayerProjection,
  type CodeLayerProjection,
} from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  planLinkedComponentStructureClone,
  insertClonedHtmlLayer,
  type ComponentCloneBatchContext,
} from "@/pages/design-editor/clone-and-pen-edit";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSelectorAliases,
  elementInfoFromCodeLayerNode,
  preferredCodeLayerSelector,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import {
  captureYjsUndoStackTop,
  stampYjsUndoSelection,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import type { GeometryHistorySelection } from "@/pages/design-editor/history";
import { captureHistorySelectionSources } from "@/pages/design-editor/history-identity";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLinkedComponentEdit } from "./linked-component-structure";

export interface VisualDuplicateChangeArgs {
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  componentLinks?: ComponentCloneBatchContext;
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
      selectionBefore?: YjsUndoSelectionSnapshot;
    },
  ) => void;
  canEditDesign: boolean;
  canEditLiveScreen?: boolean;
  getFreshActiveContent: () => string;
  remapMotionTracksForClone?: (
    nodeIdMap: Map<string, string>,
    targetFileId: string,
  ) => void;
  selectionBefore?: GeometryHistorySelection;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: { current: Y.UndoManager | null };
}

export function isCodeLayerNodeOrDescendant(
  projection: CodeLayerProjection,
  nodeId: string,
  ancestorId: string,
): boolean {
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  let current: string | undefined = nodeId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = nodesById.get(current)?.parentId;
  }
  return false;
}

export function runVisualDuplicateChange(
  {
    activeFile,
    applyLinkedComponentEdit,
    componentLinks,
    applyLocalContentUpdate,
    canEditDesign,
    canEditLiveScreen,
    getFreshActiveContent,
    remapMotionTracksForClone,
    selectionBefore,
    selectedElement,
    selectedLayerIdsState,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    undoManagerRef,
  }: VisualDuplicateChangeArgs,
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
  let structureUnsupported = false;
  const onUnsupportedStructure = () => {
    structureUnsupported = true;
    toast.error(
      t("designEditor.componentInstances.linkedStructureUnsupported"),
    );
  };
  if (!canEditDesign && !canEditLiveScreen) return false;
  if (!activeFile) return false;
  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
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
    componentLinks: componentLinks
      ? {
          ...componentLinks,
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
              activeFileId: activeFile.id,
              selectedLayerIds: [targetNode.id],
            },
            {
              ...selectionBefore.sourceContentByFileId,
              [activeFile.id]: baseContent,
            },
          )
        : selectionBefore;
    applyLinkedComponentEdit(
      activeFile.id,
      linkedPlan.targetNodeId,
      {
        kind: "structure",
        before: linkedPlan.mainBefore,
        after: linkedPlan.mainAfter,
        selectionNodeIds: linkedPlan.selectionNodeIds,
      },
      linkedSelectionBefore,
      remapMotionTracksForClone
        ? () => remapMotionTracksForClone(linkedPlan.nodeIdMap, activeFile.id)
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
  const selectionBeforeDuplicate = targetNode
    ? {
        selectedElement: elementInfoFromCodeLayerNode(targetNode),
        selectedLayerIds: [targetNode.id],
      }
    : { selectedElement, selectedLayerIds: selectedLayerIdsState };
  const undoStackTopBeforeDuplicate = captureYjsUndoStackTop(
    undoManagerRef.current,
  );
  applyLocalContentUpdate(nextContent, {
    refreshPreview: false,
    forcePreviewFullDocument: true,
    historyBeforeContent: baseContent,
    selectionBefore: selectionBeforeDuplicate,
  });
  stampYjsUndoSelection(
    undoManagerRef.current,
    undoStackTopBeforeDuplicate,
    selectionBeforeDuplicate,
  );
  const nextProjection = buildCodeLayerProjection(nextContent, { source });
  const nextNode = elementInfo
    ? resolveCodeLayerNodeFromElementInfo(nextProjection, elementInfo)
    : null;
  if (nextNode) {
    setSelectedLayerIdsState([nextNode.id]);
    setSelectedElement({
      ...(elementInfo ?? elementInfoFromCodeLayerNode(nextNode)),
      sourceId: bridgeSourceIdForCodeLayerNode(nextNode),
      selector: preferredCodeLayerSelector(nextNode),
    });
  } else if (elementInfo) {
    setSelectedElement(elementInfo);
  }
  return true;
}
