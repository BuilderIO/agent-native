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
import type { DesignFile } from "@/pages/design-editor/types";

export interface VisualDuplicateChangeArgs {
  activeFile: DesignFile;
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
  getFreshActiveContent: () => string;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: { current: Y.UndoManager | null };
}

/** Walks `parentId` from `nodeId` up to the root; true when `ancestorId` is
 * `nodeId` itself or any node above it. Exported for unit testing. */
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
    componentLinks,
    applyLocalContentUpdate,
    canEditDesign,
    getFreshActiveContent,
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
  if (!canEditDesign) return false;
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
  // The bridge's own-row drop-target resolution can land the clone's anchor
  // on the SOURCE node itself or on one of ITS descendants (e.g. a same-row
  // flow-reorder that barely moves the clone off the original resolves the
  // original's auto-wrapped text span as the nearest "after" anchor) —
  // inserting next to that anchor lands the clone INSIDE the element it was
  // copied from, however "placement" reads: "inside" nests it directly,
  // and "before"/"after" a descendant still lands it in that descendant's
  // parent's subtree. A duplicate is never a legal child of its own source,
  // and DOMParser lets the DOM API build that structure even where the
  // HTML5 content model (button-in-button, etc.) forbids it, so it
  // round-trips into a document assertDesignHtmlEditIntegrity rejects — the
  // write is silently dropped and the optimistic clone the bridge already
  // spliced into the live iframe is left stranded with no history entry to
  // undo. Retarget to a plain "after" sibling of the source itself,
  // matching Figma parity's own duplicate default.
  const anchorNestedInTarget =
    targetNode &&
    anchorNode &&
    isCodeLayerNodeOrDescendant(projection, anchorNode.id, targetNode.id);
  const effectiveAnchorNode = anchorNestedInTarget ? targetNode : anchorNode;
  const effectivePlacement = anchorNestedInTarget
    ? "after"
    : (details?.placement ?? "after");
  const nextContent = insertClonedHtmlLayer(baseContent, cloneHtml, {
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
  });
  if (structureUnsupported) return false;
  if (!nextContent) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return false;
  }
  // Figma-parity undo selection restore: snapshot the ORIGINAL (pre-clone)
  // selection so a later Cmd+Z can land back on it instead of on the copy
  // undo is about to remove — see stampYjsUndoSelection's / ContentHistory-
  // Change.selectionBefore's doc comments. This must come from `targetNode`,
  // resolved above against the PRE-insert projection, not from the live
  // selectedElement/selectedLayerIdsState props: the bridge selects the
  // clone the instant alt-drag creates it (at gesture START), so by the time
  // this persist runs at gesture END, host selection state already IS the
  // copy — reading it here would stamp the copy's own selection onto its
  // own removal.
  const selectionBeforeDuplicate = targetNode
    ? {
        selectedElement: elementInfoFromCodeLayerNode(targetNode),
        selectedLayerIds: [targetNode.id],
      }
    : { selectedElement, selectedLayerIds: selectedLayerIdsState };
  const undoStackTopBeforeDuplicate = captureYjsUndoStackTop(
    undoManagerRef.current,
  );
  // Structural insert: a selector-scoped push matches the live clone but
  // not the re-keyed copy in the new source, and the bridge deletes what
  // it cannot match.
  applyLocalContentUpdate(nextContent, {
    refreshPreview: false,
    forcePreviewFullDocument: true,
    // Covers the write landing on the NON-Yjs local fallback stack (the
    // Yjs UndoManager isn't ready yet — e.g. `!isSynced` right after a
    // fresh page load). The stampYjsUndoSelection call below covers the
    // Yjs stack when it IS ready. Whichever stack actually receives this
    // write is the one undo will read the selection back from.
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
