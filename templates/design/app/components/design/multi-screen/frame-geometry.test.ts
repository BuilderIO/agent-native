import { describe, expect, it } from "vitest";

import {
  getCanonicalScreenStack,
  reorderCanonicalScreenStack,
} from "./frame-geometry";

describe("canonical overview screen stack", () => {
  const screens = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("uses persisted z and source order as the stable tie-break", () => {
    expect(
      getCanonicalScreenStack(screens, {
        a: { z: 20 },
        b: { z: -5 },
        c: { z: 20 },
      }),
    ).toEqual(["b", "d", "a", "c"]);
  });

  it("moves one or many screens below or above the target deterministically", () => {
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b", "c", "d"],
        draggedIds: ["b"],
        targetId: "d",
        placement: "after",
      }),
    ).toEqual(["a", "c", "d", "b"]);
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b", "c", "d"],
        draggedIds: ["c", "a"],
        targetId: "b",
        placement: "after",
      }),
    ).toEqual(["b", "a", "c", "d"]);
  });

  it("rejects inside, self-only, missing-target, and no-op moves", () => {
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "b",
        placement: "inside",
      }),
    ).toBeNull();
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "a",
        placement: "before",
      }),
    ).toBeNull();
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "missing",
        placement: "after",
      }),
    ).toBeNull();
    expect(
      reorderCanonicalScreenStack({
        orderedIds: ["a", "b"],
        draggedIds: ["a"],
        targetId: "b",
        placement: "before",
      }),
    ).toBeNull();
  });
});
