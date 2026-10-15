// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import type { SlidePointerTarget } from "../slide-pointer-target";
import {
  createSlidesCanvasGestureController,
  createSlidesCanvasInteractionCore,
  resolveSlidesCanvasNudge,
  resolveSlidesCanvasRotation,
  resolveSlidesCanvasTargetIntent,
  SLIDES_CANVAS_DRAG_THRESHOLD,
} from "./slides-canvas-adapter";

describe("Slides canvas interaction adapter", () => {
  it("configures the shared core for Slides-specific text and drag behavior", () => {
    const core = createSlidesCanvasInteractionCore();

    expect(core.textActivation({ clickCount: 1, textEditable: true })).toBe(
      "edit",
    );
    expect(core.escape({ editingObjectId: "title" })).toMatchObject({
      action: "select-object",
      selectedObjectIds: ["title"],
    });
    expect(core.hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(
      false,
    );
    expect(core.hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(
      false,
    );
    expect(core.hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(
      true,
    );
    expect(core.shouldDuplicateDrag({ altKey: true })).toBe(true);
    expect(core.shouldDuplicateDrag({ metaKey: true })).toBe(false);
    expect(SLIDES_CANVAS_DRAG_THRESHOLD).toBe(4);
  });

  it("advertises the supported snapping and multi-object layout capabilities", () => {
    const core = createSlidesCanvasInteractionCore();

    expect(core.capabilities.snapping).toBe(true);
    expect(core.capabilities.alignment).toBe(true);
    expect(core.capabilities.distribution).toBe(true);
    expect(core.capabilities.grouping).toBe(true);
    expect(core.capabilities.rotation).toBe(true);
  });

  it("uses the shared nudge and resize geometry", () => {
    const core = createSlidesCanvasInteractionCore();

    expect(core.nudge({ key: "ArrowRight" })).toMatchObject({
      delta: { x: 1, y: 0 },
    });
    expect(core.nudge({ key: "ArrowUp", shiftKey: true })).toMatchObject({
      delta: { x: 0, y: -10 },
    });
    expect(
      core.resize(
        { x: 100, y: 50, width: 200, height: 100 },
        {
          handle: "w",
          delta: { x: 40, y: 30 },
          preserveAspectRatio: false,
        },
      ),
    ).toEqual({ x: 140, y: 50, width: 160, height: 100 });
  });

  it("supports Alt center resizing with Shift aspect locking", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const controller = createSlidesCanvasGestureController({
      preview,
      commit: vi.fn(() => ({ handled: true }) as const),
    });

    controller.pointerDown({
      kind: "resize",
      objectIds: ["title"],
      pointer: { x: 100, y: 100 },
      viewport: { left: 0, top: 0, width: 500, height: 250 },
      canvas: { width: 1000, height: 500 },
      handle: "se",
      rect: { x: 100, y: 100, width: 200, height: 100 },
    });

    expect(
      controller.pointerMove({ x: 115, y: 105, altKey: true, shiftKey: true }),
    ).toMatchObject({
      phase: "active",
      gesture: {
        rect: { x: 70, y: 85, width: 260, height: 130 },
      },
    });

    controller.pointerUp({ x: 115, y: 105, altKey: true, shiftKey: true });
    controller.pointerDown({
      kind: "resize",
      objectIds: ["title"],
      pointer: { x: 100, y: 100 },
      viewport: { left: 0, top: 0, width: 500, height: 250 },
      canvas: { width: 1000, height: 500 },
      handle: "e",
      rect: { x: 100, y: 100, width: 200, height: 100 },
    });

    expect(
      controller.pointerMove({ x: 120, y: 100, altKey: true, shiftKey: true }),
    ).toMatchObject({
      phase: "active",
      gesture: {
        rect: { x: 60, y: 80, width: 280, height: 140 },
      },
    });
  });

  it("keeps modifier-arrow chords native while nudging plain arrows", () => {
    expect(resolveSlidesCanvasNudge({ key: "ArrowRight" })).toMatchObject({
      delta: { x: 1, y: 0 },
    });
    expect(
      resolveSlidesCanvasNudge({ key: "ArrowRight", shiftKey: true }),
    ).toMatchObject({ delta: { x: 10, y: 0 } });
    expect(
      resolveSlidesCanvasNudge({ key: "ArrowRight", metaKey: true }),
    ).toBeNull();
    expect(
      resolveSlidesCanvasNudge({ key: "ArrowRight", ctrlKey: true }),
    ).toBeNull();
    expect(resolveSlidesCanvasNudge({ key: "ArrowRight", altKey: true })).toBe(
      null,
    );
  });

  it("maps Alt+Arrow to 15-degree rotation and Shift+Alt+Arrow to one degree", () => {
    expect(
      resolveSlidesCanvasRotation({
        key: "ArrowRight",
        altKey: true,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(15);
    expect(
      resolveSlidesCanvasRotation({
        key: "ArrowLeft",
        altKey: true,
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(-1);
    expect(
      resolveSlidesCanvasRotation({
        key: "ArrowRight",
        altKey: true,
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBeNull();
    expect(
      resolveSlidesCanvasRotation({
        key: "ArrowUp",
        altKey: true,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBeNull();
  });

  it("starts text editing on text bounds and a move on every other object pixel", () => {
    const object = document.createElement("div");
    const target = (
      hit: "text" | "body",
      grab: "edit" | "move" | "none",
    ): SlidePointerTarget => ({
      kind: "object",
      object,
      hit,
      textRoot: object,
      cursor: hit === "text" ? "text" : "move",
      hoverOutline: object,
      grab,
    });

    expect(resolveSlidesCanvasTargetIntent(target("text", "edit"))).toBe(
      "edit-text",
    );
    expect(resolveSlidesCanvasTargetIntent(target("body", "move"))).toBe(
      "move-object-body",
    );
    expect(resolveSlidesCanvasTargetIntent(target("text", "move"))).toBe(
      "move-object-body",
    );
    expect(resolveSlidesCanvasTargetIntent(target("text", "none"))).toBe(
      "none",
    );
    expect(
      resolveSlidesCanvasTargetIntent({
        kind: "whitespace",
        cursor: "default",
      }),
    ).toBe("none");
  });

  it("passes semantic commands through the supplied HTML persistence adapter", () => {
    const dispatch = vi.fn(() => ({ handled: true }) as const);
    const core = createSlidesCanvasInteractionCore({
      capabilities: {
        selection: true,
        multiSelection: true,
        move: true,
        resize: true,
        textEditing: true,
        nudge: true,
        duplicate: true,
        clipboard: true,
        delete: true,
        arrange: true,
        snapping: false,
        alignment: false,
        distribution: false,
        grouping: false,
        rotation: false,
        marquee: true,
      },
      dispatch,
    });

    expect(core.dispatch({ id: "nudge-right", objectIds: ["title"] })).toEqual({
      handled: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      id: "nudge-right",
      objectIds: ["title"],
    });
  });

  it("uses one controller gesture for scaled move preview and a single commit", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const controller = createSlidesCanvasGestureController({ preview, commit });

    controller.pointerDown({
      kind: "move",
      objectIds: ["title"],
      pointer: { x: 10, y: 20 },
      viewport: { left: 0, top: 0, width: 500, height: 250 },
      canvas: { width: 1000, height: 500 },
    });
    expect(controller.pointerMove({ x: 11, y: 21 }).phase).toBe("pending");
    expect(controller.pointerMove({ x: 20, y: 30 })).toMatchObject({
      phase: "active",
      gesture: { canvasDelta: { x: 20, y: 20 }, duplicate: false },
    });
    expect(controller.pointerUp({ x: 20, y: 30 })).toMatchObject({
      committed: true,
      gesture: { canvasDelta: { x: 20, y: 20 } },
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("does not persist cancelled or below-threshold gestures", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const cancel = vi.fn(() => ({ handled: true }) as const);
    const controller = createSlidesCanvasGestureController({
      preview,
      commit,
      cancel,
    });

    controller.pointerDown({
      kind: "resize",
      objectIds: ["title"],
      pointer: { x: 0, y: 0 },
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
      handle: "se",
      rect: { x: 20, y: 20, width: 100, height: 40 },
    });
    expect(controller.pointerUp({ x: 1, y: 1 })).toMatchObject({
      committed: false,
      reason: "below-threshold",
    });
    expect(commit).not.toHaveBeenCalled();

    controller.pointerDown({
      kind: "move",
      objectIds: ["title"],
      pointer: { x: 0, y: 0 },
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
    });
    controller.pointerMove({ x: 5, y: 0, altKey: true });
    expect(controller.cancel()).toMatchObject({ cancelled: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
