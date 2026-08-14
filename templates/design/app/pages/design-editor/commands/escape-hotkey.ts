import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import {
  collectCodeLayerAncestors,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import {
  hasSelectableCodeLayerParent,
  resolveEscapePopSelectionAction,
  shouldEscapeToOverview,
} from "@/pages/design-editor/selection-state";
import type { DesignTool, EditorMode } from "@/pages/design-editor/types";

export interface EscapeHotkeyArgs {
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeTool: DesignTool;
  cancelActiveEditorDrag: () => boolean;
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
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
  selectedLayerIdsState: string[];
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setExpandedLayerIds: Dispatch<SetStateAction<string[]>>;
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
  codeLayerOwnerByNodeIdRef,
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
  selectedLayerIdsState,
  setActiveFileId,
  setActiveTool,
  setDrawMode,
  setExpandedLayerIds,
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
  // Figma parity — pop the plain-canvas selection one level at a time
  // (child layer -> parent layer -> containing screen/frame -> fully
  // deselected) instead of deselecting everything on the first Escape.
  // The decision itself is a pure, unit-tested function
  // (resolveEscapePopSelectionAction in design-editor/selection-state.ts);
  // this reuses the same codeLayerOwnerByNodeIdRef/parentId ancestor walk
  // handleSelectParentLayer (Shift+Enter / "\\") already uses, inlined
  // here (rather than calling selectCodeLayerNodesForHotkey directly)
  // since that helper is declared later in this component and referencing
  // it from this callback's deps would hit its temporal-dead-zone before
  // this render's declarations run.
  const escapeSelectedLayerId =
    selectedLayerIdsState[selectedLayerIdsState.length - 1];
  const escapeOwner = escapeSelectedLayerId
    ? codeLayerOwnerByNodeIdRef.current.get(escapeSelectedLayerId)
    : undefined;
  // BUG-ESCAPE-SHELL: the flat codeLayerOwnerByNodeIdRef map (built from
  // projection.nodes) still contains <html>/<body> entries with real
  // parentId links even though the VISUAL layers tree collapses them away
  // (shared/code-layer.ts's isCollapsibleDocumentShellNode). A bare
  // Boolean(escapeOwner?.node.parentId) check treats a top-level layer's
  // collapsed <body> ancestor as a selectable parent, so popping from the
  // screen root would select <body> then <html> instead of stopping at the
  // screen/frame level. hasSelectableCodeLayerParent excludes those shell
  // nodes so the pop walk matches what the layers panel shows.
  const escapeParentOwner = escapeOwner?.node.parentId
    ? codeLayerOwnerByNodeIdRef.current.get(escapeOwner.node.parentId)
    : undefined;
  const popAction = resolveEscapePopSelectionAction({
    hasSelectedLayer: Boolean(escapeOwner),
    hasLayerParent: hasSelectableCodeLayerParent({
      parentNode: escapeParentOwner?.node,
    }),
    viewMode,
  });
  if (popAction.kind === "pop-to-parent-layer" && escapeOwner) {
    const parentOwner = escapeParentOwner;
    if (parentOwner && parentOwner.fileId === escapeOwner.fileId) {
      setActiveFileId(parentOwner.fileId);
      setOverviewSelectedScreenIds([]);
      setSelectedLayerIdsState([parentOwner.node.id]);
      setSelectedElement(elementInfoFromCodeLayerNode(parentOwner.node));
      setExpandedLayerIds((current) => {
        const next = new Set(current);
        next.add(parentOwner.fileId);
        collectCodeLayerAncestors(
          parentOwner.tree,
          parentOwner.node.id,
        ).forEach((ancestorId) => next.add(ancestorId));
        return next.size === current.length ? current : Array.from(next);
      });
      return;
    }
    // Parent couldn't be resolved (e.g. cross-file) — fall through to a
    // full deselect below rather than silently doing nothing.
  } else if (popAction.kind === "pop-to-screen-frame" && escapeOwner) {
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    setOverviewSelectedScreenIds([escapeOwner.fileId]);
    setOverviewClearSelectionRequest((request) => request + 1);
    return;
  }
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
