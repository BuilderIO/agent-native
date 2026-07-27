import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMkdir = vi.hoisted(() => vi.fn(async () => undefined));
const mockWriteFile = vi.hoisted(() => vi.fn(async () => undefined));
const mockIsHostedSlidesRuntime = vi.hoisted(() => vi.fn(() => false));
const mockStoreUploadedReferenceBlob = vi.hoisted(() => vi.fn());
const mockReadMultipartFormData = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockResolveSlidesRequestAuthContext = vi.hoisted(() => vi.fn());
const mockWithSlidesRequestContext = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readMultipartFormData: (...args: unknown[]) =>
    mockReadMultipartFormData(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

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

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuthContext: (...args: unknown[]) =>
    mockResolveSlidesRequestAuthContext(...args),
  withSlidesRequestContext: (...args: unknown[]) =>
    mockWithSlidesRequestContext(...args),
}));

import {
  MAX_FIG_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_FILE_BYTES,
  maxReferenceFileBytes,
  saveUploadedReferenceFile,
  uploadFiles,
} from "./uploads";

describe("Slides reference upload limits", () => {
  beforeEach(() => {
    mockMkdir.mockClear();
    mockWriteFile.mockClear();
    mockIsHostedSlidesRuntime.mockReturnValue(false);
    mockStoreUploadedReferenceBlob.mockReset();
    mockReadMultipartFormData.mockReset();
    mockSetResponseStatus.mockReset();
    mockResolveSlidesRequestAuthContext.mockResolvedValue({
      email: "owner@example.com",
      orgId: "active-org",
    });
    mockWithSlidesRequestContext.mockImplementation(
      async (
        _event: unknown,
        callback: (context: { email?: string; orgId?: string }) => unknown,
        context: { email?: string; orgId?: string },
      ) => callback(context),
    );
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

  it("uses the live active organization when the upload route saves files", async () => {
    mockIsHostedSlidesRuntime.mockReturnValue(true);
    mockStoreUploadedReferenceBlob.mockResolvedValue(
      "slides-upload:v1:scoped-handle",
    );
    const pptx = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    mockReadMultipartFormData.mockResolvedValue([
      {
        name: "files",
        filename: "deck.pptx",
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        data: pptx,
      },
    ]);
    const event = {} as any;

    await expect(uploadFiles(event)).resolves.toEqual([
      expect.objectContaining({ path: "slides-upload:v1:scoped-handle" }),
    ]);

    expect(mockResolveSlidesRequestAuthContext).toHaveBeenCalledWith(event);
    expect(mockWithSlidesRequestContext).toHaveBeenCalledWith(
      event,
      expect.any(Function),
      { email: "owner@example.com", orgId: "active-org" },
    );
    expect(mockStoreUploadedReferenceBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner@example.com",
        orgId: "active-org",
      }),
    );
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

  it("reports hosted private storage failures as service errors", async () => {
    mockIsHostedSlidesRuntime.mockReturnValue(true);
    mockStoreUploadedReferenceBlob.mockRejectedValue(
      new Error("provider unavailable"),
    );

    await expect(
      saveUploadedReferenceFile({
        email: "owner@example.com",
        originalName: "deck.pptx",
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      }),
    ).rejects.toMatchObject({
      message: "Private file storage failed while saving the upload.",
      statusCode: 503,
    });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
