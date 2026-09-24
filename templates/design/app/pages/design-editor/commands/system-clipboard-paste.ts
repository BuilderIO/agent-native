import { toast } from "sonner";

import type { CanvasContextMenuPoint } from "@/components/design/CanvasContextMenu";
import {
  type PastedImageFilesClientAnchor,
  pastedFileLayerHtml,
} from "@/pages/design-editor/commands/pasted-image-files";

export interface ContextMenuPasteArgs {
  canEditDesign: boolean;
  /** Images/SVG read from the OS clipboard when the menu opened. */
  clipboardFiles: File[];
  handlePasteSelection: (position?: { x: number; y: number }) => Promise<void>;
  handlePastedImageFiles: (
    files: File[],
    anchor?: PastedImageFilesClientAnchor,
  ) => boolean;
  insertDroppedImageFiles: (
    files: File[],
    targetFileId: string,
    localPoint: { x: number; y: number },
  ) => void;
}

/**
 * Paste / Paste here from the canvas menu. The OS clipboard is newer than any
 * in-memory Design copy whenever it holds an image or SVG, so that wins.
 */
export async function runContextMenuPaste(
  {
    canEditDesign,
    clipboardFiles,
    handlePasteSelection,
    handlePastedImageFiles,
    insertDroppedImageFiles,
  }: ContextMenuPasteArgs,
  point?: CanvasContextMenuPoint,
) {
  const hasPoint = point?.canvasX !== undefined && point.canvasY !== undefined;
  if (!canEditDesign || clipboardFiles.length === 0) {
    await handlePasteSelection(
      hasPoint ? { x: point!.canvasX!, y: point!.canvasY! } : undefined,
    );
    return;
  }
  if (hasPoint && point!.screenId) {
    insertDroppedImageFiles(clipboardFiles, point!.screenId, {
      x: point!.canvasX!,
      y: point!.canvasY!,
    });
    return;
  }
  handlePastedImageFiles(
    clipboardFiles,
    point ? { clientX: point.clientX, clientY: point.clientY } : undefined,
  );
}

export interface SystemPasteToReplaceArgs {
  clipboardFiles: File[] | null;
  replaceWithLayerCopy: () => void;
  replaceWithHtml: (html: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  uploadImageFileForHtml: (file: File) => Promise<string>;
}

/** Paste to replace with an OS image/SVG, else with the copied Design layer. */
export async function runSystemPasteToReplace({
  clipboardFiles,
  replaceWithLayerCopy,
  replaceWithHtml,
  t,
  uploadImageFileForHtml,
}: SystemPasteToReplaceArgs) {
  const file = clipboardFiles?.[0];
  if (!file) {
    replaceWithLayerCopy();
    return;
  }
  let loadingToastId: string | number | undefined;
  const layer = await pastedFileLayerHtml(file, uploadImageFileForHtml, () => {
    loadingToastId = toast.loading(t("designEditor.toasts.imageUploading"));
  });
  if (loadingToastId !== undefined) toast.dismiss(loadingToastId);
  if (layer.ok) {
    replaceWithHtml(layer.html);
    return;
  }
  toast.error(t("designEditor.toasts.pasteReplaceFailed"));
}
