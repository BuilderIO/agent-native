const FRAME_SELECTOR = "[data-dispatch-workspace-app-frame]";
const HIDEABLE_WRAPPERS = [
  "[data-dispatch-workspace-app-cache-entry]",
  "[data-chat-first-surface-content]",
];

/**
 * The workspace-app iframe the user can currently see. Kept-alive apps stay
 * mounted under `aria-hidden` cache entries, and ChatFirst panes can hide their
 * surface wrapper, so a frame counts only when neither wrapper is hidden.
 */
export function activeWorkspaceAppFrame(
  root: ParentNode = document,
): HTMLIFrameElement | null {
  for (const candidate of root.querySelectorAll(FRAME_SELECTOR)) {
    if (!(candidate instanceof HTMLIFrameElement)) continue;
    const hidden = HIDEABLE_WRAPPERS.some(
      (wrapper) =>
        candidate.closest(wrapper)?.getAttribute("aria-hidden") === "true",
    );
    if (!hidden) return candidate;
  }
  return null;
}
