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
  // A delivery-confirmation wait freezes the complete annotation batch.
  // Escape must not clear it while the submitted snapshot is in flight.
  if (overviewAnnotationSending || focusedAnnotationSending) return;
  // Escape is a deliberate annotate-mode exit, same as the overlay's X.
  // Route it through the same per-surface clear semantics instead of merely
  // hiding the overlay and leaving a stale batch to reappear later.
  if (drawMode && mode === "annotate") {
    if (viewMode === "overview") handleExitOverviewDrawMode();
    else handleExitFocusedDrawMode();
    return;
  }
  // ReviewCanvasPins owns Escape while comment mode is active so it can
  // dismiss in context: first an open draft/thread, then pin mode itself.
  // Letting this global handler continue would exit the tool on the same
  // keypress that only meant to close the composer.
  if (pinMode) return;
  // BP-DEEP item 5 — Framer-style click-to-target: Escape's first job when
  // a breakpoint is the active edit target is to return to Base, matching
  // "click the base frame / empty canvas" — mirrors the other early-return
  // priority checks above/below (cancelActiveEditorDrag,
  // shouldEscapeToOverview) that let one Escape press consume the single
  // most contextually-relevant action instead of stacking every effect.
  // Gated on the ref (not the state) so this callback doesn't need
  // activeBreakpointWidthState as a dep and doesn't get recreated (and
  // re-registered with useDesignHotkeys) on every breakpoint switch.
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
  // Figma's Esc is "select none". Walking up one ancestor per press belongs to
  // Shift+Enter / "\\" (handleSelectParentLayer) — Escape must never leave
  // something selected, or there is no keystroke that reaches an empty canvas.
  setSelectedElement(null);
  setHoveredElement(null);
  setOverviewSelectedScreenIds([]);
  // Item 10 — Escape must also clear a multi-layer selection
  // (selectedLayerIdsState), not just the single selectedElement /
  // overviewSelectedScreenIds above. Without this, pressing Escape after a
  // multi-layer marquee/shift-click selection left the layers panel
  // showing stale selected rows even though the canvas selection was gone.
  setSelectedLayerIdsState([]);
  setOverviewClearSelectionRequest((request) => request + 1);
  setDrawMode(false);
  setPinMode(false);
  setActiveTool("move");
  setMode("edit");
}
