import type { FrameBounds } from "@shared/canvas-math";
import type { Dispatch, SetStateAction } from "react";

export function clearOverviewInteractTarget(args: {
  setOverviewInteractScreenId: Dispatch<SetStateAction<string | null>>;
  overviewInteractScreenIdRef: { current: string | null };
}): void {
  args.setOverviewInteractScreenId(null);
  args.overviewInteractScreenIdRef.current = null;
}

export interface CreatedScreenGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreatedScreenNavigationPlan {
  activeFileId: string;
  selectedLayerIds: string[];
  selectedScreenIds: string[];
  viewMode: "overview";
  camera: {
    fitBounds: FrameBounds;
    paddingScreenPx: number;
  };
}

export interface FocusedScreenNavigationPlan extends CreatedScreenNavigationPlan {
  editorMode: "edit";
  tool: "move";
  drawMode: false;
  pinMode: false;
}

export function getCreatedScreenNavigationPlan(args: {
  screenId: string;
  geometry: CreatedScreenGeometry;
  paddingScreenPx?: number;
}): CreatedScreenNavigationPlan {
  const { geometry } = args;
  const width = Math.max(1, geometry.width);
  const height = Math.max(1, geometry.height);
  return {
    activeFileId: args.screenId,
    selectedLayerIds: [args.screenId],
    selectedScreenIds: [args.screenId],
    viewMode: "overview",
    camera: {
      fitBounds: {
        left: geometry.x,
        top: geometry.y,
        right: geometry.x + width,
        bottom: geometry.y + height,
        width,
        height,
        centerX: geometry.x + width / 2,
        centerY: geometry.y + height / 2,
      },
      paddingScreenPx: args.paddingScreenPx ?? 96,
    },
  };
}

export function getFocusedScreenNavigationPlan(args: {
  screenId: string;
  geometry: CreatedScreenGeometry;
  paddingScreenPx?: number;
}): FocusedScreenNavigationPlan {
  return {
    ...getCreatedScreenNavigationPlan(args),
    editorMode: "edit",
    tool: "move",
    drawMode: false,
    pinMode: false,
  };
}
