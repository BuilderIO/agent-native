import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteUploadedFile: vi.fn(),
  findDeckReferencingAsset: vi.fn(),
  finishCleanup: vi.fn(),
  getDb: vi.fn(),
  getQuery: vi.fn(),
  retryCleanup: vi.fn(),
  scheduleCleanup: vi.fn(),
  resolveAuth: vi.fn(),
  runWithRequestContext: vi.fn(),
  setStatus: vi.fn(),
  uploadedAssets: {
    id: "asset-id",
    ownerEmail: "owner-email",
    orgId: "org-id",
    provider: "provider",
    providerObjectId: "provider-object-id",
    type: "type",
    url: "url",
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteUploadedFile(...args),
}));

vi.mock("../lib/uploaded-asset-cleanup-outbox.js", () => ({
  finishOwnedUploadedAssetCleanup: (...args: unknown[]) =>
    mocks.finishCleanup(...args),
  retryOwnedUploadedAssetCleanup: (...args: unknown[]) =>
    mocks.retryCleanup(...args),
  scheduleUploadedAssetDeletion: (...args: unknown[]) =>
    mocks.scheduleCleanup(...args),
}));

vi.mock("../lib/slide-asset-references.js", () => ({
  findDeckReferencingAsset: (...args: unknown[]) =>
    mocks.findDeckReferencingAsset(...args),
}));

vi.mock("../lib/uploaded-asset-object-lifecycle.js", () => ({
  deleteUploadedAssetObject: async (args: {
    deleteObject: () => Promise<boolean>;
    onDeleted?: (transaction: unknown) => Promise<void>;
  }) => {
    try {
      if (!(await args.deleteObject())) {
        return {
          status: "failed",
          error: new Error("Storage deletion failed."),
        };
      }
      await args.onDeleted?.(mocks.getDb());
      return { status: "deleted" };
    } catch (error) {
      return { status: "failed", error };
    }
  },
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mocks.runWithRequestContext(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  isNull: (...args: unknown[]) => ["isNull", ...args],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.getDb(),
  schema: { uploadedAssets: mocks.uploadedAssets },
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mocks.getQuery(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setStatus(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => mocks.resolveAuth(...args),
}));

import { discardUploadedVideoAsset } from "./assets";

function assetDatabase(asset: Record<string, unknown> | null) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const rows = asset ? [{ orgId: "org-1", ...asset }] : [];
  const selectWhere = vi.fn();
  const selectBuilder = {
    limit: vi.fn().mockResolvedValue(rows),
    for: vi.fn(() => selectBuilder),
    then: (
      resolve: (value: Record<string, unknown>[]) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  selectWhere.mockReturnValue(selectBuilder);
  const db = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectWhere,
      })),
    })),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback(db),
    ),
  };
  return { db, deleteWhere, selectWhere };
}

describe("discardUploadedVideoAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findDeckReferencingAsset.mockResolvedValue(undefined);
    mocks.getQuery.mockReturnValue({ id: "asset-1" });
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com", orgId: "org-1" },
    });
    mocks.runWithRequestContext.mockImplementation(
      async (_context: unknown, callback: () => unknown) => callback(),
    );
    mocks.deleteUploadedFile.mockResolvedValue(true);
    mocks.scheduleCleanup.mockResolvedValue("cleanup-1");
    mocks.finishCleanup.mockResolvedValue(true);
    mocks.retryCleanup.mockResolvedValue(true);
  });

  it("deletes the owned video object and its asset record", async () => {
    const { db, deleteWhere } = assetDatabase({
      id: "asset-1",
      providerObjectId: "provider-object-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
      orgId: "org-1",
    });
    mocks.getDb.mockReturnValue(db);

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: "provider-object-1",
      url: "https://media.example.com/clip.mp4",
    });
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        assetId: "asset-1",
        provider: "builder",
        providerObjectId: "provider-object-1",
      }),
    );
    expect(deleteWhere).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalledWith([
      ["asset-id", "asset-1"],
      ["owner-email", "owner@example.com"],
      ["org-id", "org-1"],
      ["url", "https://media.example.com/clip.mp4"],
      ["provider", "builder"],
      ["provider-object-id", "provider-object-1"],
      ["isNull", undefined],
    ]);
    expect(mocks.finishCleanup).toHaveBeenCalledWith(
      db,
      { assetId: "asset-1", ownerEmail: "owner@example.com", orgId: "org-1" },
      "cleanup-1",
    );
  });

  it("treats an already missing asset as cleaned up", async () => {
    mocks.getDb.mockReturnValue(assetDatabase(null).db);

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      success: true,
    });
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("does not delete an asset that belongs to another organization", async () => {
    const { db, selectWhere } = assetDatabase(null);
    mocks.getDb.mockReturnValue(db);

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      success: true,
    });
    expect(selectWhere).toHaveBeenCalledWith([
      ["asset-id", "asset-1"],
      ["owner-email", "owner@example.com"],
      ["org-id", "org-1"],
    ]);
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("does not delete a non-video asset", async () => {
    mocks.getDb.mockReturnValue(
      assetDatabase({
        id: "asset-1",
        url: "https://media.example.com/image.png",
        provider: "builder",
        type: "image/png",
      }).db,
    );

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      error: "Uploaded video asset was not found",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("does not discard a global video asset referenced by a saved slide", async () => {
    const { db } = assetDatabase({
      id: "asset-1",
      providerObjectId: "provider-object-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
      deckId: null,
    });
    mocks.getDb.mockReturnValue(db);
    mocks.findDeckReferencingAsset.mockResolvedValueOnce({ id: "deck-1" });

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      error: "Video asset is used by a saved slide",
    });

    expect(mocks.findDeckReferencingAsset).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        id: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    );
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.scheduleCleanup).not.toHaveBeenCalled();
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("retains SQL cleanup when the provider cannot delete the object", async () => {
    const { db, deleteWhere } = assetDatabase({
      id: "asset-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
    });
    mocks.getDb.mockReturnValue(db);
    mocks.deleteUploadedFile.mockResolvedValue(false);

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      error: "Could not discard uploaded video",
    });
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ assetId: "asset-1" }),
    );
    expect(mocks.retryCleanup).toHaveBeenCalledWith(
      { assetId: "asset-1", ownerEmail: "owner@example.com", orgId: "org-1" },
      "cleanup-1",
      1,
    );
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(mocks.finishCleanup).not.toHaveBeenCalled();
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
  });

  it("retains queued cleanup when the provider throws", async () => {
    const { db, deleteWhere } = assetDatabase({
      id: "asset-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
    });
    mocks.getDb.mockReturnValue(db);
    mocks.deleteUploadedFile.mockRejectedValue(new Error("storage is offline"));

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      error: "Could not discard uploaded video",
    });
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(mocks.retryCleanup).toHaveBeenCalledWith(
      { assetId: "asset-1", ownerEmail: "owner@example.com", orgId: "org-1" },
      "cleanup-1",
      1,
    );
    expect(mocks.finishCleanup).not.toHaveBeenCalled();
  });

  it("keeps the asset when it cannot record durable cleanup", async () => {
    const { db, deleteWhere } = assetDatabase({
      id: "asset-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
    });
    mocks.getDb.mockReturnValue(db);
    mocks.scheduleCleanup.mockRejectedValue(
      new Error("state storage is offline"),
    );

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      error: "Could not discard uploaded video",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(mocks.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("retains durable cleanup when removing the asset row fails", async () => {
    const { db, deleteWhere } = assetDatabase({
      id: "asset-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
    });
    mocks.getDb.mockReturnValue(db);
    deleteWhere.mockRejectedValue(new Error("database is offline"));

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      error: "Could not discard uploaded video",
    });
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ assetId: "asset-1" }),
    );
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(mocks.deleteUploadedFile).toHaveBeenCalledOnce();
    expect(mocks.retryCleanup).toHaveBeenCalledWith(
      { assetId: "asset-1", ownerEmail: "owner@example.com", orgId: "org-1" },
      "cleanup-1",
      1,
    );
    expect(mocks.finishCleanup).not.toHaveBeenCalled();
  });

  it("passes no provider id when the storage provider deletes by URL", async () => {
    const { db } = assetDatabase({
      id: "asset-2",
      providerObjectId: null,
      url: "https://cdn.builder.io/clip.mp4",
      provider: "builder",
      type: "video/mp4",
    });
    mocks.getDb.mockReturnValue(db);

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      success: true,
    });

    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      id: undefined,
      url: "https://cdn.builder.io/clip.mp4",
    });
  });
});
