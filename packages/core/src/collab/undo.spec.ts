import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createLocalOpUndoController } from "./undo.js";

type Op = { op: string; path: string; value?: unknown };

function makeController(overrides?: {
  apply?: (ops: Op[], direction: "undo" | "redo") => void | Promise<void>;
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

  it("ignores re-entrant pushes triggered by apply", async () => {
    let controllerRef: ReturnType<
      typeof createLocalOpUndoController<Op>
    > | null = null;
    const controller = createLocalOpUndoController<Op>({
      apply: () => {
        // A naive integration records mutations from its normal path — the
        // controller must ignore pushes caused by its own undo application.
        controllerRef!.push({ undo: [{ op: "echo", path: "x" }], redo: [] });
      },
    });
    controllerRef = controller;

    controller.push({ undo: [{ op: "real", path: "1" }], redo: [] });
    await controller.undo();

    // The echo push was swallowed; nothing new to undo.
    expect(controller.canUndo()).toBe(false);
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

    // One coalesced entry: undo restores v0 (first), redo re-applies v2 (last).
    await controller.undo();
    expect(applied[0].ops[0].value).toBe("v0");
    expect(controller.canUndo()).toBe(false);

    await controller.redo();
    expect(applied[1].ops[0].value).toBe("v2");
  });

  it("does not coalesce beyond the window or across keys", () => {
    let time = 0;
    const { controller } = makeController({ now: () => time, coalesceMs: 800 });

    controller.push({ undo: [], redo: [], coalesceKey: "k1" });
    time = 900; // beyond window
    controller.push({ undo: [], redo: [], coalesceKey: "k1" });
    controller.push({ undo: [], redo: [], coalesceKey: "k2" });

    expect(controller.canUndo()).toBe(true);
    expect(controller.peekUndoLabel()).toBeUndefined();
    // Three distinct entries: undo three times.
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
    // Two docs simulating two participants sharing state via updates.
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const textA = docA.getText("t");
    const textB = docB.getText("t");

    // Relay updates in both directions with a "remote" origin.
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
    // Only the local user's edit is reverted; the peer's edit survives.
    expect(textA.toString()).toBe("theirs");
    expect(textB.toString()).toBe("theirs");

    undoManager.destroy();
    docA.destroy();
    docB.destroy();
  });
});
