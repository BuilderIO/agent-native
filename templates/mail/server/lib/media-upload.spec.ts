import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.hoisted(() => vi.fn());
const uploadStore = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({ uploadFile }));
vi.mock("./upload-store.js", () => ({
  getStoredUpload: uploadStore.get,
  putStoredUpload: uploadStore.put,
}));

describe("storeMediaUpload", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("persists provider metadata and verifies it before returning a handle", async () => {
    uploadFile.mockResolvedValue({
      url: "https://files.example.com/report.pdf",
      provider: "test-provider",
    });
    uploadStore.get.mockResolvedValue({
      filename: "upload-1.pdf",
      url: "https://files.example.com/report.pdf",
    });
    const { storeMediaUpload } = await import("./media-upload.js");

    const result = await storeMediaUpload({
      ownerEmail: "owner@example.com",
      data: new Uint8Array([1, 2, 3]),
      filename: "upload-1.pdf",
      originalName: "report.pdf",
    });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        filename: "report.pdf",
        mimeType: "application/pdf",
        recordAsset: false,
      }),
    );
    expect(uploadStore.put).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        filename: "upload-1.pdf",
        url: "https://files.example.com/report.pdf",
      }),
    );
    expect(result).toMatchObject({
      filename: "upload-1.pdf",
      url: "https://files.example.com/report.pdf",
      provider: "test-provider",
    });
  });

  it("fails closed in production when durable file storage is unavailable", async () => {
    uploadFile.mockResolvedValue(null);
    const { MediaStorageSetupError, storeMediaUpload } =
      await import("./media-upload.js");

    await expect(
      storeMediaUpload({
        ownerEmail: "owner@example.com",
        data: new Uint8Array([1]),
        filename: "upload-1.txt",
        originalName: "note.txt",
      }),
    ).rejects.toBeInstanceOf(MediaStorageSetupError);
  });
});
