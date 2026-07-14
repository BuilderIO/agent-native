import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMkdir = vi.hoisted(() => vi.fn(async () => undefined));
const mockWriteFile = vi.hoisted(() => vi.fn(async () => undefined));
const mockIsHostedSlidesRuntime = vi.hoisted(() => vi.fn(() => false));
const mockStoreUploadedReferenceBlob = vi.hoisted(() => vi.fn());

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
    },
  },
}));

vi.mock("../lib/tenant-files.js", () => ({
  tenantUploadDir: () => "/tmp/slides-test-uploads",
}));

vi.mock("../lib/uploaded-reference-storage.js", () => ({
  isHostedSlidesRuntime: () => mockIsHostedSlidesRuntime(),
  storeUploadedReferenceBlob: (...args: unknown[]) =>
    mockStoreUploadedReferenceBlob(...args),
}));

vi.mock("./assets.js", () => ({
  canSaveAsUploadedAsset: () => false,
  uploadImageAsset: vi.fn(),
}));

import {
  MAX_FIG_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_FILE_BYTES,
  maxReferenceFileBytes,
  saveUploadedReferenceFile,
} from "./uploads";

describe("Slides reference upload limits", () => {
  beforeEach(() => {
    mockMkdir.mockClear();
    mockWriteFile.mockClear();
    mockIsHostedSlidesRuntime.mockReturnValue(false);
    mockStoreUploadedReferenceBlob.mockReset();
  });

  it("allows larger .fig files than ordinary references", () => {
    expect(maxReferenceFileBytes("brand.fig")).toBe(
      MAX_FIG_REFERENCE_FILE_BYTES,
    );
    expect(maxReferenceFileBytes("deck.pdf")).toBe(MAX_REFERENCE_FILE_BYTES);
    expect(maxReferenceFileBytes(undefined)).toBe(MAX_REFERENCE_FILE_BYTES);
  });

  it("accepts only zip or fig-kiwi .fig upload signatures", async () => {
    const figKiwi = Buffer.from([
      0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69, 0, 0, 0, 0,
    ]);
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

    await expect(
      saveUploadedReferenceFile({
        email: "owner@example.com",
        originalName: "brand.fig",
        data: figKiwi,
      }),
    ).resolves.toMatchObject({
      originalName: "brand.fig",
      type: "application/octet-stream",
      size: figKiwi.length,
    });
    await expect(
      saveUploadedReferenceFile({
        email: "owner@example.com",
        originalName: "zipped.fig",
        data: zip,
      }),
    ).resolves.toMatchObject({
      originalName: "zipped.fig",
      size: zip.length,
    });
    await expect(
      saveUploadedReferenceFile({
        email: "owner@example.com",
        originalName: "not-fig.fig",
        data: Buffer.from("not-a-fig"),
      }),
    ).rejects.toThrow("File contents do not match .fig upload type");

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  it("stores hosted reference uploads in durable private blob storage", async () => {
    mockIsHostedSlidesRuntime.mockReturnValue(true);
    mockStoreUploadedReferenceBlob.mockResolvedValue(
      "slides-upload:v1:scoped-handle",
    );
    const pptx = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

    await expect(
      saveUploadedReferenceFile({
        email: "owner@example.com",
        orgId: "org-1",
        originalName: "deck.pptx",
        data: pptx,
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    ).resolves.toMatchObject({
      path: "slides-upload:v1:scoped-handle",
      originalName: "deck.pptx",
    });

    expect(mockStoreUploadedReferenceBlob).toHaveBeenCalledWith({
      data: pptx,
      email: "owner@example.com",
      orgId: "org-1",
      filename: expect.stringMatching(/\.pptx$/),
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("fails closed when hosted private file storage is unavailable", async () => {
    mockIsHostedSlidesRuntime.mockReturnValue(true);
    mockStoreUploadedReferenceBlob.mockResolvedValue(null);

    await expect(
      saveUploadedReferenceFile({
        email: "owner@example.com",
        originalName: "deck.pptx",
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Private file storage is not configured",
      ),
      statusCode: 503,
    });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
