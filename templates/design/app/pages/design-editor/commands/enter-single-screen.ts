import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { PenPath } from "@shared/pen-path";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { getScreenPreviewViewport } from "@/components/design/multi-screen/frame-geometry";
import type { ElementInfo } from "@/components/design/types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { resolveScreenEntryZoom } from "@/pages/design-editor/overview-camera";
import {
  DEFAULT_INTERACT_DEVICE_PRESET,
  resolveInteractDeviceForScreen,
} from "@/pages/design-editor/responsive-interact";
import type { DesignTool, EditorMode } from "@/pages/design-editor/types";
import { FOCUSED_SCREEN_ZOOM } from "@/pages/design-editor/types";

export interface EnterSingleScreenArgs {
  activeFileId: string | null;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  clearPendingOverviewLayerSelectionTimer: () => void;
  overviewScreens: OverviewScreen[];
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  runEditorViewTransition: (update: () => void) => void;
  screenZoomByIdRef: RefObject<Map<string, number>>;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setInteractDeviceName: Dispatch<SetStateAction<string>>;
  setInteractDeviceSize: Dispatch<
    SetStateAction<{ width: number; height: number }>
  >;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setPinMode: Dispatch<SetStateAction<boolean>>;
  setScreenZoom: Dispatch<SetStateAction<number>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setVectorEditingState: Dispatch<
    SetStateAction<{ screenId: string; nodeId: string; path: PenPath } | null>
  >;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runEnterSingleScreen(
  {
    activeFileId,
    canvasFrameGeometryById,
    clearPendingOverviewLayerSelectionTimer,
    overviewScreens,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    runEditorViewTransition,
    screenZoomByIdRef,
    setActiveFileId,
    setActiveTool,
    setCreatedOverviewLayerSelection,
    setDrawMode,
    setHoveredElement,
    setInteractDeviceName,
    setInteractDeviceSize,
    setMode,
    setPinMode,
    setScreenZoom,
    setSelectedElement,
    setVectorEditingState,
    setViewMode,
    viewModeRef,
  }: EnterSingleScreenArgs,
  fileId?: string | null,
) {
  const targetFileId = fileId ?? activeFileId;
  const targetScreen = targetFileId
    ? overviewScreens.find((screen) => screen.id === targetFileId)
    : undefined;
  const targetMetadataSize = targetScreen
    ? {
        width: targetScreen.width ?? DEFAULT_INTERACT_DEVICE_PRESET.width,
        height: targetScreen.height ?? DEFAULT_INTERACT_DEVICE_PRESET.height,
      }
    : undefined;
  const targetViewport =
    targetFileId && targetMetadataSize
      ? getScreenPreviewViewport(targetMetadataSize, {
          width:
            canvasFrameGeometryById[targetFileId]?.width ??
            targetMetadataSize.width,
          height:
            canvasFrameGeometryById[targetFileId]?.height ??
            targetMetadataSize.height,
        })
      : undefined;
  const nextInteractDevice = resolveInteractDeviceForScreen(
    targetViewport
      ? {
          width: targetViewport.viewportWidth,
          height: targetViewport.viewportHeight,
        }
      : undefined,
  );
  if (
    viewModeRef.current === "single" &&
    (!fileId || fileId === activeFileId)
  ) {
    if (fileId && fileId === activeFileId) {
      // Re-focusing the screen that's already active is a deliberate
      // "reset view" affordance (e.g. re-clicking the same screen's
      // Interact button) — reset to the default zoom rather than
      // restoring the remembered one, mirroring the previous behavior.
      setScreenZoom(FOCUSED_SCREEN_ZOOM);
    }
    // The early return used to swallow a requested mode change, so
    // re-clicking a screen after closing Interact left it in whatever
    // mode it had drifted to instead of reopening the responsive view.
    setMode("interact");
    setInteractDeviceName(nextInteractDevice.name);
    setInteractDeviceSize({
      width: nextInteractDevice.width,
      height: nextInteractDevice.height,
    });
    return;
  }
  viewModeRef.current = "single";
  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = null;
  clearPendingOverviewLayerSelectionTimer();
  setCreatedOverviewLayerSelection(null);
  // P5/vector-edit: MultiScreenCanvas (the only place the vectorEdit
  // overlay renders) unmounts on leaving overview, so an active
  // vector-edit session has nothing left to render into — clear it
  // rather than leaving a stale/orphaned session in memory that would
  // resurface if the user returns to overview later.
  setVectorEditingState(null);
  // Per-screen zoom memory: restore the target screen's last-remembered
  // zoom (recorded by the screenZoomByIdRef effect above) instead of
  // always resetting to FOCUSED_SCREEN_ZOOM, so leaving and re-entering a
  // screen preserves where the user left off. Falls back to
  // FOCUSED_SCREEN_ZOOM for a screen's first visit.
  const restoredZoom = resolveScreenEntryZoom(
    targetFileId,
    screenZoomByIdRef.current,
    FOCUSED_SCREEN_ZOOM,
  );
  runEditorViewTransition(() => {
    if (fileId) setActiveFileId(fileId);
    setDrawMode(false);
    setPinMode(false);
    setMode("interact");
    setSelectedElement(null);
    setHoveredElement(null);
    setActiveTool("move");
    setScreenZoom(restoredZoom);
    setInteractDeviceName(nextInteractDevice.name);
    setInteractDeviceSize({
      width: nextInteractDevice.width,
      height: nextInteractDevice.height,
    });
    setViewMode("single");
  });
}
