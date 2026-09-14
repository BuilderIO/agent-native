import { describe, expect, it } from "vitest";

import { chunkAssetUploads } from "./upload-results";

describe("chunkAssetUploads", () => {
  it("bounds upload batches by both file count and bytes", () => {
    const files = Array.from({ length: 23 }, (_, index) => ({
      name: `${index}.png`,
      size: index < 3 ? 2 * 1024 * 1024 : 1,
    }));

    expect(chunkAssetUploads(files).map((chunk) => chunk.length)).toEqual([
      2, 20, 1,
    ]);
  });
});
