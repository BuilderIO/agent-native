import type { RefObject } from "react";

import { isDesignHotkeyEditableTarget } from "@/hooks/useDesignHotkeys";
import { readDesignClipboardPayloadFromDataTransfer } from "@/lib/design-clipboard";
import type { DesignClipboardPayload } from "@/lib/design-import";
import { getFigmaClipboardContent } from "@/lib/design-import";

export interface EditorPasteArgs {
  adoptDesignClipboardPayload: (
    payload: DesignClipboardPayload,
    markerText: string,
    plainText?: string,
  ) => void;
  canEditDesign: boolean;
  handlePasteSelection: (position?: { x: number; y: number }) => Promise<void>;
  handlePastedImageFiles: (files: File[]) => boolean;
  hasCanvasClipboard: boolean;
  importFigmaClipboardIntoDesign: (content: string) => Promise<void>;
  lastWrittenClipboardMarkerRef: RefObject<string | null>;
  lastWrittenClipboardPlainTextRef: RefObject<string | null>;
}

export function runEditorPaste(
  {
    adoptDesignClipboardPayload,
    canEditDesign,
    handlePasteSelection,
    handlePastedImageFiles,
    hasCanvasClipboard,
    importFigmaClipboardIntoDesign,
    lastWrittenClipboardMarkerRef,
    lastWrittenClipboardPlainTextRef,
  }: EditorPasteArgs,
  event: ClipboardEvent,
) {
  if (event.defaultPrevented) return;
  if (isDesignHotkeyEditableTarget(event.target)) return;
  // U8/paste-multi: collect every pasted image file, not just the first —
  // see handlePastedImageFiles' doc comment for the full rationale.
  const imageFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (imageFiles.length > 0 && canEditDesign) {
    if (handlePastedImageFiles(imageFiles)) {
      event.preventDefault();
      return;
    }
  }
  const figmaContent = getFigmaClipboardContent(event.clipboardData);
  if (figmaContent) {
    event.preventDefault();
    void importFigmaClipboardIntoDesign(figmaContent);
    return;
  }
  if (!canEditDesign) return;
  // The native paste event reflects the current clipboard synchronously.
  // New copies carry their lossless marker in text/html; text/plain remains
  // readable. The helper also accepts legacy markers from text/plain.
  const clipboardResult = readDesignClipboardPayloadFromDataTransfer(
    event.clipboardData,
  );
  if (
    clipboardResult &&
    clipboardResult.markerText !== lastWrittenClipboardMarkerRef.current
  ) {
    adoptDesignClipboardPayload(
      clipboardResult.payload,
      clipboardResult.markerText,
      clipboardResult.plainText,
    );
  }
  const clipboardPlainText = event.clipboardData?.getData("text/plain") ?? "";
  const matchesInMemoryClipboard =
    lastWrittenClipboardPlainTextRef.current !== null &&
    clipboardPlainText === lastWrittenClipboardPlainTextRef.current;
  if (clipboardResult || (hasCanvasClipboard && matchesInMemoryClipboard)) {
    event.preventDefault();
    void handlePasteSelection();
  }
}
