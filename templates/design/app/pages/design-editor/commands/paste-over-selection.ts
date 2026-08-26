import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  extractLayerPosition,
  insertClonedHtmlLayers,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
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

/** Paste-over must use authored CSS left/top, not the selection bounding box.
 * boundingRect is iframe/canvas space; writing it as left/top parks the copy
 * off the visible screen while Layers still shows the node. */
export function resolvePasteOverPositions(
  entries: CanvasLayerClipboardEntry[],
  selectedElement: ElementInfo | null,
): Array<{ x: number; y: number }> | null {
  const selectedLeft = parseFloat(selectedElement?.computedStyles?.left ?? "");
  const selectedTop = parseFloat(selectedElement?.computedStyles?.top ?? "");
  if (Number.isFinite(selectedLeft) && Number.isFinite(selectedTop)) {
    return entries.map((_, index) => ({
      x: selectedLeft + (index + 1) * 16,
      y: selectedTop + (index + 1) * 16,
    }));
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
  const positions = resolvePasteOverPositions(entries, selectedElement);
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
