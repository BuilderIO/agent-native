// Stable identifiers the startup trace script reads. Renaming one silently
// breaks the page-load acceptance measurements, so change them together with
// `scripts/trace-startup.mjs`.
export const CONTENT_BODY_ELEMENT_TIMING = "content-body";
export const SIDEBAR_FILES_ROW_ELEMENT_TIMING = "sidebar-files-row";
export const CONTENT_BODY_DOM_MARK = "content-body-dom";
export const SIDEBAR_FILES_ROWS_DOM_MARK = "sidebar-files-rows-dom";
export const CONTENT_EDITABLE_MARK = "content-editable";
export const PAINTED_MARK_SUFFIX = ":painted";

// Layout-stability anchors. A placeholder and the element that replaces it
// carry the same name, and `trace-startup.mjs --stability` fails a load when a
// named element moves after it first appears.
export type StartupAnchor =
  | "title"
  | "body"
  | "sidebar-space"
  | "sidebar-search"
  | "sidebar-section-pinned"
  | "sidebar-section-recent"
  | "sidebar-section-files"
  | "sidebar-files-first-row";

export function startupAnchor(name: StartupAnchor) {
  return { "data-startup-anchor": name };
}

// Element Timing does not report every app-rendered element, and hidden tabs
// never paint, so each milestone is also marked at DOM commit and again after
// the next frame.
export function markStartupMilestone(name: string, documentId?: string) {
  if (typeof performance === "undefined" || !performance.mark) return;
  const detail = documentId ? { documentId } : undefined;
  performance.mark(name, { detail });
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    setTimeout(
      () => performance.mark(`${name}${PAINTED_MARK_SUFFIX}`, { detail }),
      0,
    );
  });
}
