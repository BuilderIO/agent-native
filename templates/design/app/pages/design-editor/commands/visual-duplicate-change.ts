import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { insertClonedHtmlLayer } from "@/pages/design-editor/clone-and-pen-edit";
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

export function runVisualDuplicateChange(
  {
    activeFile,
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
    anchorSelector?: string;
    anchorSourceId?: string;
    placement?: "before" | "after" | "inside";
  },
) {
  if (!canEditDesign) return false;
  if (!activeFile) return false;
  const baseContent = getFreshActiveContent();
  const projection = buildCodeLayerProjection(baseContent);
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
  const nextContent = insertClonedHtmlLayer(baseContent, cloneHtml, {
    targetSelectors: targetNode
      ? codeLayerSelectorAliases(targetNode)
      : [selector],
    anchorSelectors: anchorNode
      ? codeLayerSelectorAliases(anchorNode)
      : details?.anchorSelector
        ? [details.anchorSelector]
        : undefined,
    placement: details?.placement ?? "after",
    preserveIncomingNodeIds: true,
  });
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
  const nextProjection = buildCodeLayerProjection(nextContent);
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
