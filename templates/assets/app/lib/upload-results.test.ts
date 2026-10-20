import { describe, expect, it } from "vitest";

import { MAX_ASSET_UPLOAD_BATCH_BYTES } from "../../shared/api";
import { chunkAssetUploads } from "./upload-results";

describe("chunkAssetUploads", () => {
  it("bounds upload batches by both file count and bytes", () => {
    const files = Array.from({ length: 23 }, (_, index) => ({
      name: `${index}.png`,
      size: index < 3 ? 2 * 1024 * 1024 : 1,
    }));

    expect(chunkAssetUploads(files).map((chunk) => chunk.length)).toEqual([
      1, 1, 20, 1,
    ]);
  });

  it("reserves multipart overhead below the hosted body limit", () => {
    expect(MAX_ASSET_UPLOAD_BATCH_BYTES).toBeLessThan(4 * 1024 * 1024);
  });
});
