import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import { shouldEscapeToOverview } from "@/pages/design-editor/selection-state";
import type { DesignTool, EditorMode } from "@/pages/design-editor/types";

export interface EscapeHotkeyArgs {
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeTool: DesignTool;
  cancelActiveEditorDrag: () => boolean;
  drawMode: boolean;
  enterOverviewFromZoom: (nextMode?: EditorMode) => void;
  focusedAnnotationSending: boolean;
  handleBreakpointBarSelect: (widthPx: number | undefined) => void;
  handleCloseKeyboardShortcuts: () => void;
  handleExitFocusedDrawMode: () => void;
  handleExitOverviewDrawMode: () => void;
  keyboardShortcutsOpen: boolean;
  mode: EditorMode;
  overviewAnnotationSending: boolean;
  pinMode: boolean;
  selectedElement: ElementInfo | null;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setOverviewClearSelectionRequest: Dispatch<SetStateAction<number>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setPinMode: Dispatch<SetStateAction<boolean>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  viewMode: "single" | "overview";
}

export function runEscapeHotkey({
  activeBreakpointWidthStateRef,
  activeTool,
  cancelActiveEditorDrag,
  drawMode,
  enterOverviewFromZoom,
  focusedAnnotationSending,
  handleBreakpointBarSelect,
  handleCloseKeyboardShortcuts,
  handleExitFocusedDrawMode,
  handleExitOverviewDrawMode,
  keyboardShortcutsOpen,
  mode,
  overviewAnnotationSending,
  pinMode,
  selectedElement,
  setActiveTool,
  setDrawMode,
  setHoveredElement,
  setMode,
  setOverviewClearSelectionRequest,
  setOverviewSelectedScreenIds,
  setPinMode,
  setSelectedElement,
  setSelectedLayerIdsState,
  viewMode,
}: EscapeHotkeyArgs) {
  if (keyboardShortcutsOpen) {
    handleCloseKeyboardShortcuts();
    return;
  }
  if (cancelActiveEditorDrag()) return;
  if (overviewAnnotationSending || focusedAnnotationSending) return;
  if (drawMode && mode === "annotate") {
    if (viewMode === "overview") handleExitOverviewDrawMode();
    else handleExitFocusedDrawMode();
    return;
  }
  if (pinMode) return;
  if (activeBreakpointWidthStateRef.current !== undefined) {
    handleBreakpointBarSelect(undefined);
    return;
  }
  if (
    shouldEscapeToOverview({
      activeTool,
      drawMode,
      mode,
      pinMode,
      selectedElement,
      viewMode,
    })
  ) {
    enterOverviewFromZoom();
    return;
  }
  setSelectedElement(null);
  setHoveredElement(null);
  setOverviewSelectedScreenIds([]);
  setSelectedLayerIdsState([]);
  setOverviewClearSelectionRequest((request) => request + 1);
  setDrawMode(false);
  setPinMode(false);
  setActiveTool("move");
  setMode("edit");
}
