import { describe, expect, it, vi } from "vitest";

import {
  filterDuplicateAssetUploads,
  hashAssetBuffer,
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
});
