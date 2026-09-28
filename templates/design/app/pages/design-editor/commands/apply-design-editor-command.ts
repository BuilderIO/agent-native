import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { InspectorTab } from "@/components/design/EditPanel";
import {
  getScreenPreviewViewport,
  resolveFrameGeometrySync,
} from "@/components/design/multi-screen/frame-geometry";
import type { ElementInfo } from "@/components/design/types";
import type { DesignEditorCommand } from "@/hooks/use-navigation-state";
import {
  getCreatedScreenNavigationPlan,
  type CreatedScreenNavigationPlan,
} from "@/pages/design-editor/created-screen-navigation";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  clampZoom,
  shouldDeferOverviewZoomCommand,
} from "@/pages/design-editor/overview-camera";
import {
  DEFAULT_INTERACT_DEVICE_PRESET,
  resolveInteractDeviceForScreen,
} from "@/pages/design-editor/responsive-interact";
import { findDesignFileByScreenTarget } from "@/pages/design-editor/screen-command-utils";
import {
  getDesignToolActivationState,
  isSingleScreenAnnotationTool,
  normalizeDesignLeftPanel,
  normalizeDesignTool,
} from "@/pages/design-editor/tool-state";
import type {
  DesignFile,
  DesignLeftPanel,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";
import { FOCUSED_SCREEN_ZOOM } from "@/pages/design-editor/types";

export interface ApplyDesignEditorCommandArgs {
  canEditDesign: boolean;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  files: DesignFile[];
  id: string | undefined;
  overviewScreens: OverviewScreen[];
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveInspectorTab: Dispatch<SetStateAction<InspectorTab>>;
  setActiveLeftPanel: Dispatch<SetStateAction<DesignLeftPanel | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setInteractDeviceName: Dispatch<SetStateAction<string>>;
  setInteractDeviceSize: Dispatch<
    SetStateAction<{ width: number; height: number }>
  >;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setPinMode: Dispatch<SetStateAction<boolean>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setScreenZoom: Dispatch<SetStateAction<number>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  pendingOverviewScreenSelectionRef?: RefObject<string | null>;
  setZoomForView: (
    targetView: "single" | "overview",
    update: SetStateAction<number>,
  ) => void;
  overviewDataReady?: boolean;
  viewModeRef: RefObject<"single" | "overview">;
  requestCameraFit?: (camera: CreatedScreenNavigationPlan["camera"]) => void;
}

export function runApplyDesignEditorCommand(
  {
    canEditDesign,
    canvasFrameGeometryById,
    files,
    id,
    overviewScreens,
    setActiveFileId,
    setActiveInspectorTab,
    setActiveLeftPanel,
    setActiveTool,
    setDrawMode,
    setInteractDeviceName,
    setInteractDeviceSize,
    setMode,
    setOverviewSelectedScreenIds,
    setPinMode,
    setScreenZoom,
    setSelectedElement,
    setSelectedLayerIdsState,
    setViewMode,
    setZoomForView,
    pendingOverviewScreenSelectionRef,
    overviewDataReady = true,
    viewModeRef,
    requestCameraFit,
  }: ApplyDesignEditorCommandArgs,
  command: DesignEditorCommand | Record<string, unknown>,
) {
  if (!id || command.designId !== id) return true;
  const commandRecord = command as Record<string, unknown>;
  const editorView =
    command.editorView === "overview" || command.editorView === "single"
      ? command.editorView
      : command.viewMode === "overview" || command.viewMode === "single"
        ? command.viewMode
        : undefined;
  const target =
    typeof command.fileId === "string"
      ? command.fileId
      : typeof command.screenId === "string"
        ? command.screenId
        : typeof command.filename === "string"
          ? command.filename
          : typeof command.screen === "string"
            ? command.screen
            : null;
  const selectionId =
    typeof command.selection === "string"
      ? command.selection
      : typeof commandRecord.nodeId === "string"
        ? commandRecord.nodeId
        : typeof commandRecord.layerId === "string"
          ? commandRecord.layerId
          : null;
  const targetFile = findDesignFileByScreenTarget(files, target);
  if (target && !targetFile) return false;

  const targetView = editorView ?? viewModeRef.current;

  const inspectorTab =
    command.inspectorTab === "design" ||
    command.inspectorTab === "comments" ||
    command.inspectorTab === "tweaks" ||
    command.inspectorTab === "code"
      ? command.inspectorTab
      : command.inspector === "design" ||
          command.inspector === "comments" ||
          command.inspector === "tweaks" ||
          command.inspector === "code"
        ? command.inspector
        : undefined;
  if (inspectorTab) setActiveInspectorTab(inspectorTab);
  const leftPanel =
    normalizeDesignLeftPanel(command.leftPanel) ??
    normalizeDesignLeftPanel(command.panel) ??
    normalizeDesignLeftPanel(command.inspectorTab) ??
    normalizeDesignLeftPanel(command.inspector);
  if (leftPanel) setActiveLeftPanel(leftPanel);

  const commandTool = normalizeDesignTool(command.tool);
  const effectiveCommandTool =
    editorView === "overview" &&
    commandTool &&
    isSingleScreenAnnotationTool(commandTool)
      ? "move"
      : commandTool;
  const applyCommandTool = (fallback: DesignTool) => {
    if (!canEditDesign) return;
    const nextTool = effectiveCommandTool ?? fallback;
    const activation = getDesignToolActivationState(nextTool);
    setActiveTool(nextTool);
    setMode(activation.mode);
    setDrawMode(activation.drawMode);
    setPinMode(activation.pinMode);
  };

  if (targetFile) {
    setActiveFileId(targetFile.id);
    if (targetView === "overview") {
      if (pendingOverviewScreenSelectionRef) {
        pendingOverviewScreenSelectionRef.current = targetFile.id;
      }
      setOverviewSelectedScreenIds([targetFile.id]);
    }
  }
  if (selectionId) {
    setSelectedLayerIdsState([selectionId]);
  }

  const commandZoom =
    typeof command.zoom === "number" && Number.isFinite(command.zoom)
      ? clampZoom(command.zoom)
      : null;
  if (
    shouldDeferOverviewZoomCommand({
      hasZoomCommand: commandZoom !== null,
      targetView,
      filesLoaded:
        files.length > 0 &&
        (targetView !== "overview" ||
          (overviewDataReady && overviewScreens.length > 0)),
    })
  ) {
    return false;
  }
  if (commandZoom !== null) {
    setZoomForView(targetView, commandZoom);
  }

  if (editorView === "overview") {
    viewModeRef.current = "overview";
    if (!selectionId) setSelectedElement(null);
    applyCommandTool("move");
    setViewMode("overview");
    const targetScreen = targetFile
      ? overviewScreens.find((screen) => screen.id === targetFile.id)
      : undefined;
    if (targetScreen && requestCameraFit && commandZoom === null) {
      const geometry = resolveFrameGeometrySync({
        screens: overviewScreens.map((screen) => ({
          id: screen.id,
          metadata: {
            width: screen.width ?? 1280,
            height: screen.height ?? 2560,
          },
          breakpointWidths: screen.breakpointWidths,
          layoutGroupId: screen.layoutGroupId,
        })),
        currentGeometryById: {},
        persistedGeometryById: canvasFrameGeometryById,
      }).next[targetScreen.id];
      if (
        !geometry ||
        !Number.isFinite(geometry.x) ||
        !Number.isFinite(geometry.y) ||
        !Number.isFinite(geometry.width) ||
        !Number.isFinite(geometry.height)
      ) {
        return false;
      }
      requestCameraFit(
        getCreatedScreenNavigationPlan({
          screenId: targetScreen.id,
          geometry: {
            x: geometry.x as number,
            y: geometry.y as number,
            width: geometry.width as number,
            height: geometry.height as number,
          },
        }).camera,
      );
    }
  } else if (editorView === "single") {
    viewModeRef.current = "single";
    if (!selectionId) setSelectedElement(null);
    const targetScreen = targetFile
      ? overviewScreens.find((screen) => screen.id === targetFile.id)
      : undefined;
    const targetMetadataSize = targetScreen
      ? {
          width: targetScreen.width ?? DEFAULT_INTERACT_DEVICE_PRESET.width,
          height: targetScreen.height ?? DEFAULT_INTERACT_DEVICE_PRESET.height,
        }
      : undefined;
    const targetViewport =
      targetFile && targetMetadataSize
        ? getScreenPreviewViewport(targetMetadataSize, {
            width:
              canvasFrameGeometryById[targetFile.id]?.width ??
              targetMetadataSize.width,
            height:
              canvasFrameGeometryById[targetFile.id]?.height ??
              targetMetadataSize.height,
          })
        : undefined;
    const interactDevice = resolveInteractDeviceForScreen(
      targetViewport
        ? {
            width: targetViewport.viewportWidth,
            height: targetViewport.viewportHeight,
          }
        : undefined,
    );
    setInteractDeviceName(interactDevice.name);
    setInteractDeviceSize({
      width: interactDevice.width,
      height: interactDevice.height,
    });
    setActiveTool("move");
    setDrawMode(false);
    setPinMode(false);
    const requestedMode =
      command.mode === "edit" ||
      command.mode === "annotate" ||
      command.mode === "interact"
        ? command.mode
        : "interact";
    setMode(requestedMode);
    if (commandZoom === null) {
      setScreenZoom(FOCUSED_SCREEN_ZOOM);
    }
    setViewMode("single");
  } else if (effectiveCommandTool) {
    applyCommandTool("move");
  }

  return true;
}
