import { describe, expect, it } from "vitest";

import { coalesceMarqueeSelectionHistory } from "./layer-marquee-selection-change";

describe("coalesceMarqueeSelectionHistory", () => {
  it("records nothing on intermediate ticks and exactly one {before, after} entry on the final tick", () => {
    // Mirrors a real marquee: mousedown selects nothing (0), then three
    // mousemove ticks grow the hit-set as the rect crosses A, then A+B,
    // before the mouseup (final) tick settles on the actual drop selection.
    const pendingBefore: { current: string[] | null } = { current: null };
    const ticks: Array<{ before: string[]; after: string[]; final: boolean }> =
      [
        { before: [], after: [], final: false },
        { before: [], after: ["a"], final: false },
        { before: ["a"], after: ["a", "b"], final: false },
        { before: ["a", "b"], after: ["a", "b"], final: true },
      ];
    const recorded = ticks.map((tick) =>
      coalesceMarqueeSelectionHistory(
        pendingBefore,
        tick.final,
        tick.before,
        tick.after,
      ),
    );
    // The bug this coalescer fixes: without it, every one of the 4 ticks
    // above would push its own history entry (4 undo steps for one drag).
    expect(recorded.filter(Boolean)).toHaveLength(1);
    expect(recorded[3]).toEqual({ before: [], after: ["a", "b"] });
    // pendingBefore resets so the NEXT gesture starts fresh.
    expect(pendingBefore.current).toBeNull();
  });

  it("captures the gesture's start selection even when the first reported tick already changed it", () => {
    const pendingBefore: { current: string[] | null } = { current: null };
    coalesceMarqueeSelectionHistory(pendingBefore, false, ["x"], ["a"]);
    const entry = coalesceMarqueeSelectionHistory(
      pendingBefore,
      true,
      ["a"],
      ["a", "b"],
    );
    // "before" is the FIRST tick's before-snapshot ("x"), not the last
    // intermediate tick's — a gesture undoes back to what was selected
    // before the drag started, not to its own most recent tick.
    expect(entry).toEqual({ before: ["x"], after: ["a", "b"] });
  });

  it("a click with no drag (a single final tick, no intermediate ticks) still records one entry", () => {
    const pendingBefore: { current: string[] | null } = { current: null };
    const entry = coalesceMarqueeSelectionHistory(
      pendingBefore,
      true,
      ["a"],
      [],
    );
    expect(entry).toEqual({ before: ["a"], after: [] });
  });
});
