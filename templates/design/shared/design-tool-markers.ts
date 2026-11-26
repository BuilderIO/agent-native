/**
 * Cheap, linear detection of a copy from another design app. It runs on every
 * paste, in the editor and inside the canvas iframe (the bridge inlines this
 * module), so it must stay dependency-free and must never scan quadratically:
 * a lazy `[\s\S]*?` from every opening marker is quadratic on a large page
 * that mentions a marker without ever closing it.
 */

export type DesignToolMarker = "figma" | "paper" | "wonder";

const FIGMA_OPEN = /\((?:figmeta|figma)\)/i;
const FIGMA_CLOSE = /\(\/(?:figmeta|figma)\)/gi;
const FIGMA_ATTRIBUTE = /\sdata-(?:metadata|buffer)=(["'])/gi;

export function hasFigmaClipboardMarkers(value: string): boolean {
  const open = FIGMA_OPEN.exec(value);
  if (open) {
    const close = new RegExp(FIGMA_CLOSE.source, "gi");
    close.lastIndex = open.index + open[0].length;
    if (close.test(value)) return true;
  }
  const attribute = new RegExp(FIGMA_ATTRIBUTE.source, "gi");
  for (
    let match = attribute.exec(value);
    match;
    match = attribute.exec(value)
  ) {
    const start = attribute.lastIndex;
    const end = value.indexOf(match[0].endsWith("'") ? "'" : '"', start);
    const slice = value.slice(start, end < 0 ? undefined : end);
    if (FIGMA_OPEN.test(slice)) return true;
    if (end < 0) break;
    attribute.lastIndex = end + 1;
  }
  return false;
}

export function hasPaperClipboardMarker(value: string): boolean {
  return value.includes("<paper-paste-start");
}

export function hasWonderClipboardMarker(value: string): boolean {
  return value.includes("wonder-clipboard:");
}

const WONDER_COMPLETE = /wonder-clipboard:[A-Za-z0-9+/=_-]{16,}/;

/**
 * Like `findDesignToolMarker`, for a plain-text flavor: a paste of ordinary
 * text that merely mentions a marker must not be claimed, so Paper and Wonder
 * copies need their whole envelope here.
 */
export function findCompleteDesignToolMarker(
  value: string,
): DesignToolMarker | null {
  if (
    value.includes("<paper-paste-start") &&
    value.includes("></paper-paste-start>")
  ) {
    return "paper";
  }
  if (WONDER_COMPLETE.test(value)) return "wonder";
  return hasFigmaClipboardMarkers(value) ? "figma" : null;
}

export function findDesignToolMarker(value: string): DesignToolMarker | null {
  if (hasPaperClipboardMarker(value)) return "paper";
  if (hasWonderClipboardMarker(value)) return "wonder";
  if (hasFigmaClipboardMarkers(value)) return "figma";
  return null;
}

/** The first flavor of a clipboard that carries a copy from a design app. */
export function designToolClipboardContent(
  data: { getData(type: string): string } | null | undefined,
): string {
  if (!data) return "";
  const html = data.getData("text/html") || "";
  if (html && findDesignToolMarker(html)) return html;
  const text = data.getData("text/plain") || "";
  return text && findCompleteDesignToolMarker(text) ? text : "";
}
