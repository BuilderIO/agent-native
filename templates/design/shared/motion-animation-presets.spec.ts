import { describe, expect, it } from "vitest";

import { FIGMA_MOTION_BUILT_IN_PRESETS } from "./motion-animation-presets";

describe("FIGMA_MOTION_BUILT_IN_PRESETS", () => {
  it("records the 36 verified names, categories, and speed labels", () => {
    expect(
      FIGMA_MOTION_BUILT_IN_PRESETS.map(({ category, name, speed }) => [
        category,
        name,
        speed,
      ]),
    ).toEqual([
      ["Enter", "Burst", "Fast"],
      ["Enter", "Ignite", "Fast"],
      ["Enter", "Sweep", "Fast"],
      ["Enter", "Slam", "Fast"],
      ["Enter", "Descend", "Medium"],
      ["Enter", "Magnify", "Medium"],
      ["Enter", "Glide", "Medium"],
      ["Enter", "Drop", "Medium"],
      ["Enter", "Reveal", "Slow"],
      ["Enter", "Rise", "Slow"],
      ["Enter", "Tip", "Slow"],
      ["Enter", "Feather", "Slow"],
      ["Cycle", "Crank", "Fast"],
      ["Cycle", "Press", "Fast"],
      ["Cycle", "Pop", "Fast"],
      ["Cycle", "Scoot", "Fast"],
      ["Cycle", "Spin", "Medium"],
      ["Cycle", "Flip", "Medium"],
      ["Cycle", "Tick", "Medium"],
      ["Cycle", "Creep", "Medium"],
      ["Cycle", "Float", "Slow"],
      ["Cycle", "Orbit", "Slow"],
      ["Cycle", "Breathe", "Slow"],
      ["Cycle", "Pulse", "Slow"],
      ["Exit", "Launch", "Fast"],
      ["Exit", "Vanish", "Fast"],
      ["Exit", "Flick", "Fast"],
      ["Exit", "Swipe", "Fast"],
      ["Exit", "Poof", "Medium"],
      ["Exit", "Deflate", "Medium"],
      ["Exit", "Fling", "Medium"],
      ["Exit", "Splat", "Medium"],
      ["Exit", "Evaporate", "Slow"],
      ["Exit", "Recede", "Slow"],
      ["Exit", "Sink", "Slow"],
      ["Exit", "Tumble", "Slow"],
    ]);
  });

  it("has 12 presets in each category", () => {
    const counts = { Enter: 0, Cycle: 0, Exit: 0 };
    for (const preset of FIGMA_MOTION_BUILT_IN_PRESETS) {
      counts[preset.category] += 1;
    }
    expect(counts).toEqual({ Enter: 12, Cycle: 12, Exit: 12 });
  });

  it("labels four presets at each speed in every category", () => {
    for (const category of ["Enter", "Cycle", "Exit"] as const) {
      const categoryPresets = FIGMA_MOTION_BUILT_IN_PRESETS.filter(
        (preset) => preset.category === category,
      );

      expect(
        Object.fromEntries(
          ["Fast", "Medium", "Slow"].map((speed) => [
            speed,
            categoryPresets.filter((preset) => preset.speed === speed).length,
          ]),
        ),
      ).toEqual({ Fast: 4, Medium: 4, Slow: 4 });
    }
  });
});
