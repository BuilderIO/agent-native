// @vitest-environment node

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { encodeStraightRgbaPng } from "./native-png-encoding";

describe("native PNG encoding", () => {
  it("encodes a complete RGBA frame returned from another realm", async () => {
    const rgba = runInNewContext(
      "new Uint8Array([255, 0, 0, 255])",
    ) as Uint8Array;
    expect(rgba instanceof Uint8Array).toBe(false);

    const png = await encodeStraightRgbaPng(
      { width: 1, height: 1, rgba },
      new AbortController().signal,
    );

    expect(png.type).toBe("image/png");
    expect([...new Uint8Array(await png.arrayBuffer()).subarray(0, 8)]).toEqual(
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  });

  it("rejects other byte views and incomplete frames", async () => {
    const signal = new AbortController().signal;
    for (const rgba of [
      runInNewContext("new Int8Array(4)"),
      runInNewContext("new Uint8ClampedArray(4)"),
      runInNewContext("new DataView(new ArrayBuffer(4))"),
      runInNewContext("new Uint8Array(3)"),
    ]) {
      await expect(
        encodeStraightRgbaPng({ width: 1, height: 1, rgba }, signal),
      ).rejects.toMatchObject({ code: "invalid-pixels" });
    }
  });
});
