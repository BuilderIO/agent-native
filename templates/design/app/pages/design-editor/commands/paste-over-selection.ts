import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  extractLayerPosition,
  insertClonedHtmlLayers,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import {
  authoredContainingBlockPositionForNode,
  authoredDocumentPositionForNode,
} from "@/pages/design-editor/html-layer-positioning";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PasteOverSelectionArgs {
  activeFile: DesignFile | undefined;
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
  getCanvasClipboardEntries: () => CanvasLayerClipboardEntry[];
  getFreshActiveContent: () => string;
  handlePasteSelection: () => Promise<void>;
  selectedElement: ElementInfo | null;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function offsetPasteOverPositions(
  origin: { x: number; y: number },
  count: number,
): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, index) => ({
    x: origin.x + (index + 1) * 16,
    y: origin.y + (index + 1) * 16,
  }));
}

/** Paste-over must use document-root CSS. Clones insert at the document
 * root, so containing-block computed left/top is composed with the nearest
 * inline-positioned ancestor unless the selection is `position:fixed`
 * (viewport/root-relative). Never write iframe boundingRect as CSS. */
export function resolvePasteOverPositions(
  entries: CanvasLayerClipboardEntry[],
  selectedElement: ElementInfo | null,
  documentHtml?: string,
): Array<{ x: number; y: number }> | null {
  const nodeId = selectedElement?.sourceId?.trim();
  if (nodeId && documentHtml) {
    const documentPosition = authoredDocumentPositionForNode(
      documentHtml,
      nodeId,
    );
    if (documentPosition) {
      return offsetPasteOverPositions(documentPosition, entries.length);
    }
  }
  const selectedLeft = parseFloat(selectedElement?.computedStyles?.left ?? "");
  const selectedTop = parseFloat(selectedElement?.computedStyles?.top ?? "");
  const hasComputed =
    Number.isFinite(selectedLeft) && Number.isFinite(selectedTop);
  const isFixedSelection =
    String(selectedElement?.computedStyles?.position ?? "").toLowerCase() ===
    "fixed";
  if (nodeId && documentHtml && hasComputed && !isFixedSelection) {
    const containingBlock = authoredContainingBlockPositionForNode(
      documentHtml,
      nodeId,
    );
    if (containingBlock) {
      return offsetPasteOverPositions(
        {
          x: containingBlock.x + selectedLeft,
          y: containingBlock.y + selectedTop,
        },
        entries.length,
      );
    }
  }
  if (hasComputed) {
    return offsetPasteOverPositions(
      { x: selectedLeft, y: selectedTop },
      entries.length,
    );
  }
  const sourcePositions = entries.map((entry) =>
    extractLayerPosition(entry.html),
  );
  if (sourcePositions.some((position) => !position)) return null;
  return sourcePositions.map((position, index) => ({
    x: position!.x + 16,
    y: position!.y + 16,
  }));
}

export function runPasteOverSelection({
  activeFile,
  applyLocalContentUpdate,
  getCanvasClipboardEntries,
  getFreshActiveContent,
  handlePasteSelection,
  selectedElement,
  selectInsertedLayers,
  t,
}: PasteOverSelectionArgs) {
  const entries = getCanvasClipboardEntries();
  if (!activeFile || entries.length === 0) return;
  const positions = resolvePasteOverPositions(
    entries,
    selectedElement,
    getFreshActiveContent(),
  );
  if (!positions) {
    void handlePasteSelection();
    return;
  }
  const result = insertClonedHtmlLayers(
    getFreshActiveContent(),
    entries.map((entry) => entry.html),
    {
      positions,
      styleSnapshots: entries.map((entry) => entry.portableStyleSnapshot),
      managedStyleSnapshots: entries.map((entry) => entry.managedStyleSnapshot),
    },
  );
  if (!result) {
    toast.error(t("designEditor.toasts.primitiveInsertFailed"), {
      duration: 4000,
    });
    return;
  }
  applyLocalContentUpdate(result.content, {
    forcePreviewFullDocument: true,
  });
  selectInsertedLayers(activeFile.id, result.content, result.rootNodeIds);
}
