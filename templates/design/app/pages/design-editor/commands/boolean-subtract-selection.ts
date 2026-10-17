import { LINKED_COMPONENT_STRUCTURE_REFUSAL } from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";
import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import {
  captureContentUndoStackTop,
  captureYjsUndoStackTop,
  stampContentHistorySelectionAfter,
  stampYjsUndoSelection,
  stampYjsUndoSelectionAfter,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface BooleanSubtractSelectionArgs {
  activeFile: DesignFile | null | undefined;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      forcePreviewFullDocument?: boolean;
      selectionBefore?: YjsUndoSelectionSnapshot;
    },
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  contentHistorySelectionAfterRef: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef: RefObject<ContentHistoryEntry[]>;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  overviewSelectedScreenIds: string[];
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
}

export function runBooleanSubtractSelection({
  activeFile,
  applyLocalContentUpdate,
  canEditDesign,
  contentHistorySelectionAfterRef,
  contentUndoStackRef,
  files,
  getFreshActiveContent,
  overviewSelectedScreenIds,
  selectedLayerIdsState,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
  undoManagerRef,
}: BooleanSubtractSelectionArgs) {
  if (!canEditDesign || !activeFile) return;

  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const fileIds = new Set(files.map((file) => file.id));
  const activeNodeIdSet = buildActiveFileNodeIdSet(
    buildCodeLayerProjection(baseContent, { source }),
  );
  const targetIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id),
  );
  if (targetIds.length < 2 && selectedLayerIdsState.length < 2) return;
  if (
    targetIds.length !== selectedLayerIdsState.length ||
    targetIds.some((id) => !activeNodeIdSet.has(id))
  ) {
    toast.error(t("designEditor.toasts.booleanSubtractUnsupported"), {
      duration: 4000,
    });
    return;
  }
  if (targetIds.length < 2) return;

  const patch = applyVisualEdit(
    baseContent,
    {
      kind: "booleanSubtract",
      targetIds,
    },
    { source },
  );
  if (patch.result.status !== "applied") {
    toast.error(
      patch.result.message === LINKED_COMPONENT_STRUCTURE_REFUSAL
        ? t("designEditor.componentInstances.linkedStructureUnsupported")
        : patch.result.status === "unsupported"
          ? t("designEditor.toasts.booleanSubtractUnsupported")
          : t("designEditor.toasts.booleanSubtractFailed"),
      { duration: 4000 },
    );
    return;
  }

  const selectionBeforeBoolean: YjsUndoSelectionSnapshot = {
    selectedElement: null,
    selectedLayerIds: targetIds,
  };
  const undoStackTopBeforeBoolean = captureYjsUndoStackTop(
    undoManagerRef.current,
  );
  const contentUndoStackTopBeforeBoolean = captureContentUndoStackTop(
    contentUndoStackRef.current,
  );
  const publication = applyLocalContentUpdate(patch.content, {
    forcePreviewFullDocument: true,
    selectionBefore: selectionBeforeBoolean,
  });
  if (publication.status !== "accepted") return;
  stampYjsUndoSelection(
    undoManagerRef.current,
    undoStackTopBeforeBoolean,
    selectionBeforeBoolean,
  );
  const wrapperNodeId = patch.result.wrapperNodeId;
  if (!wrapperNodeId) return;
  const wrapperNode = patch.projection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === wrapperNodeId,
  );
  if (!wrapperNode) return;
  const acceptedProjection = projectAcceptedSource(
    publication,
    patch.projection.source,
  );
  const acceptedWrapper = mapAcceptedSelectionNode(
    publication,
    acceptedProjection,
    wrapperNode,
  );
  if (!acceptedWrapper) return;
  const wrapperInfo = elementInfoFromCodeLayerNode(acceptedWrapper);
  setSelectedLayerIdsState([acceptedWrapper.id]);
  setSelectedElement(wrapperInfo);
  stampYjsUndoSelectionAfter(
    undoManagerRef.current,
    undoStackTopBeforeBoolean,
    {
      selectedElement: wrapperInfo,
      selectedLayerIds: [acceptedWrapper.id],
    },
  );
  stampContentHistorySelectionAfter(
    contentUndoStackRef.current,
    contentHistorySelectionAfterRef.current,
    contentUndoStackTopBeforeBoolean,
    {
      overviewSelectedScreenIds,
      selectedLayerIds: [acceptedWrapper.id],
      activeFileId: activeFile.id,
    },
  );
}
