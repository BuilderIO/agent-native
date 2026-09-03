import type { FrameBounds } from "@shared/canvas-math";

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

/**
 * A newly-created screen always becomes the one obvious target: active in the
 * layers panel, selected on the all-screens canvas, and revealed by a bounded
 * fit-camera move. The editor applies this plan in the same React commit as
 * its optimistic file insertion so there is no transient "nothing happened"
 * state or camera flash.
 */
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
