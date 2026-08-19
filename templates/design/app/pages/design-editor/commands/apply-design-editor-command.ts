import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { InspectorTab } from "@/components/design/EditPanel";
import { getScreenPreviewViewport } from "@/components/design/multi-screen/frame-geometry";
import type { ElementInfo } from "@/components/design/types";
import type { DesignEditorCommand } from "@/hooks/use-navigation-state";
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
  setActiveLeftPanel: Dispatch<SetStateAction<DesignLeftPanel>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setInteractDeviceName: Dispatch<SetStateAction<string>>;
  setInteractDeviceSize: Dispatch<
    SetStateAction<{ width: number; height: number }>
  >;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setPinMode: Dispatch<SetStateAction<boolean>>;
  setScreenZoom: Dispatch<SetStateAction<number>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  setViewMode: Dispatch<SetStateAction<"single" | "overview">>;
  setZoomForView: (
    targetView: "single" | "overview",
    update: SetStateAction<number>,
  ) => void;
  viewModeRef: RefObject<"single" | "overview">;
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
    setPinMode,
    setScreenZoom,
    setSelectedElement,
    setSelectedLayerIdsState,
    setViewMode,
    setZoomForView,
    viewModeRef,
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
  // A navigate command can name a screen the agent just created that the
  // get-design query hasn't refetched yet. Treat any unresolved named target
  // as not-yet-applied (return false) so the app-state key is preserved and
  // re-applied on the next tick once the file loads — not just when there are
  // zero files. Otherwise the navigate is silently consumed and dropped.
  if (target && !targetFile) return false;

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
  }
  if (selectionId) {
    setSelectedLayerIdsState([selectionId]);
  }

  const commandZoom =
    typeof command.zoom === "number" && Number.isFinite(command.zoom)
      ? clampZoom(command.zoom)
      : null;
  const targetView = editorView ?? viewModeRef.current;
  // Zoom-compounding fix — see shouldDeferOverviewZoomCommand's doc
  // comment: converting a persisted overview zoom back to canvas units
  // needs the REAL overviewZoomScale (known only once `files` loads), so
  // defer (return "not yet applicable", same contract as the
  // `target && !targetFile` bailout above) instead of committing the
  // conversion against the transient pre-load fallback scale. The mount
  // effect retries automatically once `files` populates and this
  // callback's identity changes.
  if (
    shouldDeferOverviewZoomCommand({
      hasZoomCommand: commandZoom !== null,
      targetView,
      filesLoaded: files.length > 0,
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
    setMode("interact");
    if (commandZoom === null) {
      setScreenZoom(FOCUSED_SCREEN_ZOOM);
    }
    setViewMode("single");
  } else if (effectiveCommandTool) {
    applyCommandTool("move");
  }

  return true;
}
