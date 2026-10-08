import { describe, expect, it, vi } from "vitest";

import {
  filterDuplicateAssetUploadsAcrossBatches,
  filterDuplicateAssetUploads,
  hashAssetBuffer,
  AssetDedupeSearchLimitError,
  type ExistingAssetForDuplicateCheck,
  type PreparedAssetUpload,
} from "./upload-dedupe.js";

function upload(
  filename: string,
  body: string,
  overrides: Partial<PreparedAssetUpload> = {},
): PreparedAssetUpload {
  const buffer = Buffer.from(body);
  return {
    altText: filename,
    buffer,
    contentHash: hashAssetBuffer(buffer),
    filename,
    mediaType: "image",
    metadata: { contentHash: hashAssetBuffer(buffer), originalName: filename },
    mimeType: "image/png",
    title: filename,
    ...overrides,
  };
}

function existing(
  id: string,
  body: string,
  overrides: Partial<ExistingAssetForDuplicateCheck> = {},
): ExistingAssetForDuplicateCheck {
  const buffer = Buffer.from(body);
  return {
    id,
    title: "Existing reference",
    mediaType: "image",
    mimeType: "image/png",
    sizeBytes: buffer.byteLength,
    metadata: JSON.stringify({ contentHash: hashAssetBuffer(buffer) }),
    objectKey: `local:${id}.png`,
    ...overrides,
  };
}

describe("filterDuplicateAssetUploads", () => {
  it("skips repeated files in the same upload batch", async () => {
    const first = upload("comparison.png", "same image bytes");
    const second = upload("comparison-copy.png", "same image bytes");

    const result = await filterDuplicateAssetUploads({
      files: [first, second],
      existingAssets: [],
    });

    expect(result.files).toEqual([first]);
    expect(result.skippedDuplicates).toEqual([
      { filename: "comparison-copy.png", reason: "same-upload" },
    ]);
  });

  it("skips files that match an existing content hash", async () => {
    const file = upload("comparison.png", "same image bytes");
    const readExistingAssetBuffer = vi.fn();

    const result = await filterDuplicateAssetUploads({
      files: [file],
      existingAssets: [existing("asset-1", "same image bytes")],
      readExistingAssetBuffer,
    });

    expect(result.files).toEqual([]);
    expect(result.skippedDuplicates).toEqual([
      {
        filename: "comparison.png",
        reason: "existing-asset",
        assetId: "asset-1",
        title: "Existing reference",
      },
    ]);
    expect(readExistingAssetBuffer).not.toHaveBeenCalled();
  });

  it("does not treat a nested contentHash as an asset content hash", async () => {
    const file = upload("comparison.png", "same image bytes");
    const nestedHash = existing("nested-hash", "unrelated bytes", {
      metadata: JSON.stringify({ extra: { contentHash: file.contentHash } }),
      sizeBytes: file.buffer.byteLength + 1,
    });
    const readExistingAssetBuffer = vi.fn();

    const result = await filterDuplicateAssetUploads({
      files: [file],
      existingAssets: [nestedHash],
      readExistingAssetBuffer,
    });

    expect(result.files).toEqual([file]);
    expect(result.skippedDuplicates).toEqual([]);
    expect(readExistingAssetBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", { contentHash: "" }],
    ["numeric", { contentHash: 123 }],
    ["boolean", { contentHash: true }],
  ])(
    "treats a %s contentHash as a hashless legacy value",
    async (_label, metadata) => {
      const file = upload("comparison.png", "same image bytes");
      const legacy = existing("legacy-asset", file.buffer.toString(), {
        metadata: JSON.stringify(metadata),
      });
      const readExistingAssetBuffer = vi.fn(async () => file.buffer);

      const result = await filterDuplicateAssetUploads({
        files: [file],
        existingAssets: [legacy],
        readExistingAssetBuffer,
      });

      expect(result.files).toEqual([]);
      expect(result.skippedDuplicates[0]).toMatchObject({
        reason: "existing-asset",
        assetId: "legacy-asset",
      });
      expect(readExistingAssetBuffer).toHaveBeenCalledOnce();
    },
  );

  it("hashes legacy assets without metadata hashes before skipping them", async () => {
    const file = upload("comparison.png", "same image bytes");
    const legacy = existing("legacy-asset", "same image bytes", {
      metadata: "{}",
    });

    const result = await filterDuplicateAssetUploads({
      files: [file],
      existingAssets: [legacy],
      readExistingAssetBuffer: vi.fn(async () =>
        Buffer.from("same image bytes"),
      ),
    });

    expect(result.files).toEqual([]);
    expect(result.skippedDuplicates[0]).toMatchObject({
      filename: "comparison.png",
      reason: "existing-asset",
      assetId: "legacy-asset",
    });
  });

  it("keeps same-size legacy assets when the bytes differ", async () => {
    const file = upload("comparison.png", "image bytes A");
    const legacy = existing("legacy-asset", "image bytes B", {
      metadata: "{}",
    });

    const result = await filterDuplicateAssetUploads({
      files: [file],
      existingAssets: [legacy],
      readExistingAssetBuffer: vi.fn(async () => Buffer.from("image bytes B")),
    });

    expect(result.files).toEqual([file]);
    expect(result.skippedDuplicates).toEqual([]);
  });

  it("finds a matching hashless legacy asset after the first 100 candidates", async () => {
    const file = upload("comparison.png", "the same legacy image bytes");
    const earlierAssets = Array.from({ length: 100 }, (_, index) =>
      existing(
        `legacy-${String(index).padStart(3, "0")}`,
        file.buffer.toString(),
        {
          metadata: "{}",
        },
      ),
    );
    const laterAsset = existing("legacy-100", file.buffer.toString(), {
      metadata: "{}",
    });
    const readExistingAssetBuffer = vi.fn(async (asset) =>
      asset.id === laterAsset.id
        ? file.buffer
        : Buffer.from(`X${file.buffer.toString().slice(1)}`),
    );
    const allCandidates = [...earlierAssets, laterAsset];
    const cursors: Array<string | null> = [];

    const result = await filterDuplicateAssetUploadsAcrossBatches({
      files: [file],
      existingAssets: [],
      readExistingAssetHashes: async () => [],
      readExistingAssetBatch: async (afterId, _files, limit) => {
        cursors.push(afterId);
        const nextIndex = afterId
          ? allCandidates.findIndex((asset) => asset.id > afterId)
          : 0;
        return allCandidates.slice(nextIndex, nextIndex + limit);
      },
      readExistingAssetBuffer,
    });

    expect(result.files).toEqual([]);
    expect(result.skippedDuplicates).toEqual([
      {
        filename: "comparison.png",
        reason: "existing-asset",
        assetId: "legacy-100",
        title: "Existing reference",
      },
    ]);
    expect(cursors).toEqual([null, "legacy-099"]);
    expect(readExistingAssetBuffer).toHaveBeenCalledTimes(101);
  });

  it("checks exact hashes before the bounded legacy candidate scan", async () => {
    const file = upload("comparison.png", "the exact hash match");
    const exactMatch = existing("exact-match", file.buffer.toString());
    const readExistingAssetHashes = vi.fn(async () => [exactMatch]);
    const readExistingAssetBatch = vi.fn(async () => []);
    const readExistingAssetBuffer = vi.fn();

    const result = await filterDuplicateAssetUploadsAcrossBatches({
      files: [file],
      existingAssets: [],
      readExistingAssetHashes,
      readExistingAssetBatch,
      readExistingAssetBuffer,
    });

    expect(result.files).toEqual([]);
    expect(result.skippedDuplicates[0]).toMatchObject({
      reason: "existing-asset",
      assetId: "exact-match",
    });
    expect(readExistingAssetHashes).toHaveBeenCalledWith([file]);
    expect(readExistingAssetBatch).not.toHaveBeenCalled();
    expect(readExistingAssetBuffer).not.toHaveBeenCalled();
  });

  it("fails closed after the candidate and page ceilings", async () => {
    const file = upload("comparison.png", "candidate scan bytes");
    const differentBytes = Buffer.alloc(file.buffer.byteLength, 0x58);
    const candidates = Array.from({ length: 4 }, (_, index) =>
      existing(`legacy-${index}`, differentBytes.toString(), {
        metadata: "{}",
      }),
    );
    const queryLimits: number[] = [];
    const readExistingAssetBuffer = vi.fn(async () => differentBytes);
    const readExistingAssetBatch = vi.fn(
      async (
        afterId: string | null,
        _files: PreparedAssetUpload[],
        limit: number,
      ) => {
        queryLimits.push(limit);
        const nextIndex = afterId
          ? candidates.findIndex((asset) => asset.id > afterId)
          : 0;
        return candidates.slice(nextIndex, nextIndex + limit);
      },
    );

    await expect(
      filterDuplicateAssetUploadsAcrossBatches({
        files: [file],
        existingAssets: [],
        readExistingAssetHashes: async () => [],
        readExistingAssetBatch,
        readExistingAssetBuffer,
        maxCandidates: 3,
        maxPages: 2,
        batchSize: 2,
        maxCandidateBytes: 10_000,
      }),
    ).rejects.toBeInstanceOf(AssetDedupeSearchLimitError);

    expect(queryLimits).toEqual([2, 1, 1]);
    expect(readExistingAssetBatch).toHaveBeenCalledTimes(3);
    expect(readExistingAssetBuffer).toHaveBeenCalledTimes(3);
  });

  it("stops legacy object reads at the total byte ceiling", async () => {
    const file = upload("comparison.png", "bounded bytes");
    const differentBytes = Buffer.alloc(file.buffer.byteLength, 0x58);
    const candidates = Array.from({ length: 5 }, (_, index) =>
      existing(`legacy-${index}`, differentBytes.toString(), {
        metadata: "{}",
      }),
    );
    const queryLimits: number[] = [];
    let bytesRead = 0;
    const readExistingAssetBuffer = vi.fn(async () => {
      bytesRead += differentBytes.byteLength;
      return differentBytes;
    });
    const readExistingAssetBatch = vi.fn(
      async (
        afterId: string | null,
        _files: PreparedAssetUpload[],
        limit: number,
      ) => {
        queryLimits.push(limit);
        const nextIndex = afterId
          ? candidates.findIndex((asset) => asset.id > afterId)
          : 0;
        return candidates.slice(nextIndex, nextIndex + limit);
      },
    );

    await expect(
      filterDuplicateAssetUploadsAcrossBatches({
        files: [file],
        existingAssets: [],
        readExistingAssetHashes: async () => [],
        readExistingAssetBatch,
        readExistingAssetBuffer,
        maxCandidates: 10,
        maxPages: 5,
        batchSize: 2,
        maxCandidateBytes: differentBytes.byteLength * 2,
      }),
    ).rejects.toBeInstanceOf(AssetDedupeSearchLimitError);

    expect(queryLimits).toEqual([2, 2]);
    expect(readExistingAssetBatch).toHaveBeenCalledTimes(2);
    expect(readExistingAssetBuffer).toHaveBeenCalledTimes(2);
    expect(bytesRead).toBe(differentBytes.byteLength * 2);
  });
});
