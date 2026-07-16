import { describe, expect, it } from "vitest";

import {
  computeInsertOffsets,
  computeReorderOffsets,
  computeVacateOffsets,
  type DragTargetCandidate,
  type HysteresisState,
  isContainerTooSmallForDrag,
  isSimplePackedContainer,
  mainAxisForDirection,
  type PackedContainerInfo,
  resolveTargetHysteresis,
} from "./drag-reflow";

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

function candidate(
  over: Partial<DragTargetCandidate> & Pick<DragTargetCandidate, "key">,
): DragTargetCandidate {
  return {
    pointer: { x: 0, y: 0 },
    containerPenetrationPx: Infinity,
    isLeave: false,
    ...over,
  };
}

function committed(
  key: { containerKey: string; index: number },
  at: number,
  pointer = { x: 0, y: 0 },
): HysteresisState {
  return {
    key,
    committedAt: at,
    committedPointer: pointer,
    pendingKey: null,
    pendingAt: 0,
  };
}

describe("resolveTargetHysteresis", () => {
  it("clears instantly when the candidate is null", () => {
    const prev = committed({ containerKey: "A", index: 0 }, 0);
    const res = resolveTargetHysteresis(prev, candidate({ key: null }), 5);
    expect(res.key).toBeNull();
    expect(res.changed).toBe(true);
    expect(res.state).toBeNull();
  });

  it("reports no change when clearing from an already-empty state", () => {
    const res = resolveTargetHysteresis(null, candidate({ key: null }), 5);
    expect(res.key).toBeNull();
    expect(res.changed).toBe(false);
  });

  it("accepts the first target immediately (no lag before the guide appears)", () => {
    const res = resolveTargetHysteresis(
      null,
      candidate({
        key: { containerKey: "A", index: 2 },
        pointer: { x: 10, y: 5 },
      }),
      100,
    );
    expect(res.key).toEqual({ containerKey: "A", index: 2 });
    expect(res.changed).toBe(true);
    expect(res.state?.committedPointer).toEqual({ x: 10, y: 5 });
  });

  it("holds an unchanged target and clears any pending candidate", () => {
    const prev: HysteresisState = {
      ...committed({ containerKey: "A", index: 1 }, 40, { x: 50, y: 0 }),
      pendingKey: { containerKey: "A", index: 2 },
      pendingAt: 30,
    };
    const res = resolveTargetHysteresis(
      prev,
      candidate({
        key: { containerKey: "A", index: 1 },
        pointer: { x: 52, y: 0 },
      }),
      999,
    );
    expect(res.changed).toBe(false);
    expect(res.state?.pendingKey).toBeNull();
    expect(res.state?.committedPointer).toEqual({ x: 50, y: 0 });
  });

  describe("index change within the same container", () => {
    it("rejects a small jitter that has not moved far or dwelled", () => {
      const prev = committed({ containerKey: "A", index: 0 }, 0, {
        x: 100,
        y: 0,
      });
      const res = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "A", index: 1 },
          pointer: { x: 103, y: 0 },
        }),
        10,
      );
      expect(res.changed).toBe(false);
      expect(res.key).toEqual({ containerKey: "A", index: 0 });
      expect(res.state?.pendingKey).toEqual({ containerKey: "A", index: 1 });
    });

    it("accepts once the pointer moves >= 8px from the last commit", () => {
      const prev = committed({ containerKey: "A", index: 0 }, 0, {
        x: 100,
        y: 0,
      });
      const res = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "A", index: 1 },
          pointer: { x: 112, y: 0 },
        }),
        10,
      );
      expect(res.changed).toBe(true);
      expect(res.key).toEqual({ containerKey: "A", index: 1 });
    });

    it("dwell times the NEW candidate, not the committed slot's age", () => {
      const prev = committed({ containerKey: "A", index: 0 }, 0, {
        x: 100,
        y: 0,
      });
      const first = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "A", index: 1 },
          pointer: { x: 101, y: 0 },
        }),
        1000,
      );
      expect(first.changed).toBe(false);
      const second = resolveTargetHysteresis(
        first.state,
        candidate({
          key: { containerKey: "A", index: 1 },
          pointer: { x: 101, y: 0 },
        }),
        1060,
      );
      expect(second.changed).toBe(true);
    });

    it("resets the dwell timer when the candidate slot changes", () => {
      const prev = committed({ containerKey: "A", index: 0 }, 0, {
        x: 100,
        y: 0,
      });
      const t1 = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "A", index: 1 },
          pointer: { x: 101, y: 0 },
        }),
        1000,
      );
      const t2 = resolveTargetHysteresis(
        t1.state,
        candidate({
          key: { containerKey: "A", index: 2 },
          pointer: { x: 102, y: 0 },
        }),
        1050,
      );
      expect(t2.changed).toBe(false);
      expect(t2.state?.pendingAt).toBe(1050);
    });
  });

  describe("container change", () => {
    const prev = committed({ containerKey: "A", index: 3 }, 0);

    it("reverses instantly when leaving to an ancestor", () => {
      const res = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "PARENT", index: 1 },
          isLeave: true,
          containerPenetrationPx: 0,
        }),
        1,
      );
      expect(res.changed).toBe(true);
      expect(res.key).toEqual({ containerKey: "PARENT", index: 1 });
    });

    it("rejects a shallow entry into a new container before penetration/dwell", () => {
      const res = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "B", index: 0 },
          containerPenetrationPx: 5,
        }),
        10,
      );
      expect(res.changed).toBe(false);
      expect(res.key).toEqual({ containerKey: "A", index: 3 });
    });

    it("accepts once penetration >= 10px", () => {
      const res = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "B", index: 0 },
          containerPenetrationPx: 12,
        }),
        10,
      );
      expect(res.changed).toBe(true);
      expect(res.key).toEqual({ containerKey: "B", index: 0 });
    });

    it("accepts a shallow entry on dwell", () => {
      const t1 = resolveTargetHysteresis(
        prev,
        candidate({
          key: { containerKey: "B", index: 0 },
          containerPenetrationPx: 5,
        }),
        0,
      );
      const t2 = resolveTargetHysteresis(
        t1.state,
        candidate({
          key: { containerKey: "B", index: 0 },
          containerPenetrationPx: 5,
        }),
        80,
      );
      expect(t2.changed).toBe(true);
    });
  });

  it("honors custom thresholds", () => {
    const prev = committed({ containerKey: "A", index: 0 }, 0, {
      x: 100,
      y: 0,
    });
    const res = resolveTargetHysteresis(
      prev,
      candidate({
        key: { containerKey: "A", index: 1 },
        pointer: { x: 103, y: 0 },
      }),
      5,
      { movePx: 2 },
    );
    expect(res.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size guard
// ---------------------------------------------------------------------------

describe("isContainerTooSmallForDrag", () => {
  it("allows a container that fits the dragged element", () => {
    expect(
      isContainerTooSmallForDrag(
        { width: 100, height: 40 },
        { width: 50, height: 20 },
      ),
    ).toBe(false);
  });

  it("rejects a container narrower than the dragged element", () => {
    expect(
      isContainerTooSmallForDrag(
        { width: 30, height: 40 },
        { width: 50, height: 20 },
      ),
    ).toBe(true);
  });

  it("rejects a container shorter than the dragged element", () => {
    expect(
      isContainerTooSmallForDrag(
        { width: 100, height: 10 },
        { width: 50, height: 20 },
      ),
    ).toBe(true);
  });

  it("is bypassed by the ⌘ override", () => {
    expect(
      isContainerTooSmallForDrag(
        { width: 5, height: 5 },
        { width: 500, height: 500 },
        { bypass: true },
      ),
    ).toBe(false);
  });

  it("does not reject on an axis the container hugs (it would grow to fit)", () => {
    // Container is too narrow, but it hugs its width → allowed.
    expect(
      isContainerTooSmallForDrag(
        { width: 30, height: 40 },
        { width: 50, height: 20 },
        { hugAxis: "width" },
      ),
    ).toBe(false);
    // …still rejected if it is also too short on the non-hug axis.
    expect(
      isContainerTooSmallForDrag(
        { width: 30, height: 10 },
        { width: 50, height: 20 },
        { hugAxis: "width" },
      ),
    ).toBe(true);
  });

  it("respects tolerance slack", () => {
    expect(
      isContainerTooSmallForDrag(
        { width: 48, height: 40 },
        { width: 50, height: 20 },
        { tolerancePx: 4 },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Packed-container detection
// ---------------------------------------------------------------------------

function packed(over: Partial<PackedContainerInfo> = {}): PackedContainerInfo {
  return {
    display: "flex",
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "flex-start",
    gap: 8,
    hasFlexGrowChild: false,
    ...over,
  };
}

describe("isSimplePackedContainer", () => {
  it("accepts a start-aligned, nowrap, fixed-gap flex row/column", () => {
    expect(isSimplePackedContainer(packed())).toBe(true);
    expect(isSimplePackedContainer(packed({ flexDirection: "column" }))).toBe(
      true,
    );
    expect(isSimplePackedContainer(packed({ display: "inline-flex" }))).toBe(
      true,
    );
    expect(isSimplePackedContainer(packed({ justifyContent: "start" }))).toBe(
      true,
    );
    expect(isSimplePackedContainer(packed({ justifyContent: "normal" }))).toBe(
      true,
    );
    expect(isSimplePackedContainer(packed({ justifyContent: "" }))).toBe(true);
    expect(isSimplePackedContainer(packed({ gap: 0 }))).toBe(true);
  });

  it("rejects non-flex containers", () => {
    expect(isSimplePackedContainer(packed({ display: "block" }))).toBe(false);
    expect(isSimplePackedContainer(packed({ display: "grid" }))).toBe(false);
  });

  it("rejects distributed justification (the constant-shift model would lie)", () => {
    for (const jc of [
      "space-between",
      "space-around",
      "space-evenly",
      "center",
      "flex-end",
      "end",
    ]) {
      expect(isSimplePackedContainer(packed({ justifyContent: jc }))).toBe(
        false,
      );
    }
  });

  it("rejects wrap", () => {
    expect(isSimplePackedContainer(packed({ flexWrap: "wrap" }))).toBe(false);
    expect(isSimplePackedContainer(packed({ flexWrap: "wrap-reverse" }))).toBe(
      false,
    );
  });

  it("rejects reverse directions (offset signs would invert)", () => {
    expect(
      isSimplePackedContainer(packed({ flexDirection: "row-reverse" })),
    ).toBe(false);
    expect(
      isSimplePackedContainer(packed({ flexDirection: "column-reverse" })),
    ).toBe(false);
  });

  it("rejects a negative or non-finite gap", () => {
    expect(isSimplePackedContainer(packed({ gap: -4 }))).toBe(false);
    expect(isSimplePackedContainer(packed({ gap: NaN }))).toBe(false);
  });

  it("rejects a container with a flex-grow child (it resizes, not translates)", () => {
    expect(isSimplePackedContainer(packed({ hasFlexGrowChild: true }))).toBe(
      false,
    );
  });
});

describe("mainAxisForDirection", () => {
  it("maps row → x and column → y", () => {
    expect(mainAxisForDirection("row")).toBe("x");
    expect(mainAxisForDirection("row-reverse")).toBe("x");
    expect(mainAxisForDirection("column")).toBe("y");
    expect(mainAxisForDirection("column-reverse")).toBe("y");
  });
});

// ---------------------------------------------------------------------------
// Reflow offsets
// ---------------------------------------------------------------------------

describe("computeReorderOffsets", () => {
  const slotMain = 60;

  it("shifts intermediate siblings toward the start when moving later", () => {
    // 5 items, drag item 1 to before item 4.
    const offsets = computeReorderOffsets({
      count: 5,
      originIndex: 1,
      targetSlot: 4,
      slotMain,
    });
    expect(offsets).toEqual([0, 0, -60, -60, 0]);
  });

  it("shifts intermediate siblings toward the end when moving earlier", () => {
    // 5 items, drag item 3 to before item 1.
    const offsets = computeReorderOffsets({
      count: 5,
      originIndex: 3,
      targetSlot: 1,
      slotMain,
    });
    expect(offsets).toEqual([0, 60, 60, 0, 0]);
  });

  it("moves nothing when dropped back into the same slot", () => {
    expect(
      computeReorderOffsets({
        count: 5,
        originIndex: 2,
        targetSlot: 2,
        slotMain,
      }),
    ).toEqual([0, 0, 0, 0, 0]);
    // targetSlot === originIndex + 1 is also a no-op (before the very next sibling).
    expect(
      computeReorderOffsets({
        count: 5,
        originIndex: 2,
        targetSlot: 3,
        slotMain,
      }),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it("moves a single sibling when swapping adjacent neighbors", () => {
    // drag item 0 to before item 2 → only item 1 shifts start-ward.
    expect(
      computeReorderOffsets({
        count: 3,
        originIndex: 0,
        targetSlot: 2,
        slotMain,
      }),
    ).toEqual([0, -60, 0]);
  });

  it("moves to the very end", () => {
    // drag item 0 to end (before slot count) → items 1 and 2 shift start-ward.
    expect(
      computeReorderOffsets({
        count: 3,
        originIndex: 0,
        targetSlot: 3,
        slotMain,
      }),
    ).toEqual([0, -60, -60]);
  });
});

describe("computeVacateOffsets", () => {
  it("closes the gap by shifting following siblings toward the start", () => {
    expect(
      computeVacateOffsets({ count: 5, originIndex: 1, slotMain: 60 }),
    ).toEqual([0, 0, -60, -60, -60]);
  });

  it("moves nothing when the dragged item is last", () => {
    expect(
      computeVacateOffsets({ count: 3, originIndex: 2, slotMain: 60 }),
    ).toEqual([0, 0, 0]);
  });
});

describe("computeInsertOffsets", () => {
  it("opens a slot by shifting the insertion point and everything after it end-ward", () => {
    expect(
      computeInsertOffsets({ count: 4, targetSlot: 2, slotMain: 60 }),
    ).toEqual([0, 0, 60, 60]);
  });

  it("opens a leading slot (insert at front) by shifting all children", () => {
    expect(
      computeInsertOffsets({ count: 3, targetSlot: 0, slotMain: 60 }),
    ).toEqual([60, 60, 60]);
  });

  it("opens a trailing slot (append) with no sibling movement", () => {
    expect(
      computeInsertOffsets({ count: 3, targetSlot: 3, slotMain: 60 }),
    ).toEqual([0, 0, 0]);
  });
});
