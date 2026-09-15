import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "@/pages/design-editor/commands/selection-publication";
import {
  captureContentUndoStackTop,
  captureYjsUndoStackTop,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  stampContentHistorySelectionAfter,
  stampYjsUndoSelection,
  stampYjsUndoSelectionAfter,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface GroupSelectionArgs {
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
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
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
  contentHistorySelectionAfterRef: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef: RefObject<ContentHistoryEntry[]>;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  overviewSelectedScreenIds: string[];
  selectedLayerIdsState: string[];
  sendRuntimeLayerSemanticHandoff: (
    operation: "group" | "ungroup" | "auto-layout",
    layerIds: readonly string[],
    options?: {
      desiredChange?: string;
      description?: string;
      commandContext?: string;
    },
  ) => boolean;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
}

export function runGroupSelection({
  activeFile,
  applyLocalContentUpdate,
  canEditDesign,
  codeLayerOwnerByNodeIdRef,
  contentHistorySelectionAfterRef,
  contentUndoStackRef,
  files,
  getFreshActiveContent,
  overviewSelectedScreenIds,
  selectedLayerIdsState,
  sendRuntimeLayerSemanticHandoff,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
  undoManagerRef,
}: GroupSelectionArgs) {
  trace("structure", "group", { layers: selectedLayerIdsState.length });
  if (!canEditDesign || !activeFile) return;
  const selectedRuntimeLayerIds = selectedLayerIdsState.filter(
    (layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId)?.runtimeOnly,
  );
  if (selectedRuntimeLayerIds.length > 0) {
    sendRuntimeLayerSemanticHandoff("group", selectedRuntimeLayerIds);
    return;
  }
  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  // Collect the DOM-node layer ids that belong to the active screen.
  // Build a set of ids present in the active content so stale ids from
  // other files (which can persist in selectedLayerIdsState after a
  // cross-screen layers-panel selection) are excluded before wrapNodes
  // runs against activeContent. Without this filter, cross-file ids
  // cause wrapNodes to return "conflict" even for a valid same-file
  // selection.
  const fileIds = new Set(files.map((f) => f.id));
  const baseProjection = buildCodeLayerProjection(baseContent, { source });
  const activeNodeIdSet = buildActiveFileNodeIdSet(baseProjection);
  const nodeIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (nodeIds.length === 0) return;
  const patch = applyVisualEdit(
    baseContent,
    {
      kind: "wrapNodes",
      targetIds: nodeIds,
      autoLayout: false,
    },
    { source },
  );
  if (patch.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        patch.result.message,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
      { duration: 4000 },
    );
    return;
  }
  const nextContent = patch.content;
  // Figma-parity undo/redo selection restore: capture the ORIGINAL (ungrouped)
  // selection before the write so undo can hand it back. Figma groups a
  // single object too (see canGroup in DesignEditor.tsx), and undoing THAT
  // must restore the one element that was selected, not clear selection —
  // only an actual multi-select gesture has no single canonical element.
  // See history.ts's YjsUndoSelectionSnapshot doc comment.
  const selectionBeforeGroup = {
    selectedElement:
      nodeIds.length === 1
        ? (() => {
            const soleNode = baseProjection.nodes.find(
              (node) => node.id === nodeIds[0],
            );
            return soleNode ? elementInfoFromCodeLayerNode(soleNode) : null;
          })()
        : null,
    selectedLayerIds: nodeIds,
  };
  const undoStackTopBeforeGroup = captureYjsUndoStackTop(
    undoManagerRef.current,
  );
  const contentUndoStackTopBeforeGroup = captureContentUndoStackTop(
    contentUndoStackRef.current,
  );
  const submittedProjection = buildCodeLayerProjection(nextContent, { source });
  const submittedWrapper = patch.result.wrapperNodeId
    ? submittedProjection.nodes.find(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] ===
          patch.result.wrapperNodeId,
      )
    : undefined;
  const publication = applyLocalContentUpdate(nextContent, {
    forcePreviewFullDocument: true,
    selectionBefore: selectionBeforeGroup,
  });
  if (publication.status !== "accepted") return;
  const acceptedProjection = projectAcceptedSource(publication, source);
  const wrapperNode = mapAcceptedSelectionNode(
    publication,
    acceptedProjection,
    submittedWrapper,
  );
  stampYjsUndoSelection(
    undoManagerRef.current,
    undoStackTopBeforeGroup,
    selectionBeforeGroup,
  );
  // Select the new wrapper node if the substrate reported its id.
  if (wrapperNode) {
    setSelectedLayerIdsState([wrapperNode.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
    // Figma parity: redo re-selects the group this gesture produced, not
    // the pre-group selection undo restores. The write lands on whichever
    // of the two stacks is actually tracking it (Yjs in single-screen
    // mode, the plain content-history stack in overview mode); both
    // stamps are harmless no-ops on the stack that didn't receive it.
    stampYjsUndoSelectionAfter(
      undoManagerRef.current,
      undoStackTopBeforeGroup,
      {
        selectedElement: elementInfoFromCodeLayerNode(wrapperNode),
        selectedLayerIds: [wrapperNode.id],
      },
    );
    stampContentHistorySelectionAfter(
      contentUndoStackRef.current,
      contentHistorySelectionAfterRef.current,
      contentUndoStackTopBeforeGroup,
      {
        overviewSelectedScreenIds,
        selectedLayerIds: [wrapperNode.id],
        activeFileId: activeFile.id,
      },
    );
  }
}
