// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  createSlidesCanvasGestureController,
  createSlidesCanvasInteractionCore,
  isWithinSlidesCanvasEdgeMoveBand,
  resolveSlidesCanvasDragTarget,
  resolveSlidesCanvasPointerIntent,
  SLIDES_CANVAS_EDGE_MOVE_BAND,
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
    expect(core.hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(
      false,
    );
    expect(core.hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(
      true,
    );
    expect(core.shouldDuplicateDrag({ altKey: true })).toBe(true);
    expect(core.shouldDuplicateDrag({ metaKey: true })).toBe(false);
    expect(SLIDES_CANVAS_EDGE_MOVE_BAND).toBe(8);
  });

  it("keeps snapping and object alignment disabled until Slides implements them", () => {
    const core = createSlidesCanvasInteractionCore();

    expect(core.capabilities.snapping).toBe(false);
    expect(core.capabilities.alignment).toBe(false);
    expect(core.capabilities.distribution).toBe(false);
    expect(core.capabilities.grouping).toBe(false);
    expect(core.capabilities.rotation).toBe(false);
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

  it("reserves only a selected object's edge band for movement", () => {
    expect(
      resolveSlidesCanvasPointerIntent({
        hasSelectedObject: true,
        targetWithinSelectedObject: true,
        targetContainsSelectedObject: false,
        pointerWithinMoveBand: true,
        targetIsEditableText: true,
      }),
    ).toBe("move-object-perimeter");
    expect(
      resolveSlidesCanvasPointerIntent({
        hasSelectedObject: true,
        targetWithinSelectedObject: true,
        targetContainsSelectedObject: false,
        pointerWithinMoveBand: false,
        targetIsEditableText: true,
      }),
    ).toBe("move-object-body");
    expect(
      resolveSlidesCanvasPointerIntent({
        hasSelectedObject: true,
        targetWithinSelectedObject: true,
        targetContainsSelectedObject: false,
        pointerWithinMoveBand: false,
        targetIsEditableText: false,
      }),
    ).toBe("move-object-body");
  });

  it("uses the object under the pointer when no prior selection exists", () => {
    const image = document.createElement("img");
    const wrapper = document.createElement("div");

    expect(resolveSlidesCanvasDragTarget(null, image)).toBe(image);
    expect(resolveSlidesCanvasDragTarget(null, wrapper)).toBe(wrapper);
  });

  it("keeps a selected parent as the drag target for nested content", () => {
    const wrapper = document.createElement("div");
    const image = document.createElement("img");
    wrapper.append(image);

    expect(resolveSlidesCanvasDragTarget(wrapper, image)).toBe(wrapper);
    expect(resolveSlidesCanvasDragTarget(image, wrapper)).toBe(image);
  });

  it("uses the same measured outside edge band for hover and pointer intent", () => {
    const rect = {
      left: 100,
      right: 300,
      top: 200,
      bottom: 260,
      width: 200,
      height: 60,
    };

    expect(isWithinSlidesCanvasEdgeMoveBand(rect, 96, 230)).toBe(true);
    expect(
      resolveSlidesCanvasPointerIntent({
        hasSelectedObject: true,
        targetWithinSelectedObject: false,
        targetContainsSelectedObject: true,
        pointerWithinMoveBand: true,
        targetIsEditableText: false,
      }),
    ).toBe("move-object-perimeter");
  });

  it("does not steal an outside edge-band press from a nearby object", () => {
    expect(
      resolveSlidesCanvasPointerIntent({
        hasSelectedObject: true,
        targetWithinSelectedObject: false,
        targetContainsSelectedObject: false,
        pointerWithinMoveBand: true,
        targetIsEditableText: true,
      }),
    ).toBe("edit-text");
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
    // Releasing at the already-previewed pointer does not run a second
    // preview, so DOM-backed adapters cannot flash or mutate twice on drop.
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
    controller.pointerMove({ x: 3, y: 0, altKey: true });
    expect(controller.cancel()).toMatchObject({ cancelled: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
