import { describe, expect, it } from "vitest";

import {
  actionExecutionStorage,
  noteObservedWrite,
  observingWrites,
  withoutWriteObservation,
  type ActionExecutionFrame,
} from "./action-frame.js";

function frame(parent?: ActionExecutionFrame): ActionExecutionFrame {
  return {
    key: {},
    run: async () => undefined,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    writeObserved: false,
    ...(parent ? { parent } : {}),
  };
}

function inFrame<T>(current: ActionExecutionFrame, fn: () => T): T {
  if (!actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
  return actionExecutionStorage.run(
    { frame: current, failures: new WeakMap() },
    fn,
  );
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("noteObservedWrite", () => {
  it("does nothing outside an action call", () => {
    expect(() => noteObservedWrite("db")).not.toThrow();
    expect(observingWrites()).toBe(false);
  });

  it("marks the running call as its own write, and every enclosing call as nested", () => {
    const root = frame();
    const child = frame(root);
    inFrame(child, () => noteObservedWrite("db"));
    expect(child).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "db",
    });
    expect(child.nestedWriteObserved).toBeUndefined();
    expect(root).toMatchObject({
      writeObserved: true,
      nestedWriteObserved: true,
      writeObservedChannel: "db",
    });
  });

  it("leaves a sibling and a child of the writing call alone", () => {
    const root = frame();
    const writer = frame(root);
    const sibling = frame(root);
    const grandchild = frame(writer);
    inFrame(writer, () => noteObservedWrite("db"));
    expect(sibling.writeObserved).toBe(false);
    expect(grandchild.writeObserved).toBe(false);
  });

  it("only adds evidence: a later note never clears or renames it", () => {
    const only = frame();
    inFrame(only, () => {
      noteObservedWrite("db");
      noteObservedWrite("provider");
    });
    expect(only).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "db",
    });
    expect(only.nestedWriteObserved).toBeUndefined();
  });

  it("is seen by work the call starts and does not await", async () => {
    const only = frame();
    await inFrame(only, async () => {
      await pause();
      noteObservedWrite("db");
    });
    expect(only.writeObserved).toBe(true);
  });
});

describe("withoutWriteObservation", () => {
  it("runs the function and returns its value outside an action call", () => {
    expect(withoutWriteObservation(() => 7)).toBe(7);
  });

  it("keeps bookkeeping from counting as the call's write, across awaits", async () => {
    const only = frame();
    await inFrame(only, async () => {
      await withoutWriteObservation(async () => {
        expect(observingWrites()).toBe(false);
        noteObservedWrite("audit");
        await pause();
        noteObservedWrite("audit");
      });
    });
    expect(only.writeObserved).toBe(false);
  });

  it("counts a write made after the bookkeeping, and one made before it", () => {
    const only = frame();
    inFrame(only, () => {
      withoutWriteObservation(() => noteObservedWrite("audit"));
      expect(observingWrites()).toBe(true);
      noteObservedWrite("db");
    });
    expect(only).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "db",
    });
  });

  it("still counts an action the bookkeeping runs in a frame of its own", () => {
    const outer = frame();
    const inner = frame(outer);
    inFrame(outer, () =>
      withoutWriteObservation(() =>
        inFrame(inner, () => noteObservedWrite("db")),
      ),
    );
    expect(inner.writeObserved).toBe(true);
    expect(outer).toMatchObject({
      writeObserved: true,
      nestedWriteObserved: true,
    });
  });

  it("does not leak into a call that overlaps it", async () => {
    const quiet = frame();
    const busy = frame();
    await Promise.all([
      inFrame(quiet, () =>
        withoutWriteObservation(async () => {
          await pause();
          noteObservedWrite("audit");
          await pause();
        }),
      ),
      inFrame(busy, async () => {
        await pause();
        noteObservedWrite("db");
      }),
    ]);
    expect(quiet.writeObserved).toBe(false);
    expect(busy.writeObserved).toBe(true);
  });
});

describe("observingWrites", () => {
  it("is true inside a call until it has seen a write", () => {
    const only = frame();
    inFrame(only, () => {
      expect(observingWrites()).toBe(true);
      noteObservedWrite("db");
      expect(observingWrites()).toBe(false);
    });
  });
});
