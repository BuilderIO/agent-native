import { describe, expect, it } from "vitest";

import { selectSourceDemand } from "./source-demand";

describe("source demand", () => {
  it("bounds a 7,185-screen fit-all view while retaining selected screens", () => {
    const frames = Array.from({ length: 7185 }, (_, i) => ({
      id: `screen-${i}`,
      width: 1440,
    }));
    const all = new Set(frames.map((frame) => frame.id));
    expect(
      selectSourceDemand(frames, all, new Set(["screen-7184"]), 0.01),
    ).toEqual(["screen-7184"]);
    const visible = selectSourceDemand(
      frames,
      all,
      new Set(["screen-7184"]),
      1,
    );
    expect(visible).toHaveLength(33);
    expect(visible).toContain("screen-7184");
    expect(visible).not.toContain("screen-100");
  });
});
