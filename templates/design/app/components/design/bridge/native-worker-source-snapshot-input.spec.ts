import { describe, expect, it, vi } from "vitest";

import { NativeWorkerSourceSnapshot } from "./native-worker-source-snapshot";

describe("native worker input asset snapshots", () => {
  it("keeps named input revisions required while transferring the bitmap once", async () => {
    const first = new NativeWorkerSourceSnapshot("scene", 1, new Map());
    const bitmap = { width: 2, height: 2, close: vi.fn() };
    const decode = vi.fn(async () => bitmap as unknown as ImageBitmap);

    expect(
      await first.inputBitmap("input:noise", 1, decode, "linear-data"),
    ).toBe("input:noise");
    const uploaded = first.finish();
    expect(uploaded.requiredAssets).toEqual([
      { assetId: "input:noise", revision: 1 },
    ]);
    expect(uploaded.assets).toEqual([
      expect.objectContaining({
        kind: "bitmap",
        assetId: "input:noise",
        revision: 1,
        sampleEncoding: "linear-data",
      }),
    ]);

    const next = new NativeWorkerSourceSnapshot("scene", 2, uploaded.revisions);
    await next.inputBitmap("input:noise", 1, decode, "linear-data");
    expect(next.finish().requiredAssets).toEqual([
      { assetId: "input:noise", revision: 1 },
    ]);
    expect(next.finish().assets).toEqual([]);
    expect(decode).toHaveBeenCalledTimes(1);
    first.dispose();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
