import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createLocalOpUndoController } from "./undo.js";

type Op = { op: string; path: string; value?: unknown };

function makeController(overrides?: {
  apply?: (
    ops: Op[],
    direction: "undo" | "redo",
  ) => void | boolean | Promise<void | boolean>;
  now?: () => number;
  maxDepth?: number;
  coalesceMs?: number;
}) {
  const applied: Array<{ ops: Op[]; direction: "undo" | "redo" }> = [];
  const controller = createLocalOpUndoController<Op>({
    apply:
      overrides?.apply ??
      ((ops, direction) => {
        applied.push({ ops, direction });
      }),
    now: overrides?.now,
    maxDepth: overrides?.maxDepth,
    coalesceMs: overrides?.coalesceMs,
  });
  return { controller, applied };
}

describe("createLocalOpUndoController", () => {
  it("undo applies the inverse ops; redo re-applies", async () => {
    const { controller, applied } = makeController();

    controller.push({
      undo: [{ op: "patch", path: "slides.1", value: "old" }],
      redo: [{ op: "patch", path: "slides.1", value: "new" }],
      label: "Edit slide 1",
    });

    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    await controller.undo();
    expect(applied).toEqual([
      {
        ops: [{ op: "patch", path: "slides.1", value: "old" }],
        direction: "undo",
      },
    ]);
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);

    await controller.redo();
    expect(applied[1]).toEqual({
      ops: [{ op: "patch", path: "slides.1", value: "new" }],
      direction: "redo",
    });
    expect(controller.canUndo()).toBe(true);
  });

  it("publishes synchronous history movement before undo returns", async () => {
    const { controller } = makeController();
    controller.push({ undo: [{ op: "patch", path: "slides.1" }], redo: [] });

    const undo = controller.undo();

    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);
    await undo;

    const redo = controller.redo();
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);
    await redo;
  });

  it("push clears the redo stack", async () => {
    const { controller } = makeController();
    controller.push({ undo: [{ op: "a", path: "1" }], redo: [] });
    await controller.undo();
    expect(controller.canRedo()).toBe(true);

    controller.push({ undo: [{ op: "b", path: "2" }], redo: [] });
    expect(controller.canRedo()).toBe(false);
  });

  it("undo/redo on empty stacks return false", async () => {
    const { controller } = makeController();
    expect(await controller.undo()).toBe(false);
    expect(await controller.redo()).toBe(false);
  });

  it("keeps a history entry when applying it reports no change", async () => {
    let applied = false;
    const { controller } = makeController({
      apply: () => applied,
    });
    controller.push({
      undo: [{ op: "patch", path: "slide.content", value: "before" }],
      redo: [{ op: "patch", path: "slide.content", value: "after" }],
    });

    expect(await controller.undo()).toBe(false);
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    applied = true;
    expect(await controller.undo()).toBe(true);
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);
  });

  it("discards a conflicted entry without hiding older history or creating redo", async () => {
    const controller = createLocalOpUndoController<Op>({
      apply: (ops) => (ops[0]?.op === "conflict" ? "conflict" : true),
    });
    controller.push({
      undo: [{ op: "patch", path: "older", value: "before" }],
      redo: [{ op: "patch", path: "older", value: "after" }],
      label: "Older edit",
    });
    controller.push({
      undo: [{ op: "conflict", path: "newer", value: "before" }],
      redo: [{ op: "conflict", path: "newer", value: "after" }],
      label: "Conflicted edit",
    });

    expect(await controller.undo()).toBe(false);
    expect(controller.peekUndoLabel()).toBe("Older edit");
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    expect(await controller.undo()).toBe(true);
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);
  });

  it("reports and discards a rejected undo while keeping older history reachable", async () => {
    const error = new Error("undo persistence failed");
    const onApplyError = vi.fn();
    const onChange = vi.fn();
    const controller = createLocalOpUndoController<Op>({
      apply: (ops) => {
        if (ops[0]?.op === "failed") throw error;
      },
      onApplyError,
      onChange,
    });
    controller.push({
      undo: [{ op: "patch", path: "older", value: "before" }],
      redo: [{ op: "patch", path: "older", value: "after" }],
      label: "Older edit",
    });
    controller.push({
      undo: [{ op: "failed", path: "newer", value: "before" }],
      redo: [{ op: "failed", path: "newer", value: "after" }],
      label: "Failed edit",
    });
    onChange.mockClear();

    expect(await controller.undo()).toBe(false);
    expect(onApplyError).toHaveBeenCalledWith(
      error,
      "undo",
      expect.objectContaining({ label: "Failed edit" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(controller.peekUndoLabel()).toBe("Older edit");
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    expect(await controller.undo()).toBe(true);
    expect(controller.canUndo()).toBe(false);
  });

  it("reports and discards a rejected redo without restoring the failed entry", async () => {
    const error = new Error("redo persistence failed");
    const onApplyError = vi.fn();
    let failRedo = false;
    const controller = createLocalOpUndoController<Op>({
      apply: (_ops, direction) => {
        if (failRedo && direction === "redo") throw error;
      },
      onApplyError,
    });
    controller.push({
      undo: [{ op: "patch", path: "older", value: "before" }],
      redo: [{ op: "patch", path: "older", value: "after" }],
      label: "Older edit",
    });
    controller.push({
      undo: [{ op: "patch", path: "newer", value: "before" }],
      redo: [{ op: "patch", path: "newer", value: "after" }],
      label: "Failed redo",
    });

    expect(await controller.undo()).toBe(true);
    failRedo = true;
    expect(await controller.redo()).toBe(false);
    expect(onApplyError).toHaveBeenCalledWith(
      error,
      "redo",
      expect.objectContaining({ label: "Failed redo" }),
    );
    expect(controller.canUndo()).toBe(true);
    expect(controller.peekUndoLabel()).toBe("Older edit");
    expect(controller.canRedo()).toBe(false);
  });

  it("rethrows an apply failure when no error handler is configured", async () => {
    const error = new Error("apply failed");
    const controller = createLocalOpUndoController<Op>({
      apply: (ops) => {
        if (ops[0]?.op === "failed") throw error;
      },
    });
    controller.push({ undo: [{ op: "patch", path: "older" }], redo: [] });
    controller.push({
      undo: [{ op: "failed", path: "newer" }],
      redo: [],
      label: "Failed edit",
    });

    await expect(controller.undo()).rejects.toBe(error);
    expect(controller.peekUndoLabel()).toBeUndefined();
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);
    expect(await controller.undo()).toBe(true);
  });

  it("does not start a second undo while the current apply is pending", async () => {
    let finishApply!: () => void;
    const { controller, applied } = makeController({
      apply: (ops, direction) =>
        new Promise<void>((resolve) => {
          applied.push({ ops, direction });
          finishApply = resolve;
        }),
    });
    controller.push({
      undo: [{ op: "patch", path: "slide.1", value: "before-1" }],
      redo: [{ op: "patch", path: "slide.1", value: "after-1" }],
    });
    controller.push({
      undo: [{ op: "patch", path: "slide.2", value: "before-2" }],
      redo: [{ op: "patch", path: "slide.2", value: "after-2" }],
    });

    const firstUndo = controller.undo();
    expect(await controller.undo()).toBe(false);
    expect(applied).toHaveLength(1);
    finishApply();
    expect(await firstUndo).toBe(true);
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(true);
  });

  it("ignores re-entrant pushes triggered by apply", async () => {
    let controllerRef: ReturnType<
      typeof createLocalOpUndoController<Op>
    > | null = null;
    const controller = createLocalOpUndoController<Op>({
      apply: () => {
        controllerRef!.push({ undo: [{ op: "echo", path: "x" }], redo: [] });
      },
    });
    controllerRef = controller;

    controller.push({ undo: [{ op: "real", path: "1" }], redo: [] });
    await controller.undo();

    expect(controller.canUndo()).toBe(false);
  });

  it("ignores pushes triggered while publishing the completed undo", async () => {
    let controllerRef: ReturnType<
      typeof createLocalOpUndoController<Op>
    > | null = null;
    let addDuringNotification = false;
    const controller = createLocalOpUndoController<Op>({
      apply: () => {},
      onChange: () => {
        if (!addDuringNotification) return;
        controllerRef!.push({
          undo: [{ op: "echo", path: "x" }],
          redo: [],
        });
      },
    });
    controllerRef = controller;

    controller.push({ undo: [{ op: "real", path: "1" }], redo: [] });
    addDuringNotification = true;
    await controller.undo();

    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);
  });

  it("coalesces same-key pushes within the window", async () => {
    let time = 0;
    const { controller, applied } = makeController({
      now: () => time,
      coalesceMs: 800,
    });

    controller.push({
      undo: [{ op: "patch", path: "f", value: "v0" }],
      redo: [{ op: "patch", path: "f", value: "v1" }],
      coalesceKey: "slide-1:content",
    });
    time = 500;
    controller.push({
      undo: [{ op: "patch", path: "f", value: "v1" }],
      redo: [{ op: "patch", path: "f", value: "v2" }],
      coalesceKey: "slide-1:content",
    });

    await controller.undo();
    expect(applied[0].ops[0].value).toBe("v0");
    expect(controller.canUndo()).toBe(false);

    await controller.redo();
    expect(applied[1].ops[0].value).toBe("v2");
  });

  it("allows an entry to coalesce across a long-lived operation group", async () => {
    let time = 0;
    const { controller, applied } = makeController({
      now: () => time,
      coalesceMs: 800,
    });

    controller.push({
      undo: [{ op: "patch", path: "deck", value: "before" }],
      redo: [{ op: "patch", path: "deck", value: "first" }],
      coalesceKey: "agent:turn-1",
      coalesceWindowMs: Number.POSITIVE_INFINITY,
    });
    time = 60_000;
    controller.push({
      undo: [{ op: "patch", path: "deck", value: "first" }],
      redo: [{ op: "patch", path: "deck", value: "last" }],
      coalesceKey: "agent:turn-1",
      coalesceWindowMs: Number.POSITIVE_INFINITY,
    });

    await controller.undo();
    expect(applied[0].ops[0].value).toBe("before");
    expect(controller.canUndo()).toBe(false);
  });

  it("does not coalesce beyond the window or across keys", () => {
    let time = 0;
    const { controller } = makeController({ now: () => time, coalesceMs: 800 });

    controller.push({ undo: [], redo: [], coalesceKey: "k1" });
    time = 900;
    controller.push({ undo: [], redo: [], coalesceKey: "k1" });
    controller.push({ undo: [], redo: [], coalesceKey: "k2" });

    expect(controller.canUndo()).toBe(true);
    expect(controller.peekUndoLabel()).toBeUndefined();
    return (async () => {
      expect(await controller.undo()).toBe(true);
      expect(await controller.undo()).toBe(true);
      expect(await controller.undo()).toBe(true);
      expect(await controller.undo()).toBe(false);
    })();
  });

  it("caps the stack at maxDepth", async () => {
    const { controller } = makeController({ maxDepth: 3 });
    for (let i = 0; i < 5; i++) {
      controller.push({ undo: [{ op: `u${i}`, path: "p" }], redo: [] });
    }
    let undone = 0;
    while (await controller.undo()) undone++;
    expect(undone).toBe(3);
  });

  it("exposes labels for UI", async () => {
    const { controller } = makeController();
    controller.push({ undo: [], redo: [], label: "Delete slide" });
    expect(controller.peekUndoLabel()).toBe("Delete slide");
    await controller.undo();
    expect(controller.peekRedoLabel()).toBe("Delete slide");
  });
});

describe("Y.UndoManager local-origin scoping (contract check)", () => {
  it("undoes only transactions tagged with the tracked origin", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const textA = docA.getText("t");
    const textB = docB.getText("t");

    docA.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(docB, u, "remote");
    });
    docB.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(docA, u, "remote");
    });

    const LOCAL = { local: true };
    const undoManager = new Y.UndoManager(textA, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 0,
    });

    docA.transact(() => textA.insert(0, "mine "), LOCAL);
    docB.transact(() => textB.insert(textB.length, "theirs"), "peer-local");

    expect(textA.toString()).toBe("mine theirs");

    undoManager.undo();
    expect(textA.toString()).toBe("theirs");
    expect(textB.toString()).toBe("theirs");

    undoManager.destroy();
    docA.destroy();
    docB.destroy();
  });
});
