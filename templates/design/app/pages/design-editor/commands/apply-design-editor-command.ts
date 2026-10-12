import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getResponsiveBreakpointHeightPx } from "@shared/responsive-frame-layout";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { InspectorTab } from "@/components/design/EditPanel";
import {
  getResponsiveScreenCullGeometry,
  resolveFrameGeometrySync,
} from "@/components/design/multi-screen/frame-geometry";
import type { ElementInfo } from "@/components/design/types";
import type { DesignEditorCommand } from "@/hooks/use-navigation-state";
import {
  clearOverviewInteractTarget,
  getCreatedScreenNavigationPlan,
  type CreatedScreenNavigationPlan,
} from "@/pages/design-editor/created-screen-navigation";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  clampZoom,
  shouldDeferOverviewZoomCommand,
} from "@/pages/design-editor/overview-camera";
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
  setOverviewInteractScreenId?: Dispatch<SetStateAction<string | null>>;
  overviewInteractScreenIdRef?: RefObject<string | null>;
  setScreenZoom: Dispatch<SetStateAction<number>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  pendingOverviewScreenSelectionRef?: RefObject<string | null>;
  setExplicitOverviewScreenSelection?: (screenIds: string[]) => void;
  setZoomForView: (
    targetView: "single" | "overview",
    update: SetStateAction<number>,
  ) => void;
  overviewDataReady?: boolean;
  viewModeRef: RefObject<"single" | "overview">;
  requestCameraFit?: (
    camera: CreatedScreenNavigationPlan["camera"],
    zoomRequest?: { screenId: string; displayZoom: number },
  ) => void;
  /** False frames the named screen without selecting it. Defaults to true. */
  selectTargetScreen?: boolean;
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
    setMode,
    setOverviewSelectedScreenIds,
    setPinMode,
    setOverviewInteractScreenId,
    overviewInteractScreenIdRef,
    setSelectedElement,
    setSelectedLayerIdsState,
    setViewMode,
    setZoomForView,
    pendingOverviewScreenSelectionRef,
    setExplicitOverviewScreenSelection,
    overviewDataReady = true,
    viewModeRef,
    requestCameraFit,
    selectTargetScreen = true,
  }: ApplyDesignEditorCommandArgs,
  command: DesignEditorCommand | Record<string, unknown>,
) {
  if (!id || command.designId !== id) return true;
  const commandRecord = command as Record<string, unknown>;
  const requestedEditorView =
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

  const editorView =
    requestedEditorView === "single" || targetFile
      ? "overview"
      : requestedEditorView;

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
    if (targetView === "overview" && (selectTargetScreen || selectionId)) {
      if (pendingOverviewScreenSelectionRef) {
        pendingOverviewScreenSelectionRef.current = targetFile.id;
      }
      setOverviewSelectedScreenIds([targetFile.id]);
      setSelectedLayerIdsState([selectionId ?? targetFile.id]);
    }
  } else if (selectionId) {
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
  const targetScreen =
    targetView === "overview" && targetFile
      ? overviewScreens.find((screen) => screen.id === targetFile.id)
      : undefined;
  const shouldFitTargetScreen = Boolean(targetScreen && requestCameraFit);
  if (commandZoom !== null && !shouldFitTargetScreen) {
    setZoomForView(targetView, commandZoom);
  }

  if (editorView === "overview") {
    viewModeRef.current = "overview";
    if (!selectionId) setSelectedElement(null);
    if (setOverviewInteractScreenId && overviewInteractScreenIdRef) {
      clearOverviewInteractTarget({
        setOverviewInteractScreenId,
        overviewInteractScreenIdRef,
      });
    }
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    applyCommandTool("move");
    setViewMode("overview");
    if (targetScreen && requestCameraFit) {
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
      // The screen's breakpoint frames sit beside it; frame them together.
      const group = getResponsiveScreenCullGeometry(
        {
          id: targetScreen.id,
          metadata: {
            width: targetScreen.width ?? 1280,
            height: targetScreen.height ?? 2560,
          },
          breakpointWidths: targetScreen.breakpointWidths,
        },
        geometry,
        (widthPx) =>
          getResponsiveBreakpointHeightPx(
            { breakpointHeights: targetScreen.breakpointHeights },
            widthPx,
          ),
      );
      requestCameraFit(
        getCreatedScreenNavigationPlan({
          screenId: targetScreen.id,
          geometry: {
            x: group.x,
            y: group.y,
            width: group.width,
            height: group.height,
          },
        }).camera,
        commandZoom !== null
          ? { screenId: targetScreen.id, displayZoom: commandZoom }
          : undefined,
      );
    }
  } else if (effectiveCommandTool) {
    applyCommandTool("move");
  }

  if (targetView === "overview") {
    if (selectionId) {
      const normalizedSelectionId = selectionId.replace(/^code:/, "");
      const selectedScreen = files.find(
        (file) => file.id === normalizedSelectionId,
      );
      setExplicitOverviewScreenSelection?.(
        selectedScreen ? [selectedScreen.id] : [],
      );
    } else if (targetFile && selectTargetScreen) {
      setExplicitOverviewScreenSelection?.([targetFile.id]);
    }
  }

  return true;
}
