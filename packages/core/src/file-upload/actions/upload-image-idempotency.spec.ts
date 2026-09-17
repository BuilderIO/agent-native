import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateCompareAndSet: vi.fn(),
  appStateListByKeyPrefix: vi.fn(),
  compareAndSetAppState: vi.fn(),
  deleteUploadedFile: vi.fn(),
  readAppState: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("../../application-state/index.js", () => ({
  compareAndSetAppState: mocks.compareAndSetAppState,
  readAppState: mocks.readAppState,
}));
vi.mock("../../application-state/store.js", () => ({
  appStateCompareAndSet: mocks.appStateCompareAndSet,
  appStateListByKeyPrefix: mocks.appStateListByKeyPrefix,
}));
vi.mock("../registry.js", () => ({
  deleteUploadedFile: mocks.deleteUploadedFile,
  uploadFile: mocks.uploadFile,
}));

import action, {
  commitUploadReceiptsForImport,
  runUploadReceiptCleanupOnce,
} from "./upload-image.js";

const uploadArgs = {
  data: "data:image/png;base64,AQ==",
  filename: "figma-image.png",
  idempotencyKey: "fig-import:image-1",
};

describe("upload-image idempotency receipts", () => {
  beforeEach(() => {
    mocks.appStateCompareAndSet.mockReset().mockResolvedValue(true);
    mocks.appStateListByKeyPrefix.mockReset().mockResolvedValue([]);
    mocks.compareAndSetAppState.mockReset().mockResolvedValue(true);
    mocks.deleteUploadedFile.mockReset();
    mocks.readAppState.mockReset().mockResolvedValue(null);
    mocks.uploadFile.mockReset().mockResolvedValue({
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
  });

  it("replays a stored provider result instead of uploading twice", async () => {
    const first = await action.run(uploadArgs);

    expect(first).toMatchObject({
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(mocks.compareAndSetAppState).toHaveBeenCalledTimes(2);
    expect(mocks.compareAndSetAppState).toHaveBeenLastCalledWith(
      "file-upload-receipt:fig-import:image-1",
      expect.objectContaining({ status: "pending" }),
      expect.objectContaining({
        id: "asset-1",
        provider: "builder",
        status: "staged",
        url: "https://cdn.builder.io/asset-1.png",
      }),
    );

    mocks.readAppState.mockResolvedValue({
      filename: "figma-image.png",
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    await action.run(uploadArgs);

    expect(mocks.uploadFile).toHaveBeenCalledOnce();
  });

  it("deletes the provider object before releasing its receipt", async () => {
    mocks.readAppState.mockResolvedValue({
      filename: "figma-image.png",
      id: "asset-1",
      provider: "builder",
      url: "https://cdn.builder.io/asset-1.png",
    });
    mocks.deleteUploadedFile.mockResolvedValue(true);

    await expect(
      action.run({
        cleanup: "delete",
        idempotencyKey: "fig-import:image-1",
      }),
    ).resolves.toMatchObject({ deleted: true });

    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "asset-1",
      url: "https://cdn.builder.io/asset-1.png",
    });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledTimes(2);
    expect(mocks.compareAndSetAppState).toHaveBeenLastCalledWith(
      "file-upload-receipt:fig-import:image-1",
      expect.objectContaining({ status: "deleting" }),
      null,
    );
  });

  it("retries the atomic reservation instead of racing a provider upload", async () => {
    mocks.compareAndSetAppState
      .mockReset()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(true);

    await expect(action.run(uploadArgs)).resolves.toMatchObject({
      id: "asset-1",
    });

    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(mocks.compareAndSetAppState).toHaveBeenCalledTimes(3);
  });

  it("deletes an unrecorded provider object when receipt staging loses a race", async () => {
    mocks.compareAndSetAppState
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mocks.readAppState
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.deleteUploadedFile.mockResolvedValue(true);

    await expect(action.run(uploadArgs)).rejects.toThrow(
      "Could not record the image upload receipt.",
    );

    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "asset-1",
      url: "https://cdn.builder.io/asset-1.png",
    });
  });

  it("surfaces provider cleanup failure after receipt staging loses a race", async () => {
    mocks.compareAndSetAppState
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mocks.readAppState
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.deleteUploadedFile.mockResolvedValue(false);

    await expect(action.run(uploadArgs)).rejects.toThrow(
      "Image upload cleanup failed",
    );
  });

  it("marks a receipt committed instead of deleting it during release", async () => {
    mocks.readAppState.mockResolvedValue({
      filename: "figma-image.png",
      id: "asset-1",
      provider: "builder",
      status: "staged",
      url: "https://cdn.builder.io/asset-1.png",
    });

    await expect(
      action.run({
        cleanup: "release",
        idempotencyKey: "fig-import:image-1",
      }),
    ).resolves.toMatchObject({ released: true });

    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "file-upload-receipt:fig-import:image-1",
      expect.objectContaining({ status: "staged" }),
      expect.objectContaining({ status: "committed" }),
    );
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("deletes a committed receipt when a completed import is rolled back", async () => {
    mocks.readAppState.mockResolvedValue({
      filename: "figma-image.png",
      id: "asset-1",
      provider: "builder",
      status: "committed",
      url: "https://cdn.builder.io/asset-1.png",
    });
    mocks.deleteUploadedFile.mockResolvedValue(true);

    await expect(
      action.run({
        cleanup: "delete",
        idempotencyKey: "fig-import:image-1",
      }),
    ).resolves.toMatchObject({ deleted: true });

    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "asset-1",
      url: "https://cdn.builder.io/asset-1.png",
    });
  });

  it("commits every staged receipt in a completed import batch", async () => {
    const now = Date.now();
    mocks.appStateListByKeyPrefix.mockResolvedValue([
      {
        key: "file-upload-receipt:batch-1:figma-image.png",
        sessionId: "owner@example.com",
        value: {
          expiresAt: now + 1,
          filename: "figma-image.png",
          id: "asset-1",
          provider: "builder",
          status: "staged",
          url: "https://cdn.builder.io/asset-1.png",
        },
      },
    ]);

    await commitUploadReceiptsForImport("batch-1");

    expect(mocks.appStateCompareAndSet).toHaveBeenCalledWith(
      "owner@example.com",
      "file-upload-receipt:batch-1:figma-image.png",
      expect.objectContaining({ status: "staged" }),
      expect.objectContaining({ status: "committed" }),
    );
  });

  it("reaps expired staged receipts through the provider before deleting state", async () => {
    const now = Date.now();
    mocks.appStateListByKeyPrefix.mockResolvedValue([
      {
        key: "file-upload-receipt:fig-import:image-1",
        sessionId: "owner@example.com",
        value: {
          expiresAt: now - 1,
          filename: "figma-image.png",
          id: "asset-1",
          provider: "builder",
          status: "staged",
          url: "https://cdn.builder.io/asset-1.png",
        },
      },
    ]);
    mocks.deleteUploadedFile.mockResolvedValue(true);

    await expect(
      runUploadReceiptCleanupOnce({ force: true, now }),
    ).resolves.toMatchObject({ deleted: 1, failed: 0, scanned: 1 });

    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "asset-1",
      url: "https://cdn.builder.io/asset-1.png",
    });
    expect(mocks.appStateCompareAndSet).toHaveBeenLastCalledWith(
      "owner@example.com",
      "file-upload-receipt:fig-import:image-1",
      expect.objectContaining({ status: "deleting" }),
      null,
    );
  });

  it("requeues a provider error and continues reaping the cleanup batch", async () => {
    const now = Date.now();
    mocks.appStateListByKeyPrefix.mockResolvedValue([
      {
        key: "file-upload-receipt:fig-import:first",
        sessionId: "owner@example.com",
        value: {
          expiresAt: now - 1,
          filename: "first.png",
          id: "asset-1",
          provider: "builder",
          status: "staged",
          url: "https://cdn.builder.io/asset-1.png",
        },
      },
      {
        key: "file-upload-receipt:fig-import:second",
        sessionId: "owner@example.com",
        value: {
          expiresAt: now - 1,
          filename: "second.png",
          id: "asset-2",
          provider: "builder",
          status: "staged",
          url: "https://cdn.builder.io/asset-2.png",
        },
      },
    ]);
    mocks.deleteUploadedFile
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(true);

    await expect(
      runUploadReceiptCleanupOnce({ force: true, now }),
    ).resolves.toMatchObject({
      scanned: 2,
      deleted: 1,
      failed: 1,
    });

    expect(mocks.appStateCompareAndSet).toHaveBeenCalledWith(
      "owner@example.com",
      "file-upload-receipt:fig-import:first",
      expect.objectContaining({ status: "deleting" }),
      expect.objectContaining({
        status: "staged",
        expiresAt: now + 15 * 60 * 1000,
      }),
    );
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "asset-2",
      url: "https://cdn.builder.io/asset-2.png",
    });
  });
});
