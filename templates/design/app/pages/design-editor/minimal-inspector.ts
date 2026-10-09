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

export function shouldAutoOpenMobileInspector({
  minimalUi,
  isMobileViewport,
  hasSelection,
}: {
  minimalUi: boolean;
  isMobileViewport: boolean;
  hasSelection: boolean;
}): boolean {
  return minimalUi && isMobileViewport && hasSelection;
}

/**
 * Canvas width the right inspector reserves. A widget's inspector floats over
 * the canvas: reserving its width would refit the screen narrower the moment
 * something is selected.
 */
export function rightInspectorCanvasInset({
  visible,
  width,
  widgetEmbed,
  minimalUi,
}: {
  visible: boolean;
  width: number;
  widgetEmbed: boolean;
  minimalUi?: boolean;
}): number {
  return visible && !widgetEmbed && !minimalUi ? width : 0;
}

export const DOCKED_RIGHT_INSPECTOR_CLASSNAME =
  "absolute inset-y-0 right-0 z-[70] hidden h-full min-h-0 flex-col border-l border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] md:flex";

export const FLOATING_RIGHT_INSPECTOR_CLASSNAME =
  "absolute top-3 right-3 bottom-3 z-[70] hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-[var(--design-editor-panel-bg)] shadow-xl md:flex";

export function rightInspectorPanelClassName(minimalUi: boolean): string {
  return minimalUi
    ? FLOATING_RIGHT_INSPECTOR_CLASSNAME
    : DOCKED_RIGHT_INSPECTOR_CLASSNAME;
}
