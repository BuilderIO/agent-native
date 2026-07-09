import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const createAssetFromBufferMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const serializeAssetMock = vi.hoisted(() => vi.fn((row: unknown) => row));
const ssrfSafeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetCollections: {
      id: "asset_collections.id",
      libraryId: "asset_collections.library_id",
    },
    assetFolders: {
      id: "asset_folders.id",
      libraryId: "asset_folders.library_id",
    },
  },
}));

vi.mock("../server/lib/assets.js", () => ({
  createAssetFromBuffer: createAssetFromBufferMock,
}));

vi.mock("./_helpers.js", () => ({
  serializeAsset: serializeAssetMock,
}));

import action from "./import-asset-from-url.js";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function response(
  body: BodyInit | null,
  headers: Record<string, string>,
  status = 200,
) {
  return new Response(body, { status, headers });
}

function createDb(rows: unknown[][]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows.shift() ?? []),
        })),
      })),
    })),
  };
}

describe("import-asset-from-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    ssrfSafeFetchMock.mockResolvedValue(
      response(pngBytes, {
        "content-type": "image/png; charset=utf-8",
        "content-length": String(pngBytes.byteLength),
      }),
    );
    createAssetFromBufferMock.mockImplementation(async (input) => ({
      id: "asset-1",
      objectKey: "local:original.png",
      thumbnailObjectKey: "local:thumb.webp",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
      width: 1,
      height: 1,
      sizeBytes: input.buffer.byteLength,
      ...input,
      metadata: JSON.stringify(input.metadata ?? {}),
    }));
    getDbMock.mockReturnValue(createDb([]));
  });

  it("imports a remote PNG as a reference asset", async () => {
    const result = await action.run({
      libraryId: "lib-1",
      url: "https://cdn.example.test/blog-hero.png",
      role: "style_reference",
      title: "Blog hero",
      description: "Imported from the launch post.",
    });

    expect(assertAccessMock).toHaveBeenCalledWith(
      "asset-library",
      "lib-1",
      "editor",
    );
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://cdn.example.test/blog-hero.png",
      { signal: expect.any(AbortSignal) },
      { maxRedirects: 3 },
    );
    expect(createAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "lib-1",
        collectionId: null,
        folderId: null,
        mimeType: "image/png",
        mediaType: "image",
        role: "style_reference",
        status: "reference",
        title: "Blog hero",
        description: "Imported from the launch post.",
        sourceUrl: "https://cdn.example.test/blog-hero.png",
        metadata: {
          importedFrom: "https://cdn.example.test/blog-hero.png",
        },
      }),
    );
    expect(createAssetFromBufferMock.mock.calls[0][0].buffer).toEqual(pngBytes);
    expect(result).toMatchObject({
      id: "asset-1",
      role: "style_reference",
      status: "reference",
      sourceUrl: "https://cdn.example.test/blog-hero.png",
      thumbnailObjectKey: "local:thumb.webp",
    });
  });

  it("rejects non-image content types", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      response("hello", { "content-type": "text/html" }),
    );

    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://example.test/page",
      }),
    ).rejects.toThrow("Only PNG, JPEG, WebP, and AVIF images are supported.");
    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
  });

  it("rejects content-type and magic-byte mismatches", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      response("not a png", { "content-type": "image/png" }),
    );

    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://example.test/fake.png",
      }),
    ).rejects.toThrow("fetched bytes do not match");
    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
  });

  it("rejects private or redirected targets through the SSRF-safe fetch guard", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("SSRF blocked: private"));

    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://169.254.169.254/latest/meta-data",
      }),
    ).rejects.toThrow("Could not fetch that URL.");
    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://public.example.test/redirects-to-private",
      }),
    ).rejects.toThrow("Could not fetch that URL.");
    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
  });

  it("requires https URLs before fetching", async () => {
    await expect(
      action.run({
        libraryId: "lib-1",
        url: "http://example.test/logo.png",
      }),
    ).rejects.toThrow("Only HTTPS image URLs can be imported.");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("enforces the upload size cap before buffering the body", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      response(pngBytes, {
        "content-type": "image/png",
        "content-length": String(25 * 1024 * 1024 + 1),
      }),
    );

    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://example.test/large.png",
      }),
    ).rejects.toThrow("Image too large");
    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
  });

  it("rejects callers without editor access", async () => {
    assertAccessMock.mockRejectedValue(new Error("No access"));

    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://example.test/image.png",
      }),
    ).rejects.toThrow("No access");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("validates collection and folder membership when provided", async () => {
    getDbMock.mockReturnValue(
      createDb([
        [{ id: "collection-1", libraryId: "lib-1" }],
        [{ id: "folder-1", libraryId: "lib-1" }],
      ]),
    );

    await action.run({
      libraryId: "lib-1",
      url: "https://example.test/image.png",
      collectionId: "collection-1",
      folderId: "folder-1",
      role: "logo_reference",
    });

    expect(createAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: "collection-1",
        folderId: "folder-1",
        role: "logo_reference",
      }),
    );
  });
});
