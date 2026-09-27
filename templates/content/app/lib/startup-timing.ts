// Stable identifiers the startup trace script reads. Renaming one silently
// breaks the page-load acceptance measurements, so change them together with
// `scripts/trace-startup.mjs`.
export const CONTENT_BODY_ELEMENT_TIMING = "content-body";
export const SIDEBAR_FILES_ROW_ELEMENT_TIMING = "sidebar-files-row";
export const CONTENT_BODY_DOM_MARK = "content-body-dom";
export const CONTENT_EDITABLE_MARK = "content-editable";

// Element Timing entries need a painted frame, which hidden tabs never produce,
// so the DOM-commit marks below are the fallback a background trace can read.
export function markStartupMilestone(name: string, documentId?: string) {
  if (typeof performance === "undefined" || !performance.mark) return;
  performance.mark(name, { detail: documentId ? { documentId } : undefined });
}
