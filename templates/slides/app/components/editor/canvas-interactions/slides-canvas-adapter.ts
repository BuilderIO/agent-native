import {
  createCanvasGestureController,
  createCanvasInteractionCore,
  type CanvasGestureAdapter,
  type CanvasInteractionAdapter,
} from "@agent-native/toolkit/canvas-interactions";

import { MIN_SLIDE_OBJECT_SIZE } from "../slide-object-interactions";

export const SLIDES_CANVAS_EDGE_MOVE_BAND = 8;

export function isWithinSlidesCanvasEdgeMoveBand(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">,
  clientX: number,
  clientY: number,
): boolean {
  // Tiny labels still need a usable center click target. Cap the move band at
  // one quarter of either dimension so its opposite edges never consume it.
  const edgeBand = Math.min(
    SLIDES_CANVAS_EDGE_MOVE_BAND,
    rect.width / 4,
    rect.height / 4,
  );
  const outerBand = edgeBand / 2;
  const withinExpandedBounds =
    clientX >= rect.left - outerBand &&
    clientX <= rect.right + outerBand &&
    clientY >= rect.top - outerBand &&
    clientY <= rect.bottom + outerBand;
  if (!withinExpandedBounds) return false;

  return (
    Math.abs(clientX - rect.left) <= edgeBand ||
    Math.abs(clientX - rect.right) <= edgeBand ||
    Math.abs(clientY - rect.top) <= edgeBand ||
    Math.abs(clientY - rect.bottom) <= edgeBand
  );
}

/**
 * Slides owns its persistence adapter: it translates shared semantic commands
 * into mutations of the selected slide's HTML. Toolkit remains unaware of the
 * DOM, coordinate containers, and the one-write-per-gesture boundary.
 */
export type SlidesCanvasHtmlMutationAdapter = CanvasInteractionAdapter<string>;
export type SlidesCanvasGestureAdapter = CanvasGestureAdapter<string>;

const slidesCanvasInteractionConfig = {
  textEditing: {
    activation: "single-click" as const,
    escapeBehavior: "select-object" as const,
  },
  drag: {
    threshold: 2,
    duplicateModifier: "alt" as const,
  },
  nudge: {
    amount: 1,
    acceleratedAmount: 10,
  },
  minSize: MIN_SLIDE_OBJECT_SIZE,
  capabilities: {
    multiSelection: true,
    snapping: true,
    alignment: true,
    distribution: true,
    grouping: false,
    rotation: false,
    marquee: true,
  },
};

export function createSlidesCanvasInteractionCore(
  adapter?: SlidesCanvasHtmlMutationAdapter,
) {
  return createCanvasInteractionCore(slidesCanvasInteractionConfig, adapter);
}

/**
 * Slides only nudges selected layers for plain arrows and Shift+arrows. Other
 * modifier chords stay native so browser and editing shortcuts keep working.
 */
export function resolveSlidesCanvasNudge(
  input: Parameters<typeof slidesCanvasInteractionCore.nudge>[0],
) {
  if (input.altKey || input.ctrlKey || input.metaKey) return null;
  return slidesCanvasInteractionCore.nudge(input);
}

/** Creates one shared controller per live Slides pointer gesture. */
export function createSlidesCanvasGestureController(
  adapter: SlidesCanvasGestureAdapter,
) {
  return createCanvasGestureController({
    ...slidesCanvasInteractionConfig,
    adapter,
  });
}

/** Shared Slides policy for callers that do not need an HTML command adapter. */
export const slidesCanvasInteractionCore = createSlidesCanvasInteractionCore();

export type SlidesCanvasPointerIntent =
  | "edit-text"
  | "move-object-body"
  | "move-object-perimeter"
  | "none";

/** Prefer the current selection when the pointer is inside it; otherwise the
 * object under the pointer becomes the drag candidate, including on the first
 * press before its click has updated selection state. */
export function resolveSlidesCanvasDragTarget(
  selectedObject: HTMLElement | null,
  pointerObject: HTMLElement | null,
): HTMLElement | null {
  if (
    selectedObject &&
    pointerObject &&
    (selectedObject.contains(pointerObject) ||
      pointerObject.contains(selectedObject))
  ) {
    return selectedObject;
  }
  return pointerObject ?? selectedObject;
}

/**
 * Slides supplies hit testing and this policy decision, while the shared
 * gesture controller owns threshold, coordinate, modifier, and resize math.
 * A selected object's body begins a thresholded move candidate. An unmoved
 * press still falls through to the click handler for text editing, while a
 * real drag consumes that trailing click.
 */
export function resolveSlidesCanvasPointerIntent({
  hasSelectedObject,
  targetWithinSelectedObject,
  targetContainsSelectedObject,
  pointerWithinMoveBand,
  targetIsEditableText,
}: {
  hasSelectedObject: boolean;
  targetWithinSelectedObject: boolean;
  targetContainsSelectedObject: boolean;
  pointerWithinMoveBand: boolean;
  targetIsEditableText: boolean;
}): SlidesCanvasPointerIntent {
  if (
    hasSelectedObject &&
    (targetWithinSelectedObject || targetContainsSelectedObject) &&
    pointerWithinMoveBand
  ) {
    return "move-object-perimeter";
  }
  // The interior of an editable text object belongs to native text selection.
  // Only the measured outer edge is reserved for moving the selected object.
  if (targetIsEditableText) return "edit-text";
  if (hasSelectedObject && targetWithinSelectedObject) {
    return "move-object-body";
  }
  return "none";
}
