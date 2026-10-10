import { describe, expect, it } from "vitest";

import { NativeFrameResourceScratch } from "./native-frame-resource-scratch";

describe("private validated-frame resources", () => {
  it("keeps the source and restores committed intermediates on rejection", () => {
    const source = { bytes: [1] };
    const blur = { bytes: [2] };
    const output = { bytes: [3] };
    const committed = new Map([
      ["source", source],
      ["blur", blur],
      ["output", output],
    ]);
    const frame = new NativeFrameResourceScratch(committed, ["source"]);
    expect(frame.scratch).toEqual(new Map([["source", source]]));
    const nextBlur = { bytes: [4] };
    frame.scratch.set("blur", nextBlur);
    expect(frame.rollback()).toEqual([nextBlur]);
    expect(committed).toEqual(
      new Map([
        ["source", source],
        ["blur", blur],
        ["output", output],
      ]),
    );
    expect(blur.bytes).toEqual([2]);
    expect(() => frame.commit()).toThrow("frame-resources-already-settled");
  });

  it("retires only old committed intermediates after successful publication", () => {
    const source = { id: 1 };
    const oldBlur = { id: 2 };
    const oldOutput = { id: 3 };
    const committed = new Map([
      ["source", source],
      ["blur", oldBlur],
      ["output", oldOutput],
    ]);
    const frame = new NativeFrameResourceScratch(committed, ["source"]);
    frame.scratch.set("blur", { id: 4 });
    frame.scratch.set("output", { id: 5 });
    expect(frame.retiredOnCommit()).toEqual([oldBlur, oldOutput]);
    frame.commit();
    expect(() => frame.rollback()).toThrow("frame-resources-already-settled");
  });
});
