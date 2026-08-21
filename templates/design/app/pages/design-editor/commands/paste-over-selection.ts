import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { insertClonedHtmlLayers } from "@/pages/design-editor/clone-and-pen-edit";
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
}

export function runPasteOverSelection({
  activeFile,
  applyLocalContentUpdate,
  getCanvasClipboardEntries,
  getFreshActiveContent,
  handlePasteSelection,
  selectedElement,
  selectInsertedLayers,
}: PasteOverSelectionArgs) {
  const entries = getCanvasClipboardEntries();
  if (!activeFile || entries.length === 0) return;
  const baseContent = getFreshActiveContent();
  if (selectedElement?.boundingRect) {
    const { x, y } = selectedElement.boundingRect;
    const result = insertClonedHtmlLayers(
      baseContent,
      entries.map((entry) => entry.html),
      {
        positions: entries.map((_, index) => ({
          x: x + index * 16,
          y: y + index * 16,
        })),
        styleSnapshots: entries.map((entry) => entry.portableStyleSnapshot),
        managedStyleSnapshots: entries.map(
          (entry) => entry.managedStyleSnapshot,
        ),
      },
    );
    if (!result) return;
    applyLocalContentUpdate(result.content, {
      forcePreviewFullDocument: true,
    });
    selectInsertedLayers(activeFile.id, result.content, result.rootNodeIds);
  } else {
    void handlePasteSelection();
  }
}
