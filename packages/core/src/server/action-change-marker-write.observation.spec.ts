import { describe, expect, it, vi } from "vitest";

import {
  actionExecutionStorage,
  noteObservedWrite,
  type ActionExecutionFrame,
} from "../action-frame.js";

vi.mock("../application-state/store.js", () => ({
  appStatePut: vi.fn(async () => {
    noteObservedWrite("db");
  }),
}));

vi.mock("../resource-changes/store.js", () => ({
  runAfterWriteDrains: vi.fn(() => {
    noteObservedWrite("db");
  }),
}));

describe("writeActionChangeMarker inside an action call", () => {
  it("is not a write of the call it runs inside", async () => {
    const { writeActionChangeMarker } =
      await import("./action-change-marker-write.js");
    const frame: ActionExecutionFrame = {
      key: {},
      run: async () => undefined,
      handlerEntered: true,
      writeEntered: false,
      changeEntered: false,
      writeObserved: false,
    };
    if (!actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
    await actionExecutionStorage.run(
      { frame, failures: new WeakMap() },
      async () => {
        await writeActionChangeMarker({
          actionName: "create-file",
          owner: "owner@example.com",
        });
        noteObservedWrite("db");
      },
    );
    // Only the call's own write, made after the marker, counts.
    expect(frame.writeObserved).toBe(true);

    const quiet = { ...frame, writeObserved: false };
    await actionExecutionStorage.run(
      { frame: quiet, failures: new WeakMap() },
      () =>
        writeActionChangeMarker({
          actionName: "create-file",
          owner: "owner@example.com",
        }),
    );
    expect(quiet.writeObserved).toBe(false);
  });
});
