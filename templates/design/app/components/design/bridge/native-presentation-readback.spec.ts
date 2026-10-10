import { describe, expect, it } from "vitest";

import {
  compactNativePresentationReadback,
  NativePublishedPresentationMirror,
  planNativePresentationReadback,
} from "./native-presentation-readback";

describe("reviewed GPU presentation mirror", () => {
  it("commits a candidate only after validation, discards failed frames, and retires once", () => {
    const retired: string[] = [];
    const mirror = new NativePublishedPresentationMirror<{
      id: string;
      pixels: Uint8Array;
    }>((resource) => retired.push(resource.id));
    const first = {
      id: "published",
      pixels: new Uint8Array([11, 12, 13, 255]),
    };
    mirror.stage(first);
    expect(mirror.current()).toBeNull();
    mirror.commit();
    const rejected = {
      id: "rejected",
      pixels: new Uint8Array([70, 80, 90, 255]),
    };
    mirror.stage(rejected);
    rejected.pixels[0] = 99;
    mirror.discard();
    expect(mirror.current()?.pixels).toEqual(first.pixels);
    expect(retired).toEqual(["rejected"]);
    mirror.stage({ id: "next", pixels: new Uint8Array([21, 22, 23, 255]) });
    mirror.commit();
    expect(retired).toEqual(["rejected", "published"]);
    mirror.clear();
    expect(retired).toEqual(["rejected", "published", "next"]);
  });
  it("plans bounded physical pixels and strips BGRA row padding before hashing", () => {
    const actual = planNativePresentationReadback({
      width: 513,
      height: 385,
      format: "bgra8unorm",
      colorSpace: "srgb",
      dynamicRange: "sdr",
    });
    expect(actual).toMatchObject({
      bytesPerRow: 2304,
      bufferBytes: 887040,
      compactBytes: 790020,
    });
    const plan = planNativePresentationReadback({
      width: 2,
      height: 2,
      format: "bgra8unorm",
      colorSpace: "srgb",
      dynamicRange: "sdr",
    });
    const bytes = new Uint8Array(plan.bufferBytes);
    bytes.set([3, 2, 1, 255, 6, 5, 4, 0], 0);
    bytes.set([9, 8, 7, 128, 12, 11, 10, 255], plan.bytesPerRow);
    bytes[plan.bytesPerRow - 1] = 255;
    expect(compactNativePresentationReadback(bytes, plan)).toEqual({
      rgba: new Uint8Array([
        1, 2, 3, 255, 4, 5, 6, 0, 7, 8, 9, 128, 10, 11, 12, 255,
      ]),
      nonTransparentPixels: 3,
    });
    expect(() =>
      compactNativePresentationReadback(bytes.subarray(1), plan),
    ).toThrow("presentation-fault-readback-incomplete");
    for (const change of [
      { width: 0 },
      { height: NaN },
      { width: 2049 },
      { width: 1025, height: 1025 },
      { format: "rgba16float" },
      { colorSpace: "display-p3" },
    ])
      expect(() =>
        planNativePresentationReadback({
          width: 513,
          height: 385,
          format: "bgra8unorm",
          colorSpace: "srgb",
          dynamicRange: "sdr",
          ...change,
        }),
      ).toThrow();
  });
});
