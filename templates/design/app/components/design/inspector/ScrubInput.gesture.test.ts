import { describe, expect, it } from "vitest";

import {
  getScrubStepFromEvent,
  normalizeScrubNumber,
  roundScrubDragValue,
  startScrubDrag,
  updateScrubDrag,
  type ScrubDragState,
} from "./scrub-input-utils";
import {
  resolvePendingScrubCommit,
  type ScrubInputChangeMeta,
} from "./ScrubInput";

function simulateScrubGesture(
  moves: number[],
  options: { step?: number; startValue?: number; unit?: string } = {},
) {
  const step = options.step ?? 1;
  const calls: Array<{ value: number; meta: ScrubInputChangeMeta }> = [];
  let value = options.startValue ?? 0;
  let lastScrubValue = value;
  let drag: ScrubDragState = startScrubDrag(moves[0] ?? 0);

  const onChange = (nextValue: number, meta: ScrubInputChangeMeta) => {
    calls.push({ value: nextValue, meta });
  };

  drag = startScrubDrag(moves[0] ?? 0);

  for (const clientX of moves.slice(1)) {
    const tick = updateScrubDrag(drag, clientX);
    drag = tick.state;
    if (tick.deltaX === null) continue;
    const next =
      value +
      tick.deltaX *
        getScrubStepFromEvent({ shiftKey: false, altKey: false }, step);
    value = normalizeScrubNumber(roundScrubDragValue(next, options.unit));
    lastScrubValue = value;
    onChange(value, { source: "scrub", phase: "preview" });
  }

  if (drag.hasDragged) {
    onChange(lastScrubValue, { source: "scrub", phase: "commit" });
  }

  return { calls, finalValue: value, hasDragged: drag.hasDragged };
}

describe("ScrubInput gesture lifecycle — phase", () => {
  it("emits phase:'preview' for every drag tick and exactly one phase:'commit' on release", () => {
    const { calls, finalValue } = simulateScrubGesture([0, 5, 10, 20, 35]);

    const commitCalls = calls.filter((c) => c.meta.phase === "commit");
    const previewCalls = calls.filter((c) => c.meta.phase === "preview");

    expect(previewCalls.length).toBeGreaterThan(0);
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]?.value).toBe(finalValue);
    expect(calls[calls.length - 1]?.meta.phase).toBe("commit");
  });

  it("does not emit a commit for a plain click with no real movement", () => {
    const { calls, hasDragged } = simulateScrubGesture([0, 1]);
    expect(hasDragged).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("emits exactly one commit per gesture across two independent drags", () => {
    const first = simulateScrubGesture([0, 10, 20]);
    const second = simulateScrubGesture([0, 10, 20]);

    expect(first.calls.filter((c) => c.meta.phase === "commit")).toHaveLength(
      1,
    );
    expect(second.calls.filter((c) => c.meta.phase === "commit")).toHaveLength(
      1,
    );
  });

  it("negative drag direction still produces exactly one final commit", () => {
    const { calls } = simulateScrubGesture([50, 40, 20, 0]);
    const commitCalls = calls.filter((c) => c.meta.phase === "commit");
    expect(commitCalls).toHaveLength(1);
    expect(calls[calls.length - 1]?.meta.phase).toBe("commit");
  });
});

describe("ScrubInput gesture lifecycle — px scrub snaps to whole numbers", () => {
  it("every preview tick and the final commit are integers for a px field", () => {
    const { calls } = simulateScrubGesture([0, 3, 7, 12, 20], {
      unit: "px",
      startValue: 10,
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Number.isInteger(call.value)).toBe(true);
    }
  });

  it("rounds a fine (alt-modified, sub-1px effective) drag to whole pixels", () => {
    const { calls } = simulateScrubGesture([0, 3, 4, 5, 6], {
      unit: "px",
      startValue: 0,
      step: 0.25,
    });
    for (const call of calls) {
      expect(Number.isInteger(call.value)).toBe(true);
    }
  });

  it("does not round a non-px (unitless, e.g. line-height) field", () => {
    const { calls } = simulateScrubGesture([0, 3, 7], {
      startValue: 1.4,
      step: 0.1,
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => !Number.isInteger(c.value))).toBe(true);
  });

  it("does not round a non-px unit field (deg)", () => {
    const { calls } = simulateScrubGesture([0, 3, 7], {
      unit: "deg",
      startValue: 0.15,
      step: 0.1,
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => !Number.isInteger(c.value))).toBe(true);
  });
});

describe("ScrubInput gesture lifecycle — discrete commits are always phase:'commit'", () => {
  it("keyboard source is always phase:'commit'", () => {
    const meta: ScrubInputChangeMeta = { source: "keyboard", phase: "commit" };
    expect(meta.phase).toBe("commit");
  });

  it("text commit (blur/Enter) source is always phase:'commit'", () => {
    const meta: ScrubInputChangeMeta = {
      source: "commit",
      expression: "42",
      phase: "commit",
    };
    expect(meta.phase).toBe("commit");
  });
});

describe("ScrubInput gesture — accumulates from its own last value, not the prop (B5-14)", () => {
  function simulateWithStaleProp(moves: number[], startValue: number) {
    const emitted: number[] = [];
    let drag: ScrubDragState = startScrubDrag(moves[0] ?? 0);
    let lastScrubValue = startValue;
    for (const clientX of moves.slice(1)) {
      const tick = updateScrubDrag(drag, clientX);
      drag = tick.state;
      if (tick.deltaX === null) continue;
      const next =
        lastScrubValue +
        tick.deltaX *
          getScrubStepFromEvent({ shiftKey: false, altKey: false }, 1);
      lastScrubValue = normalizeScrubNumber(roundScrubDragValue(next, "px"));
      emitted.push(lastScrubValue);
    }
    return { emitted, final: lastScrubValue };
  }

  it("a steady rightward drag produces a monotonic continuum reaching start + total delta", () => {
    const moves = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const { emitted, final } = simulateWithStaleProp(moves, 16);
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]).toBeGreaterThan(emitted[i - 1]);
    }
    expect(final).toBe(116);
  });

  it("the OLD prop-per-tick formula loses the drag under a stale prop (documents the bug)", () => {
    const moves = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const staleProp = 16;
    let drag: ScrubDragState = startScrubDrag(moves[0]);
    let last = staleProp;
    for (const clientX of moves.slice(1)) {
      const tick = updateScrubDrag(drag, clientX);
      drag = tick.state;
      if (tick.deltaX === null) continue;
      last = normalizeScrubNumber(
        roundScrubDragValue(staleProp + tick.deltaX * 1, "px"),
      );
    }
    expect(last).toBe(26);
  });

  it("re-seeding at pointerdown keeps gestures independent across an out-of-band prop change", () => {
    const first = simulateWithStaleProp([0, 10], 16);
    expect(first.final).toBe(26);
    const second = simulateWithStaleProp([0, 10], 30);
    expect(second.final).toBe(40);
  });
});

describe("ScrubInput — pending-commit resolution predicate (B5-14 Enter reset)", () => {
  function shouldResyncFromProp(
    pending: number | null,
    incomingValue: number,
    options: { unit?: string; precision?: number } = {},
  ): boolean {
    if (pending === null) return true;
    return normalizeScrubNumber(incomingValue, options) === pending;
  }

  it("holds the optimistic value while the prop is still stale", () => {
    expect(shouldResyncFromProp(24, 16, { unit: "px", precision: 1 })).toBe(
      false,
    );
  });

  it("resyncs once the host echoes the committed value back", () => {
    expect(shouldResyncFromProp(24, 24, { unit: "px", precision: 1 })).toBe(
      true,
    );
  });

  it("normalization differences (precision rounding) still count as confirmation", () => {
    expect(shouldResyncFromProp(24, 24.04, { precision: 1 })).toBe(true);
  });

  it("no pending commit means normal prop-driven resync", () => {
    expect(shouldResyncFromProp(null, 16)).toBe(true);
  });

  it("keeps holding only while the incoming prop is the exact pre-commit baseline", () => {
    expect(
      resolvePendingScrubCommit({ value: 24, baseline: 16 }, 16, {
        unit: "px",
        precision: 1,
      }),
    ).toBe("hold");
  });

  it("accepts a different authoritative host value instead of staying stuck forever", () => {
    expect(
      resolvePendingScrubCommit({ value: 24, baseline: 16 }, 20, {
        unit: "px",
        precision: 1,
      }),
    ).toBe("superseded");
  });

  it("recognizes a normalized echo as confirmation", () => {
    expect(
      resolvePendingScrubCommit({ value: 24, baseline: 16 }, 24.04, {
        precision: 1,
      }),
    ).toBe("confirmed");
  });
});

function simulateMixedArrowKey(
  key: "ArrowUp" | "ArrowDown",
  options: {
    step?: number;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
) {
  const step = options.step ?? 1;
  const event = {
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
  };
  const direction = key === "ArrowUp" ? 1 : -1;
  const baseStep = getScrubStepFromEvent(event, step);
  const cmdMultiplier = event.metaKey && !event.shiftKey ? 10 : 1;
  const delta = direction * baseStep * cmdMultiplier;

  let received: { value: number; meta: ScrubInputChangeMeta } | null = null;
  const onChange = (value: number, meta: ScrubInputChangeMeta) => {
    received = { value, meta };
  };
  onChange(delta, {
    source: "keyboard",
    phase: "commit",
    relativeDelta: delta,
  });
  return received as unknown as { value: number; meta: ScrubInputChangeMeta };
}

describe("ScrubInput gesture lifecycle — mixed-selection arrow-key relative delta", () => {
  it("emits a relative delta instead of no-op'ing on ArrowUp for a mixed value", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", { step: 1 });
    expect(value).toBe(1);
    expect(meta.relativeDelta).toBe(1);
    expect(meta.phase).toBe("commit");
    expect(meta.source).toBe("keyboard");
  });

  it("emits a negative relative delta on ArrowDown", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowDown", { step: 1 });
    expect(value).toBe(-1);
    expect(meta.relativeDelta).toBe(-1);
  });

  it("scales the delta ×10 with Shift, matching the non-mixed step convention", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", {
      step: 1,
      shiftKey: true,
    });
    expect(value).toBe(10);
    expect(meta.relativeDelta).toBe(10);
  });

  it("scales the delta ÷10 with Alt (fine step)", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", {
      step: 1,
      altKey: true,
    });
    expect(value).toBeCloseTo(0.1);
    expect(meta.relativeDelta).toBeCloseTo(0.1);
  });

  it("scales the delta ×10 with Cmd, mirroring Shift", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", {
      step: 1,
      metaKey: true,
    });
    expect(value).toBe(10);
    expect(meta.relativeDelta).toBe(10);
  });

  it("respects a custom step size", () => {
    const { value, meta } = simulateMixedArrowKey("ArrowUp", { step: 4 });
    expect(value).toBe(4);
    expect(meta.relativeDelta).toBe(4);
  });
});
