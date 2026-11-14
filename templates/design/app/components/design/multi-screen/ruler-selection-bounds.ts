import {
  getElementWorldBoundsForZoomFit,
  getFrameGroupBounds,
  type FrameBounds,
  type FrameGeometry,
} from "@shared/canvas-math";

import type { RulerSelectionBounds } from "../CanvasRulers";

export interface ScreenLayerSelectionRect {
  screenId: string;
  /** The selected layers' bounds in the screen's own CSS pixels. */
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * The canvas-space extent the rulers mark: layers selected inside a screen
 * win over the screens themselves, as they are what the inspector shows.
 */
export function rulerSelectionBounds({
  layerSelection,
  selectedElementScreenId,
  screenGeometry,
  selectedFrames,
  boardSelection,
}: {
  layerSelection: ScreenLayerSelectionRect | null;
  selectedElementScreenId: string | null;
  screenGeometry: (screenId: string) => FrameGeometry | undefined;
  selectedFrames: readonly { geometry: FrameGeometry }[];
  boardSelection: FrameBounds | null;
}): RulerSelectionBounds | null {
  if (
    layerSelection &&
    layerSelection.screenId === selectedElementScreenId &&
    layerSelection.rect.width > 0 &&
    layerSelection.rect.height > 0
  ) {
    const geometry = screenGeometry(layerSelection.screenId);
    if (geometry) {
      return edges(
        getElementWorldBoundsForZoomFit(geometry, {
          x: layerSelection.rect.left,
          y: layerSelection.rect.top,
          width: layerSelection.rect.width,
          height: layerSelection.rect.height,
        }),
      );
    }
  }
  if (boardSelection) return edges(boardSelection);
  const frames = getFrameGroupBounds(
    selectedFrames.map((frame) => frame.geometry),
  );
  return frames ? edges(frames) : null;
}

function edges(bounds: FrameBounds): RulerSelectionBounds {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}
