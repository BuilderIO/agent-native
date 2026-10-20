import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: { uploadedAssets: { id: "id" } },
  deleteFile: vi.fn(),
  deleteObject: vi.fn(),
  finishCleanup: vi.fn(),
  getDb: vi.fn(),
  lifecycleDelete: vi.fn(),
  retryCleanup: vi.fn(),
  scheduleDeletion: vi.fn(),
  rowDeleteWhere: vi.fn(),
}));

const transaction = {
  delete: vi.fn(() => ({ where: mocks.rowDeleteWhere })),
};

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    kind: "inArray",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.getDb(),
  schema: mocks.schema,
}));

vi.mock("./uploaded-asset-cleanup-outbox.js", () => ({
  finishOwnedUploadedAssetCleanup: (...args: unknown[]) =>
    mocks.finishCleanup(...args),
  retryOwnedUploadedAssetCleanup: (...args: unknown[]) =>
    mocks.retryCleanup(...args),
  scheduleUploadedAssetDeletion: (...args: unknown[]) =>
    mocks.scheduleDeletion(...args),
}));

vi.mock("./uploaded-asset-object-lifecycle.js", () => ({
  deleteUploadedAssetObject: (...args: unknown[]) =>
    mocks.lifecycleDelete(...args),
}));

import {
  ImportedAssetBatch,
  withImportedAssetCleanup,
} from "./imported-asset-batch.js";

describe("imported asset cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({
      transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    });
    mocks.scheduleDeletion.mockResolvedValue("cleanup-token");
    mocks.finishCleanup.mockResolvedValue(true);
    mocks.rowDeleteWhere.mockResolvedValue(undefined);
    mocks.deleteFile.mockResolvedValue(true);
    mocks.lifecycleDelete.mockImplementation(async (...args: unknown[]) => {
      const callbacks = args[0] as {
        deleteObject: () => Promise<boolean>;
        onDeleted?: (tx: never) => Promise<void>;
      };
      await callbacks.deleteObject();
      await callbacks.onDeleted?.(transaction as never);
      return { status: "deleted" };
    });
  });

  it("schedules and deletes tracked storage objects when an import fails", async () => {
    const asset = {
      assetId: "asset-1",
      filename: "slide-image.png",
      url: "https://storage.example/slide-image.png",
      mimeType: "image/png",
      size: 42,
      provider: "s3",
      providerObjectId: "object-1",
    };
    const batch = new ImportedAssetBatch({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    batch.track(asset);
    const importError = new Error("source compilation failed");

    await expect(
      withImportedAssetCleanup(batch, async () => {
        throw importError;
      }),
    ).rejects.toBe(importError);

    expect(mocks.scheduleDeletion).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        assetId: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        provider: "s3",
        providerObjectId: "object-1",
        url: "https://storage.example/slide-image.png",
      }),
    );
    expect(mocks.deleteFile).toHaveBeenCalledWith("s3", {
      id: "object-1",
      url: "https://storage.example/slide-image.png",
    });
    expect(mocks.finishCleanup).toHaveBeenCalledOnce();
    expect(mocks.rowDeleteWhere).toHaveBeenCalledTimes(2);
  });
});
