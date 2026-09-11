import { describe, expect, it } from "vitest";
import type { Awareness } from "y-protocols/awareness";

import { isReconcileLeadClient } from "./lead-client.js";

/** Minimal Awareness stand-in: isReconcileLeadClient only calls getStates(). */
function fakeAwareness(states: Map<number, unknown>): Awareness {
  return { getStates: () => states } as unknown as Awareness;
}

describe("isReconcileLeadClient", () => {
  it("does not elect a read-only viewer that can never apply a snapshot", () => {
    const states = new Map<number, unknown>([
      [3, { user: { name: "Viewer" }, canFlushDocument: false }],
      [7, { user: { name: "Editor" }, canFlushDocument: true }],
    ]);

    expect(isReconcileLeadClient(fakeAwareness(states), 7)).toBe(true);
  });
});
