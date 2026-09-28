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
    grouping: true,
    rotation: true,
    marquee: true,
  },
};

export function createSlidesCanvasInteractionCore(
  adapter?: SlidesCanvasHtmlMutationAdapter,
) {
  return createCanvasInteractionCore(slidesCanvasInteractionConfig, adapter);
}

export function resolveSlidesCanvasNudge(
  input: Parameters<typeof slidesCanvasInteractionCore.nudge>[0],
) {
  if (input.altKey || input.ctrlKey || input.metaKey) return null;
  return slidesCanvasInteractionCore.nudge(input);
}

export function resolveSlidesCanvasRotation(
  input: Pick<
    KeyboardEvent,
    "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey"
  >,
): number | null {
  if (
    !input.altKey ||
    input.metaKey ||
    input.ctrlKey ||
    (input.key !== "ArrowLeft" && input.key !== "ArrowRight")
  ) {
    return null;
  }
  const amount = input.shiftKey ? 1 : 15;
  return input.key === "ArrowLeft" ? -amount : amount;
}

export function createSlidesCanvasGestureController(
  adapter: SlidesCanvasGestureAdapter,
) {
  return createCanvasGestureController({
    ...slidesCanvasInteractionConfig,
    adapter,
  });
}

export const slidesCanvasInteractionCore = createSlidesCanvasInteractionCore();

export type SlidesCanvasPointerIntent =
  | "edit-text"
  | "move-object-body"
  | "move-object-perimeter"
  | "none";

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

export function resolveSlidesCanvasPointerIntent({
  hasSelectedObject,
  targetWithinSelectedObject,
  targetContainsSelectedObject,
  pointerWithinMoveBand,
  targetIsEditableText,
  duplicateModifierActive = false,
}: {
  hasSelectedObject: boolean;
  targetWithinSelectedObject: boolean;
  targetContainsSelectedObject: boolean;
  pointerWithinMoveBand: boolean;
  targetIsEditableText: boolean;
  duplicateModifierActive?: boolean;
}): SlidesCanvasPointerIntent {
  if (
    hasSelectedObject &&
    pointerWithinMoveBand &&
    (targetWithinSelectedObject ||
      targetContainsSelectedObject ||
      !targetIsEditableText)
  ) {
    return "move-object-perimeter";
  }
  if (targetIsEditableText && !duplicateModifierActive) return "edit-text";
  if (hasSelectedObject && targetWithinSelectedObject) {
    return "move-object-body";
  }
  return "none";
}
