import { buildCodeLayerProjection, applyVisualEdit } from "@shared/code-layer";
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
  portableStyleSnapshotForPasteTarget,
} from "@/pages/design-editor/clone-and-pen-edit";
import { codeLayerPatchMessage } from "@/pages/design-editor/code-layer-state";
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

function pixelLength(value: string | undefined): number | null {
  const raw = (value ?? "").trim();
  if (raw === "0") return 0;
  const match = /^(-?[\d.]+)px$/.exec(raw);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function runPasteToReplace(
  {
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
  }: PasteToReplaceArgs,
  externalLayerHtml?: string,
) {
  if (!canEditDesign || !activeFile) return;
  const entries = externalLayerHtml ? [] : getCanvasClipboardEntries();
  if (!externalLayerHtml && entries.length !== 1) return;
  const layerHtml = externalLayerHtml ?? entries[0]!.html;
  const targetSelector = selectedElement?.selector;
  const targetPosition = selectedElement?.boundingRect;
  if (!targetSelector || !targetPosition) return;
  const styleSnapshot = externalLayerHtml
    ? undefined
    : portableStyleSnapshotForPasteTarget(entries[0]!, activeFile.id);
  if (styleSnapshot === null) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }
  const baseContent = getFreshActiveContent();
  const targetStoredContent = activeFile.content ?? baseContent;
  if (isStandaloneHttpUrl(targetStoredContent)) {
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      targetStoredContent,
      [layerHtml],
      {
        positions: [
          { x: targetPosition.x, y: targetPosition.y, space: "visual" },
        ],
        styleSnapshots: [styleSnapshot],
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
  const projection = buildCodeLayerProjection(baseContent, {
    source: { kind: "design-file", fileId: activeFile.id },
  });
  const targetNode = projection.nodes.find((node) =>
    node.selectors.includes(targetSelector),
  );
  const failed = () =>
    toast.error(t("designEditor.toasts.pasteReplaceFailed"), {
      duration: 4000,
    });
  if (!targetNode) {
    failed();
    return;
  }
  const authoredLeft = pixelLength(targetNode.style.left);
  const authoredTop = pixelLength(targetNode.style.top);
  const hasAuthoredPosition = authoredLeft !== null && authoredTop !== null;
  const parentRect = selectedElement?.parentBoundingRect;
  const position = hasAuthoredPosition
    ? { x: authoredLeft, y: authoredTop }
    : {
        x: targetPosition.x - (parentRect?.x ?? 0),
        y: targetPosition.y - (parentRect?.y ?? 0),
      };
  const inserted = insertClonedHtmlLayers(baseContent, [layerHtml], {
    anchorSelectors: [targetSelector],
    placement: "after",
    positions: [
      {
        ...position,
        space: hasAuthoredPosition ? "layout" : "visual",
      },
    ],
    styleSnapshots: [styleSnapshot],
    managedStyleSnapshots: [entries[0]?.managedStyleSnapshot],
  });
  if (!inserted) {
    failed();
    return;
  }
  const insertedProjection = buildCodeLayerProjection(inserted.content, {
    source: projection.source,
  });
  const staleTarget = insertedProjection.nodes.find((node) =>
    node.selectors.includes(targetSelector),
  );
  if (!staleTarget) {
    failed();
    return;
  }
  const removal = applyVisualEdit(
    inserted.content,
    { kind: "deleteNode", target: { nodeId: staleTarget.id } },
    { source: insertedProjection.source },
  );
  if (removal.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        removal.result.message,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
    );
    return;
  }
  applyLocalContentUpdate(removal.content, { forcePreviewFullDocument: true });
  selectInsertedLayers(activeFile.id, removal.content, inserted.rootNodeIds);
}
