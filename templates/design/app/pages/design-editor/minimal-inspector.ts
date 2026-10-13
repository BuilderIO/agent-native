import { inspectorFitsViewport } from "./editor-chrome";
import type { EditorMode } from "./types";

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

/**
 * Whether the right inspector is on screen. It is the Design panel: Interact
 * and Annotate have none, and neither does someone who cannot edit, because
 * the Code and Comments tabs that used to give them one are gone. Where the
 * top bar is absent the rail also carries the share controls, so it keeps its
 * place in every mode.
 */
export function isRightInspectorVisible({
  hostOwnsChrome,
  isMobileViewport,
  uiHidden,
  initialGenerationChromeLimited,
  responsiveInteractActive,
  minimalUi,
  minimalInspectorHasSelection,
  topBarVisible,
  mode,
  canEdit,
}: {
  hostOwnsChrome: boolean;
  /** Below md the docked panel is display:none and a sheet carries the inspector. */
  isMobileViewport: boolean;
  uiHidden: boolean;
  initialGenerationChromeLimited: boolean;
  responsiveInteractActive: boolean;
  minimalUi: boolean;
  minimalInspectorHasSelection: boolean;
  topBarVisible: boolean;
  mode: EditorMode;
  canEdit: boolean;
}): boolean {
  return (
    !hostOwnsChrome &&
    inspectorFitsViewport({ minimalUi, isMobileViewport }) &&
    !uiHidden &&
    !initialGenerationChromeLimited &&
    !responsiveInteractActive &&
    (!minimalUi || minimalInspectorHasSelection) &&
    (!topBarVisible || (mode === "edit" && canEdit))
  );
}

/**
 * Canvas width the right inspector reserves. Minimal UI floats the inspector
 * over the canvas: reserving its width would refit the screen narrower the
 * moment something is selected.
 */
export function rightInspectorCanvasInset({
  visible,
  width,
  minimalUi,
}: {
  visible: boolean;
  width: number;
  minimalUi: boolean;
}): number {
  return visible && !minimalUi ? width : 0;
}

export const DOCKED_RIGHT_INSPECTOR_CLASSNAME =
  "absolute inset-y-0 right-0 z-[70] hidden h-full min-h-0 flex-col border-l border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] md:flex";

// Stops above the bottom toolbar while the pane is too narrow to sit beside it.
export const FLOATING_RIGHT_INSPECTOR_CLASSNAME =
  "absolute top-3 right-3 bottom-[76px] z-[70] flex min-h-0 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-[var(--design-editor-panel-bg)] shadow-xl min-[1000px]:bottom-3";

export function rightInspectorPanelClassName(minimalUi: boolean): string {
  return minimalUi
    ? FLOATING_RIGHT_INSPECTOR_CLASSNAME
    : DOCKED_RIGHT_INSPECTOR_CLASSNAME;
}
