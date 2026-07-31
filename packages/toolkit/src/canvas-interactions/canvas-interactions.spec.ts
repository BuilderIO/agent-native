import { describe, expect, it, vi } from "vitest";

import {
  clientDeltaToCanvasDelta,
  clientPointToCanvasPoint,
  constrainCanvasDragDelta,
  createCanvasGestureController,
  createCanvasInteractionCore,
  createCanvasShortcutRegistry,
  hasCrossedCanvasDragThreshold,
  resizeCanvasRect,
  resolveCanvasEscape,
  resolveCanvasNudge,
  resolveCanvasShortcut,
  resolveCanvasTextActivation,
  shouldDuplicateCanvasDrag,
} from "./canvas-interactions.js";

describe("canvas interaction conformance", () => {
  it("allows app-specific single or double click text activation", () => {
    expect(
      resolveCanvasTextActivation(
        { clickCount: 1, textEditable: true },
        { activation: "single-click" },
      ),
    ).toBe("edit");
    expect(
      resolveCanvasTextActivation(
        { clickCount: 1, textEditable: true },
        { activation: "double-click" },
      ),
    ).toBe("select");
    expect(
      resolveCanvasTextActivation(
        { clickCount: 2, textEditable: true },
        { activation: "double-click" },
      ),
    ).toBe("edit");
    expect(
      resolveCanvasTextActivation({ clickCount: 2, textEditable: false }),
    ).toBe("select");
  });

  it("gives Escape editing precedence and selects the edited object", () => {
    expect(
      resolveCanvasEscape(
        { editingObjectId: "title", selectedObjectIds: ["other"] },
        { escapeBehavior: "select-object" },
      ),
    ).toEqual({
      action: "select-object",
      editingObjectId: null,
      selectedObjectIds: ["title"],
    });
    expect(
      resolveCanvasEscape(
        { editingObjectId: "title", selectedObjectIds: ["title"] },
        { escapeBehavior: "cancel-edit" },
      ),
    ).toMatchObject({ action: "cancel-edit", selectedObjectIds: ["title"] });
    expect(
      resolveCanvasEscape(
        { editingObjectId: "title", selectedObjectIds: ["title"] },
        { escapeBehavior: "clear-selection" },
      ),
    ).toMatchObject({ action: "clear-selection", selectedObjectIds: [] });
    expect(resolveCanvasEscape({ editingObjectId: null })).toMatchObject({
      action: "none",
    });
  });

  it("uses client-space drag thresholds and converts client coordinates at zoom", () => {
    expect(
      hasCrossedCanvasDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 }, 3),
    ).toBe(false);
    expect(
      hasCrossedCanvasDragThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }, 3),
    ).toBe(true);

    const viewport = { left: 100, top: 200, width: 960, height: 540 };
    const canvas = { width: 1920, height: 1080 };
    expect(
      clientPointToCanvasPoint({ x: 580, y: 470 }, viewport, canvas),
    ).toEqual({
      x: 960,
      y: 540,
    });
    expect(
      clientDeltaToCanvasDelta({ x: 40, y: -20 }, viewport, canvas),
    ).toEqual({
      x: 80,
      y: -40,
    });
  });

  it("resizes all eight handles against their opposite edges", () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    const cases = {
      nw: {
        delta: { x: -10, y: -20 },
        rect: { x: 90, y: 80, width: 210, height: 120 },
      },
      n: {
        delta: { x: 0, y: -20 },
        rect: { x: 100, y: 80, width: 200, height: 120 },
      },
      ne: {
        delta: { x: 10, y: -20 },
        rect: { x: 100, y: 80, width: 210, height: 120 },
      },
      w: {
        delta: { x: -10, y: 0 },
        rect: { x: 90, y: 100, width: 210, height: 100 },
      },
      e: {
        delta: { x: 10, y: 0 },
        rect: { x: 100, y: 100, width: 210, height: 100 },
      },
      sw: {
        delta: { x: -10, y: 20 },
        rect: { x: 90, y: 100, width: 210, height: 120 },
      },
      s: {
        delta: { x: 0, y: 20 },
        rect: { x: 100, y: 100, width: 200, height: 120 },
      },
      se: {
        delta: { x: 10, y: 20 },
        rect: { x: 100, y: 100, width: 210, height: 120 },
      },
    } as const;

    for (const [handle, expected] of Object.entries(cases)) {
      expect(
        resizeCanvasRect(start, {
          handle: handle as keyof typeof cases,
          delta: expected.delta,
          minWidth: 1,
          minHeight: 1,
        }),
      ).toEqual(expected.rect);
    }
  });

  it("keeps midpoint resizing single-axis while Shift preserves corner aspect ratio", () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    expect(
      resizeCanvasRect(start, {
        handle: "se",
        delta: { x: 60, y: 10 },
        preserveAspectRatio: true,
      }),
    ).toMatchObject({ width: 260, height: 130 });
    expect(
      resizeCanvasRect(start, {
        handle: "e",
        delta: { x: 60, y: 10 },
        preserveAspectRatio: true,
      }),
    ).toMatchObject({ width: 260, height: 100 });
    expect(constrainCanvasDragDelta({ x: 8, y: 3 }, true)).toEqual({
      x: 8,
      y: 0,
    });
    expect(constrainCanvasDragDelta({ x: 3, y: 8 }, true)).toEqual({
      x: 0,
      y: 8,
    });
  });

  it("keeps aspect ratio and the opposite corner anchored at minimum size", () => {
    expect(
      resizeCanvasRect(
        { x: 100, y: 100, width: 200, height: 100 },
        {
          handle: "nw",
          delta: { x: 190, y: 90 },
          preserveAspectRatio: true,
          minWidth: 24,
          minHeight: 24,
        },
      ),
    ).toEqual({ x: 252, y: 176, width: 48, height: 24 });
  });

  it("uses Alt duplication and standard arrow plus Shift-arrow nudges", () => {
    expect(shouldDuplicateCanvasDrag({ altKey: true })).toBe(true);
    expect(shouldDuplicateCanvasDrag({ metaKey: true })).toBe(false);
    expect(shouldDuplicateCanvasDrag({ metaKey: true }, "meta")).toBe(true);
    expect(resolveCanvasNudge({ key: "ArrowRight" })).toEqual({
      command: "nudge-right",
      delta: { x: 1, y: 0 },
    });
    expect(resolveCanvasNudge({ key: "ArrowUp", shiftKey: true })).toEqual({
      command: "nudge-up",
      delta: { x: 0, y: -10 },
    });
    expect(resolveCanvasNudge({ key: "Enter" })).toBeNull();
  });

  it("resolves semantic shortcuts without caring whether primary is Cmd or Ctrl", () => {
    expect(resolveCanvasShortcut({ key: "d", metaKey: true })).toBe(
      "duplicate",
    );
    expect(resolveCanvasShortcut({ key: "d", ctrlKey: true })).toBe(
      "duplicate",
    );
    expect(resolveCanvasShortcut({ key: "d", altKey: true })).toBeNull();
    expect(resolveCanvasShortcut({ key: "Delete" })).toBe("delete");
    expect(
      resolveCanvasShortcut({
        key: "}",
        code: "BracketRight",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe("arrange-front");
    expect(
      resolveCanvasShortcut({
        key: "{",
        code: "BracketLeft",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("arrange-back");
    const registry = createCanvasShortcutRegistry([
      { command: "align-left", key: "l", modifiers: ["primary"] },
    ]);
    expect(registry.resolve({ key: "l", ctrlKey: true })).toBe("align-left");
    expect(registry.resolve({ key: "d", ctrlKey: true })).toBeNull();
  });

  it("binds policy once and dispatches semantic commands through an app adapter", () => {
    const dispatch = vi.fn();
    const core = createCanvasInteractionCore(
      {
        textEditing: {
          activation: "single-click",
          escapeBehavior: "select-object",
        },
        drag: { threshold: 5, duplicateModifier: "alt" },
      },
      {
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
          snapping: true,
          alignment: true,
          distribution: true,
          grouping: true,
          rotation: true,
          marquee: true,
        },
        dispatch: (command) => {
          dispatch(command);
          return { handled: true };
        },
      },
    );
    expect(core.textActivation({ clickCount: 1, textEditable: true })).toBe(
      "edit",
    );
    expect(core.hasCrossedDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(
      false,
    );
    expect(core.shouldDuplicateDrag({ altKey: true })).toBe(true);
    const result = core.dispatch({
      id: "align-center",
      objectIds: ["a", "b"],
    });
    expect(result).toEqual({ handled: true });
    expect(dispatch).toHaveBeenCalledWith({
      id: "align-center",
      objectIds: ["a", "b"],
    });
    expect(core.capabilities.marquee).toBe(true);
    expect(createCanvasInteractionCore().dispatch({ id: "delete" })).toEqual({
      handled: false,
      reason: "no-adapter",
    });
  });

  it("does not report a disabled command as handled when an adapter receives it", () => {
    const dispatch = vi.fn(() => ({ handled: true }) as const);
    const core = createCanvasInteractionCore(
      { capabilities: { delete: false } },
      {
        capabilities: DEFAULT_CAPABILITIES,
        dispatch,
      },
    );

    expect(core.dispatch({ id: "delete" })).toEqual({
      handled: false,
      reason: "unsupported",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not expose direct text, duplicate, or nudge affordances disabled by an app", () => {
    const core = createCanvasInteractionCore({
      capabilities: {
        textEditing: false,
        duplicate: false,
        nudge: false,
      },
      textEditing: { activation: "single-click" },
      drag: { duplicateModifier: "alt" },
    });

    expect(core.textActivation({ clickCount: 1, textEditable: true })).toBe(
      "select",
    );
    expect(core.shouldDuplicateDrag({ altKey: true })).toBe(false);
    expect(core.nudge({ key: "ArrowRight" })).toBeNull();
  });

  it("commits one zoom-correct, Shift-locked Alt move after its threshold", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      drag: { threshold: 3, duplicateModifier: "alt" },
      adapter: { preview, commit },
    });
    const viewport = { left: 10, top: 20, width: 500, height: 250 };
    const canvas = { width: 1000, height: 500 };

    expect(
      controller.pointerDown({
        kind: "move",
        objectIds: ["title"],
        pointer: { x: 100, y: 100, altKey: true },
        viewport,
        canvas,
      }),
    ).toMatchObject({ accepted: true, state: { phase: "pending" } });
    expect(controller.pointerMove({ x: 102, y: 101 })).toMatchObject({
      phase: "pending",
    });
    expect(preview).not.toHaveBeenCalled();

    expect(
      controller.pointerMove({ x: 120, y: 106, altKey: true, shiftKey: true }),
    ).toMatchObject({
      phase: "active",
      gesture: {
        kind: "move",
        canvasDelta: { x: 40, y: 0 },
        duplicate: true,
      },
    });
    const end = controller.pointerUp({
      x: 140,
      y: 112,
      altKey: true,
      shiftKey: true,
    });
    expect(end).toMatchObject({
      committed: true,
      gesture: {
        kind: "move",
        canvasDelta: { x: 80, y: 0 },
        duplicate: true,
      },
      state: { phase: "idle" },
    });
    expect(preview).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "move",
        canvasDelta: { x: 80, y: 0 },
      }),
    );
  });

  it("resizes all geometry through the controller and cancels without committing", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const cancel = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      minSize: 24,
      adapter: { preview, commit, cancel },
    });
    const start = {
      kind: "resize" as const,
      objectIds: ["title"],
      pointer: { x: 100, y: 100 },
      viewport: { left: 0, top: 0, width: 500, height: 250 },
      canvas: { width: 1000, height: 500 },
      handle: "nw" as const,
      rect: { x: 100, y: 100, width: 200, height: 100 },
    };
    expect(controller.pointerDown(start)).toMatchObject({ accepted: true });
    expect(
      controller.pointerMove({ x: 190, y: 190, shiftKey: true }),
    ).toMatchObject({
      phase: "active",
      gesture: {
        kind: "resize",
        rect: { x: 252, y: 176, width: 48, height: 24 },
      },
    });
    const result = controller.cancel();
    expect(result).toMatchObject({
      cancelled: true,
      gesture: {
        kind: "resize",
        startRect: start.rect,
        rect: { x: 252, y: 176, width: 48, height: 24 },
      },
      state: { phase: "idle" },
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it("commits each of the eight resize handles through one common sequence", () => {
    const expected = {
      nw: { x: 60, y: 80, width: 240, height: 120 },
      n: { x: 100, y: 80, width: 200, height: 120 },
      ne: { x: 100, y: 80, width: 240, height: 120 },
      w: { x: 60, y: 100, width: 240, height: 100 },
      e: { x: 100, y: 100, width: 240, height: 100 },
      sw: { x: 60, y: 100, width: 240, height: 120 },
      s: { x: 100, y: 100, width: 200, height: 120 },
      se: { x: 100, y: 100, width: 240, height: 120 },
    } as const;
    const clientMove = {
      nw: { x: 80, y: 90 },
      n: { x: 100, y: 90 },
      ne: { x: 120, y: 90 },
      w: { x: 80, y: 100 },
      e: { x: 120, y: 100 },
      sw: { x: 80, y: 110 },
      s: { x: 100, y: 110 },
      se: { x: 120, y: 110 },
    } as const;

    for (const handle of Object.keys(expected) as Array<
      keyof typeof expected
    >) {
      const commit = vi.fn(() => ({ handled: true }) as const);
      const controller = createCanvasGestureController({ adapter: { commit } });
      controller.pointerDown({
        kind: "resize",
        objectIds: ["title"],
        pointer: { x: 100, y: 100 },
        viewport: { left: 0, top: 0, width: 500, height: 250 },
        canvas: { width: 1000, height: 500 },
        handle,
        rect: { x: 100, y: 100, width: 200, height: 100 },
      });
      expect(controller.pointerUp(clientMove[handle])).toMatchObject({
        committed: true,
        gesture: { kind: "resize", rect: expected[handle] },
      });
      expect(commit).toHaveBeenCalledTimes(1);
    }
  });

  it("does not start unsupported gestures or commit pointer clicks", () => {
    const commit = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      capabilities: { move: false, resize: true },
      adapter: { commit },
    });
    const viewport = { left: 0, top: 0, width: 100, height: 100 };
    const canvas = { width: 100, height: 100 };
    expect(
      controller.pointerDown({
        kind: "move",
        objectIds: ["title"],
        pointer: { x: 10, y: 10 },
        viewport,
        canvas,
      }),
    ).toMatchObject({ accepted: false, reason: "unsupported" });
    expect(controller.pointerUp({ x: 10, y: 10 })).toMatchObject({
      committed: false,
      reason: "idle",
    });

    expect(
      controller.pointerDown({
        kind: "resize",
        objectIds: ["title"],
        pointer: { x: 10, y: 10 },
        viewport,
        canvas,
        handle: "se",
        rect: { x: 0, y: 0, width: 20, height: 20 },
      }),
    ).toMatchObject({ accepted: true });
    expect(controller.pointerUp({ x: 11, y: 11 })).toMatchObject({
      committed: false,
      reason: "below-threshold",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps client-to-canvas conversion correct across zoom levels", () => {
    const canvas = { width: 1920, height: 1080 };
    const cases = [
      {
        viewport: { left: 0, top: 0, width: 1920, height: 1080 },
        clientDelta: { x: 96, y: -54 },
        canvasDelta: { x: 96, y: -54 },
      },
      {
        viewport: { left: 30, top: 70, width: 960, height: 540 },
        clientDelta: { x: 96, y: -54 },
        canvasDelta: { x: 192, y: -108 },
      },
      {
        viewport: { left: -20, top: 15, width: 480, height: 270 },
        clientDelta: { x: 96, y: -54 },
        canvasDelta: { x: 384, y: -216 },
      },
    ];

    for (const testCase of cases) {
      expect(
        clientDeltaToCanvasDelta(
          testCase.clientDelta,
          testCase.viewport,
          canvas,
        ),
      ).toEqual(testCase.canvasDelta);
    }
  });

  it("makes one commit after many previews while modifiers remain live", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      drag: { threshold: 3, duplicateModifier: "alt" },
      adapter: { preview, commit },
    });
    const start = {
      kind: "move" as const,
      objectIds: ["object"],
      pointer: { x: 0, y: 0, altKey: true },
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 200, height: 200 },
    };

    controller.pointerDown(start);
    controller.pointerMove({ x: 4, y: 1, altKey: true, shiftKey: true });
    controller.pointerMove({ x: 8, y: 3, altKey: false, shiftKey: false });
    const end = controller.pointerUp({ x: 12, y: 5, altKey: false });

    expect(preview).toHaveBeenCalledTimes(3);
    expect(preview).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        canvasDelta: { x: 8, y: 0 },
        duplicate: true,
      }),
    );
    expect(preview).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        canvasDelta: { x: 16, y: 6 },
        duplicate: false,
      }),
    );
    expect(end).toMatchObject({
      committed: true,
      gesture: { canvasDelta: { x: 24, y: 10 }, duplicate: false },
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("does not issue a duplicate final preview when pointer-up repeats the last move", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      adapter: { preview, commit },
    });
    const start = {
      kind: "move" as const,
      objectIds: ["object"],
      pointer: { x: 10, y: 10 },
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
    };

    controller.pointerDown(start);
    controller.pointerMove({ x: 20, y: 10 });
    controller.pointerUp({ x: 20, y: 10 });

    expect(preview).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("duplicates only when the configured modifier was held at drag start and release", () => {
    const commit = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      drag: { duplicateModifier: "alt" },
      adapter: { commit },
    });
    const base = {
      kind: "move" as const,
      objectIds: ["object"],
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
    };

    controller.pointerDown({ ...base, pointer: { x: 0, y: 0 } });
    expect(controller.pointerUp({ x: 10, y: 0, altKey: true })).toMatchObject({
      gesture: { duplicate: false },
    });

    controller.pointerDown({ ...base, pointer: { x: 0, y: 0, altKey: true } });
    controller.pointerMove({ x: 10, y: 0, altKey: true });
    expect(controller.pointerUp({ x: 10, y: 0, altKey: false })).toMatchObject({
      gesture: { duplicate: false },
    });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("returns to a clean idle state after pending cancellation and sequential gestures", () => {
    const preview = vi.fn(() => ({ handled: true }) as const);
    const commit = vi.fn(() => ({ handled: true }) as const);
    const cancel = vi.fn(() => ({ handled: true }) as const);
    const controller = createCanvasGestureController({
      adapter: { preview, commit, cancel },
    });
    const start = {
      kind: "move" as const,
      objectIds: ["first"],
      pointer: { x: 0, y: 0 },
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
    };

    controller.pointerDown(start);
    expect(controller.cancel()).toMatchObject({
      cancelled: false,
      reason: "idle",
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({ phase: "idle", gesture: null });

    controller.pointerDown({ ...start, objectIds: ["second"] });
    controller.pointerMove({ x: 10, y: 0 });
    expect(controller.cancel()).toMatchObject({ cancelled: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual({ phase: "idle", gesture: null });

    controller.pointerDown({ ...start, objectIds: ["third"] });
    const end = controller.pointerUp({ x: 10, y: 0 });
    expect(end).toMatchObject({
      committed: true,
      gesture: { objectIds: ["third"] },
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

const DEFAULT_CAPABILITIES = {
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
  snapping: true,
  alignment: true,
  distribution: true,
  grouping: true,
  rotation: true,
  marquee: true,
} as const;
