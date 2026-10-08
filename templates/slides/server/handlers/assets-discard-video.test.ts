import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteUploadedFile: vi.fn(),
  getDb: vi.fn(),
  getQuery: vi.fn(),
  resolveAuth: vi.fn(),
  runWithRequestContext: vi.fn(),
  setStatus: vi.fn(),
  uploadedAssets: {
    id: "asset-id",
    ownerEmail: "owner-email",
    provider: "provider",
    providerObjectId: "provider-object-id",
    type: "type",
    url: "url",
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteUploadedFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mocks.runWithRequestContext(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
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
  const db = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(asset ? [asset] : []),
        })),
      })),
    })),
  };
  return { db, deleteWhere };
}

describe("discardUploadedVideoAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuery.mockReturnValue({ id: "asset-1" });
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com", orgId: "org-1" },
    });
    mocks.runWithRequestContext.mockImplementation(
      async (_context: unknown, callback: () => unknown) => callback(),
    );
    mocks.deleteUploadedFile.mockResolvedValue(true);
  });

  it("deletes the owned video object and its asset record", async () => {
    const { db, deleteWhere } = assetDatabase({
      id: "asset-1",
      providerObjectId: "provider-object-1",
      url: "https://media.example.com/clip.mp4",
      provider: "builder",
      type: "video/mp4",
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
    expect(deleteWhere).toHaveBeenCalled();
  });

  it("treats an already missing asset as cleaned up", async () => {
    mocks.getDb.mockReturnValue(assetDatabase(null).db);

    await expect(discardUploadedVideoAsset({} as never)).resolves.toEqual({
      success: true,
    });
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

  it("keeps the asset record when its provider cannot delete the object", async () => {
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
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(deleteWhere).not.toHaveBeenCalled();
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
