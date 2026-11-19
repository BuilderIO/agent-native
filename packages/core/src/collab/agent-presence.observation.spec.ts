import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  actionExecutionStorage,
  noteObservedWrite,
  type ActionExecutionFrame,
} from "../action-frame.js";

vi.mock("./awareness-store.js", () => ({
  upsertAwarenessRow: vi.fn(async () => {
    noteObservedWrite("db");
  }),
  deleteAwarenessRow: vi.fn(async () => {
    noteObservedWrite("db");
  }),
}));

import {
  agentEnterDocument,
  agentLeaveDocument,
  agentTouchDocument,
} from "./agent-presence.js";
import { deleteAwarenessRow, upsertAwarenessRow } from "./awareness-store.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("agent presence inside an action call", () => {
  it("is not a write of that call, including the heartbeat that outlives it", () => {
    const frame: ActionExecutionFrame = {
      key: {},
      run: async () => undefined,
      handlerEntered: true,
      writeEntered: false,
      changeEntered: false,
      writeObserved: false,
    };
    if (!actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
    actionExecutionStorage.run({ frame, failures: new WeakMap() }, () => {
      agentEnterDocument("presence-observation");
      agentTouchDocument("presence-observation", { metadata: { cursor: 1 } });
    });
    vi.advanceTimersByTime(25_000);
    actionExecutionStorage.run({ frame, failures: new WeakMap() }, () =>
      agentLeaveDocument("presence-observation", { lingerMs: 0 }),
    );

    expect(upsertAwarenessRow).toHaveBeenCalled();
    expect(deleteAwarenessRow).toHaveBeenCalled();
    expect(frame.writeObserved).toBe(false);
  });
});
