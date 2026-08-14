import {
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  insertClonedHtmlLayers,
  prepareClonedHtmlLayersForLiveInsert,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import { isStandaloneHttpUrl } from "@/pages/design-editor/editor-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PasteToReplaceArgs {
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
  getCanvasClipboardEntries: () => CanvasLayerClipboardEntry[];
  getFreshActiveContent: () => string;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  selectedCanvasSelector: string;
  selectedElement: ElementInfo | null;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runPasteToReplace({
  activeFile,
  applyLocalContentUpdate,
  canEditDesign,
  getCanvasClipboardEntries,
  getFreshActiveContent,
  runtimeStructureInsertRevisionRef,
  selectInsertedLayers,
  selectedCanvasSelector,
  selectedElement,
  setRuntimeStructureInsertRequest,
  t,
}: PasteToReplaceArgs) {
  if (!canEditDesign || !activeFile) return;
  const entries = getCanvasClipboardEntries();
  if (entries.length !== 1) return;
  const targetSelector = selectedElement?.selector;
  const targetPosition = selectedElement?.boundingRect;
  if (!targetSelector || !targetPosition) return;
  const baseContent = getFreshActiveContent();
  const targetStoredContent = activeFile.content ?? baseContent;
  if (isStandaloneHttpUrl(targetStoredContent)) {
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      targetStoredContent,
      [entries[0]!.html],
      {
        positions: [{ x: targetPosition.x, y: targetPosition.y }],
        styleSnapshots: [entries[0]!.portableStyleSnapshot],
      },
    );
    const html = prepared?.htmlFragments[0];
    if (!prepared || !html) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: activeFile.id,
      html,
      replaceAnchor: true,
      anchor: {
        selector:
          selectedElement.runtimeSelector ??
          selectedCanvasSelector ??
          targetSelector,
        sourceId:
          selectedElement.runtimeSourceId ??
          selectedElement.sourceId ??
          undefined,
      },
      placement: "before",
    });
    return;
  }
  const projection = buildCodeLayerProjection(baseContent);
  const targetNode = projection.nodes.find((node) =>
    node.selectors.includes(targetSelector),
  );
  if (!targetNode) return;
  const contentWithoutTarget = removeCodeLayerNodeFromHtml(
    baseContent,
    targetNode,
  );
  if (!contentWithoutTarget) return;
  const result = insertClonedHtmlLayers(
    contentWithoutTarget,
    [entries[0]!.html],
    {
      positions: [{ x: targetPosition.x, y: targetPosition.y }],
      styleSnapshots: [entries[0]!.portableStyleSnapshot],
      managedStyleSnapshots: [entries[0]!.managedStyleSnapshot],
    },
  );
  if (!result) return;
  applyLocalContentUpdate(result.content, { forcePreviewFullDocument: true });
  selectInsertedLayers(activeFile.id, result.content, result.rootNodeIds);
}
