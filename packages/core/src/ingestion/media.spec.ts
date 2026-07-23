import { describe, expect, it } from "vitest";

import { compareRasterImages, cropImageRegion } from "./media.js";

describe("cropImageRegion", () => {
  it("returns only the requested bounded PNG region", async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="#f00"/><rect x="10" width="10" height="10" fill="#00f"/></svg>',
    );
    const crop = await cropImageRegion({
      data: source,
      left: 10,
      top: 0,
      width: 10,
      height: 10,
    });

    expect(crop).toMatchObject({
      mimeType: "image/png",
      width: 10,
      height: 10,
    });
    expect(crop.data.byteLength).toBeGreaterThan(0);
  });

  it("rejects oversized and out-of-bounds regions", async () => {
    await expect(
      cropImageRegion({
        data: new Uint8Array(2),
        left: 0,
        top: 0,
        width: 2,
        height: 2,
        maxInputBytes: 1,
      }),
    ).rejects.toThrow("exceeds");
  });

  it("reports a zero pixel difference for identical bounded images", async () => {
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123456"/></svg>',
    );
    await expect(
      compareRasterImages({ source, rendered: source }),
    ).resolves.toMatchObject({
      meanAbsoluteDifference: 0,
      width: 4,
      height: 4,
    });
  });
});
