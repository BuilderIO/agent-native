import type { PortableStyleSnapshot } from "@/components/design/types";

export interface ImportResult {
  designId?: string;
  files?: Array<{ id: string; filename: string }>;
  warnings?: string[];
  error?: string;
}

export const VISUAL_EDIT_CONNECT_COMMAND =
  "npx @agent-native/core@latest design connect --url 'http://localhost:<port>' --root . --daemon";

export const VISUAL_EDIT_INSTALL_COMMAND =
  "npx @agent-native/core@latest skills add visual-edit";

export function hasFigmaClipboardPayload(value: string): boolean {
  return /<[^>]+\sdata-(metadata|buffer)=["'][^"']*\((figmeta|figma)\)[^"']*["']/i.test(
    value,
  );
}

export function looksLikeStandaloneHtml(value: string): boolean {
  return /<(html|body|main|section|div|article|header|footer|button|img)\b/i.test(
    value,
  );
}

export function getFigmaClipboardContent(
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
): string | null {
  if (!clipboardData) return null;
  const html = clipboardData.getData("text/html");
  if (html && hasFigmaClipboardPayload(html)) return html;
  const text = clipboardData.getData("text/plain");
  if (text && hasFigmaClipboardPayload(text)) return text;
  return null;
}

export function importResultSummary(
  result: ImportResult | undefined,
  fallback: string,
) {
  const count = result?.files?.length ?? 0;
  if (count === 0) return fallback;
  if (count === 1) return `Imported ${result!.files![0]!.filename}.`;
  return `Imported ${count} screens.`;
}

// --- Cross-tab / system-clipboard round-trip (U4/U6) ---
//
// The in-memory clipboard refs (copiedLayerEntriesRef etc.) never survive a
// tab switch, a page reload, or a copy made in another window, and pasting
// from the OS clipboard after copying elsewhere silently reuses the stale
// in-memory entries instead. To fix that, every copy embeds a serialized
// marker comment in the text actually written to navigator.clipboard, and
// paste parses that marker back out of the live clipboard content so a
// cross-tab paste (or a same-tab paste after an external copy) round-trips
// the original entries instead of just raw concatenated HTML.

export interface DesignClipboardLayerEntry {
  html: string;
  rootNodeId?: string;
  sourceFileId: string;
  portableStyleSnapshot?: PortableStyleSnapshot;
}

export interface DesignClipboardScreenEntry {
  filename: string;
  fileType?: string;
  content: string;
  canvasFrame?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface DesignClipboardPayload {
  version: 1;
  entries: DesignClipboardLayerEntry[];
  screens?: DesignClipboardScreenEntry[];
}

const CLIPBOARD_MARKER_PREFIX = "agent-native-clipboard-v1:";

function encodeClipboardMarkerData(payload: DesignClipboardPayload): string {
  // btoa is UTF-16-unsafe for non-Latin1 text; encodeURIComponent first so
  // arbitrary copied HTML (emoji, non-Latin scripts, etc.) round-trips.
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

function decodeClipboardMarkerData(
  data: string,
): DesignClipboardPayload | null {
  try {
    const json = decodeURIComponent(atob(data));
    const parsed = JSON.parse(json) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return null;
    }
    return parsed as DesignClipboardPayload;
  } catch {
    return null;
  }
}

/**
 * Appends an invisible marker comment (safe inside HTML and plain text alike)
 * encoding the full clipboard payload after the human-visible clipboard text.
 */
export function serializeDesignClipboardPayload(
  visibleText: string,
  payload: DesignClipboardPayload,
): string {
  const marker = `<!--${CLIPBOARD_MARKER_PREFIX}${encodeClipboardMarkerData(payload)}-->`;
  return `${visibleText}\n${marker}`;
}

/**
 * Extracts a previously-serialized payload from clipboard text, if present.
 * Returns null for clipboard content that was never written by this app (a
 * plain copy from elsewhere, or another app's clipboard payload).
 */
export function parseDesignClipboardMarker(
  text: string | null | undefined,
): DesignClipboardPayload | null {
  if (!text) return null;
  const markerIndex = text.lastIndexOf(`<!--${CLIPBOARD_MARKER_PREFIX}`);
  if (markerIndex === -1) return null;
  const start = markerIndex + 4 + CLIPBOARD_MARKER_PREFIX.length;
  const end = text.indexOf("-->", start);
  if (end === -1) return null;
  return decodeClipboardMarkerData(text.slice(start, end));
}
