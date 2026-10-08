import {
  createCanvasGestureController,
  createCanvasInteractionCore,
  type CanvasGestureAdapter,
  type CanvasInteractionAdapter,
} from "@agent-native/toolkit/canvas-interactions";

import { MIN_SLIDE_OBJECT_SIZE } from "../slide-object-interactions";
import type { SlidePointerTarget } from "../slide-pointer-target";

/** Screen px of pointer travel before a press becomes a drag. */
export const SLIDES_CANVAS_DRAG_THRESHOLD = 4;

export type SlidesCanvasHtmlMutationAdapter = CanvasInteractionAdapter<string>;
export type SlidesCanvasGestureAdapter = CanvasGestureAdapter<string>;

const slidesCanvasInteractionConfig = {
  textEditing: {
    activation: "single-click" as const,
    escapeBehavior: "select-object" as const,
  },
  drag: {
    threshold: SLIDES_CANVAS_DRAG_THRESHOLD,
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
  | "none";

/**
 * What a press on the resolved pointer target starts: text bounds edit the
 * text, every other pixel of an object moves it, selected or not.
 */
export function resolveSlidesCanvasTargetIntent(
  target: SlidePointerTarget,
): SlidesCanvasPointerIntent {
  if (target.kind === "whitespace") return "none";
  if (target.grab === "edit") return "edit-text";
  return target.grab === "move" ? "move-object-body" : "none";
}
