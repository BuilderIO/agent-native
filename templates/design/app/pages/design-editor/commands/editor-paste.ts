import type { RefObject } from "react";
import { toast } from "sonner";

import { isDesignHotkeyEditableTarget } from "@/hooks/useDesignHotkeys";
import { readDesignClipboardPasteData } from "@/lib/design-clipboard";
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
  handlePasteSelection: (
    position?: { x: number; y: number },
    options?: { payloadFromPasteEvent?: boolean },
  ) => Promise<void>;
  handlePastedFiles: (files: File[]) => void | Promise<void>;
  handlePastedSvg: (source: string) => boolean;
  hasCanvasClipboard: boolean;
  importFigmaClipboardIntoDesign: (content: string) => Promise<void>;
  lastWrittenClipboardMarkerRef: RefObject<string | null>;
  lastWrittenClipboardPlainTextRef: RefObject<string | null>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface DesignClipboardRefs {
  copiedLayerEntriesRef: RefObject<DesignClipboardPayload["entries"]>;
  copiedLayerHtmlRef: RefObject<string | null>;
  copiedScreenEntriesRef: RefObject<DesignClipboardPayload["screens"]>;
  lastWrittenClipboardMarkerRef: RefObject<string | null>;
  lastWrittenClipboardPlainTextRef: RefObject<string | null>;
  pasteCascadeRef: RefObject<number>;
}

/** Makes a clipboard payload the editor's copy; returns whether it holds anything. */
export function adoptDesignClipboardPayloadIntoRefs(
  refs: DesignClipboardRefs,
  payload: DesignClipboardPayload,
  markerText: string,
  plainText?: string,
): boolean {
  refs.copiedLayerEntriesRef.current = payload.entries;
  refs.copiedLayerHtmlRef.current = markerText;
  refs.copiedScreenEntriesRef.current = payload.screens ?? [];
  refs.lastWrittenClipboardMarkerRef.current = markerText;
  if (plainText !== undefined) {
    refs.lastWrittenClipboardPlainTextRef.current = plainText;
  }
  refs.pasteCascadeRef.current = 0;
  return payload.entries.length > 0 || (payload.screens?.length ?? 0) > 0;
}

type DesignPasteDataArgs = Pick<
  EditorPasteArgs,
  | "adoptDesignClipboardPayload"
  | "canEditDesign"
  | "handlePasteSelection"
  | "lastWrittenClipboardMarkerRef"
  | "t"
>;

function pasteDesignClipboardData(
  args: DesignPasteDataArgs,
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
): boolean {
  if (!args.canEditDesign) return false;
  const read = readDesignClipboardPasteData(clipboardData);
  if (read.status === "absent") return false;
  if (read.status === "untrusted") {
    toast.error(args.t("designEditor.toasts.pasteClipboardUntrusted"), {
      duration: 4000,
    });
    return true;
  }
  const { payload, markerText, plainText } = read.value;
  if (markerText !== args.lastWrittenClipboardMarkerRef.current) {
    args.adoptDesignClipboardPayload(payload, markerText, plainText);
  }
  void args.handlePasteSelection(undefined, { payloadFromPasteEvent: true });
  return true;
}

/**
 * A paste made while a screen or board iframe has focus fires inside that
 * iframe, and the bridge relays its HTML and text here. Returns whether it
 * was a Design copy (pasted, or refused with a toast).
 */
export function runCanvasClipboardRelayPaste(
  args: DesignPasteDataArgs,
  relayed: { html?: string; text?: string },
): boolean {
  return pasteDesignClipboardData(args, {
    getData: (type: string) =>
      type === "text/html"
        ? (relayed.html ?? "")
        : type === "text/plain"
          ? (relayed.text ?? "")
          : "",
  });
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
  const clipboardPlainText = event.clipboardData?.getData("text/plain") ?? "";
  const matchesInMemoryClipboard =
    lastWrittenClipboardPlainTextRef.current !== null &&
    clipboardPlainText === lastWrittenClipboardPlainTextRef.current;
  if (
    pasteDesignClipboardData(
      {
        adoptDesignClipboardPayload,
        canEditDesign,
        handlePasteSelection,
        lastWrittenClipboardMarkerRef,
        t,
      },
      event.clipboardData,
    )
  ) {
    event.preventDefault();
    return;
  }
  const svgHtml = event.clipboardData?.getData("text/html") ?? "";
  const svgText = event.clipboardData?.getData("text/plain") ?? "";
  const svgSource = /<svg\b/i.test(svgHtml)
    ? svgHtml
    : /<svg\b/i.test(svgText)
      ? svgText
      : "";
  let rejectedSvgMarkup = false;
  if (svgSource && canEditDesign) {
    event.preventDefault();
    if (handlePastedSvg(svgSource)) return;
    rejectedSvgMarkup = true;
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
  if (svgMarkup && canEditDesign && typeof File !== "undefined") {
    event.preventDefault();
    void handlePastedFiles([
      new File([svgMarkup], "pasted.svg", { type: "image/svg+xml" }),
    ]);
    return;
  }
  if (rejectedSvgMarkup) {
    toast.error(t("common.genericError"));
    return;
  }
  if (canEditDesign && hasCanvasClipboard && matchesInMemoryClipboard) {
    event.preventDefault();
    void handlePasteSelection(undefined, { payloadFromPasteEvent: true });
    return;
  }
  if (isAttemptedFigmaPaste(event.clipboardData)) {
    toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
      description: t("designEditor.import.figmaPasteUnreadable"),
    });
    return;
  }
  if (!canEditDesign) return;
}
