/**
 * Minimal-mode inspector visibility and chrome.
 *
 * In Figma-like minimal UI the right inspector is not manually toggled: it
 * appears when there is a selection (element, layer, or screen/frame) and
 * floats over the canvas instead of docking as a full-bleed rail.
 */

export function hasMinimalInspectorSelection({
  selectedElement,
  selectedLayerIds,
  selectedScreenGeometry,
}: {
  selectedElement: unknown | null | undefined;
  selectedLayerIds: readonly unknown[];
  selectedScreenGeometry: unknown | null | undefined;
}): boolean {
  return (
    selectedElement != null ||
    selectedLayerIds.length > 0 ||
    selectedScreenGeometry != null
  );
}

/** Docked full-bleed rail (default chrome). */
export const DOCKED_RIGHT_INSPECTOR_CLASSNAME =
  "absolute inset-y-0 right-0 z-[70] hidden h-full min-h-0 flex-col border-l border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] md:flex";

/**
 * Floating card inset from the viewport edges so the canvas stays full-bleed
 * underneath (Figma minimal inspector).
 */
export const FLOATING_RIGHT_INSPECTOR_CLASSNAME =
  "absolute top-14 right-3 bottom-3 z-[70] hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-[var(--design-editor-panel-bg)] shadow-xl md:flex";

export function rightInspectorPanelClassName(minimalUi: boolean): string {
  return minimalUi
    ? FLOATING_RIGHT_INSPECTOR_CLASSNAME
    : DOCKED_RIGHT_INSPECTOR_CLASSNAME;
}
