import type { RefObject } from "react";
import { toast } from "sonner";

import { isDesignHotkeyEditableTarget } from "@/hooks/useDesignHotkeys";
import { readDesignClipboardPayloadFromDataTransfer } from "@/lib/design-clipboard";
import type { DesignClipboardPayload } from "@/lib/design-import";
import {
  getFigmaClipboardContent,
  isAttemptedFigmaPaste,
} from "@/lib/design-import";
import { extractSvgMarkup } from "@/lib/svg-paste";

export interface EditorPasteArgs {
  adoptDesignClipboardPayload: (
    payload: DesignClipboardPayload,
    markerText: string,
    plainText?: string,
  ) => void;
  canEditDesign: boolean;
  handlePasteSelection: (position?: { x: number; y: number }) => Promise<void>;
  handlePastedFiles: (files: File[]) => void | Promise<void>;
  handlePastedSvg: (source: string) => boolean;
  hasCanvasClipboard: boolean;
  importFigmaClipboardIntoDesign: (content: string) => Promise<void>;
  lastWrittenClipboardMarkerRef: RefObject<string | null>;
  lastWrittenClipboardPlainTextRef: RefObject<string | null>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runEditorPaste(
  {
    adoptDesignClipboardPayload,
    canEditDesign,
    handlePasteSelection,
    handlePastedFiles,
    handlePastedSvg,
    hasCanvasClipboard,
    importFigmaClipboardIntoDesign,
    lastWrittenClipboardMarkerRef,
    lastWrittenClipboardPlainTextRef,
    t,
  }: EditorPasteArgs,
  event: ClipboardEvent,
) {
  if (event.defaultPrevented) return;
  const figmaContent = getFigmaClipboardContent(event.clipboardData);
  if (figmaContent) {
    event.preventDefault();
    void importFigmaClipboardIntoDesign(figmaContent);
    return;
  }
  if (isDesignHotkeyEditableTarget(event.target)) return;
  const svgHtml = event.clipboardData?.getData("text/html") ?? "";
  const svgText = event.clipboardData?.getData("text/plain") ?? "";
  const svgSource = /<svg\b/i.test(svgHtml)
    ? svgHtml
    : /<svg\b/i.test(svgText)
      ? svgText
      : "";
  if (svgSource && canEditDesign && handlePastedSvg(svgSource)) {
    event.preventDefault();
    return;
  }
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const svgFiles = files.filter(
    (file) =>
      file.type.toLowerCase() === "image/svg+xml" ||
      file.name.toLowerCase().endsWith(".svg"),
  );
  const mediaFiles = files.filter(
    (file) =>
      !svgFiles.includes(file) &&
      (file.type.startsWith("image/") || file.type.startsWith("video/")),
  );
  if (canEditDesign && (svgFiles.length > 0 || mediaFiles.length > 0)) {
    event.preventDefault();
    void handlePastedFiles([...svgFiles, ...mediaFiles]);
    return;
  }
  const svgMarkup = extractSvgMarkup(
    event.clipboardData?.getData("text/plain") ?? "",
  );
  if (
    svgMarkup &&
    canEditDesign &&
    !readDesignClipboardPayloadFromDataTransfer(event.clipboardData) &&
    typeof File !== "undefined"
  ) {
    event.preventDefault();
    void handlePastedFiles([
      new File([svgMarkup], "pasted.svg", { type: "image/svg+xml" }),
    ]);
    return;
  }
  if (isAttemptedFigmaPaste(event.clipboardData)) {
    toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
      description: t("designEditor.import.figmaPasteUnreadable"),
    });
    return;
  }
  if (!canEditDesign) return;
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
