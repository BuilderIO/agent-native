import { describe, expect, it } from "vitest";

import { takeWithinCap } from "./cap.js";
import type { FlowItem } from "./types.js";

const item = (id: string, size = 10): FlowItem => ({
  id,
  data: { blob: "x".repeat(size) },
  nodes: {},
  inbox: true,
});

describe("takeWithinCap", () => {
  it("takes every item when they fit", () => {
    const { taken, oversized } = takeWithinCap([item("a"), item("b")]);
    expect(taken.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(oversized).toBe(false);
  });

  it("stops at the item count", () => {
    const { taken } = takeWithinCap([item("a"), item("b"), item("c")], 2);
    expect(taken.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("stops before the item that would go over the bytes, keeping the leading ones", () => {
    const { taken } = takeWithinCap(
      [item("a", 100), item("b", 100), item("c", 100)],
      100,
      300,
    );
    expect(taken.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("says when not even the first item fits", () => {
    const { taken, oversized } = takeWithinCap([item("a", 1000)], 100, 100);
    expect(taken).toEqual([]);
    expect(oversized).toBe(true);
  });

  it("is not oversized when there was nothing to take", () => {
    expect(takeWithinCap([]).oversized).toBe(false);
  });
});
