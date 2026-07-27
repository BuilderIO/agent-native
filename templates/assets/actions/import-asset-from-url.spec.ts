import { createHash } from "node:crypto";

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
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
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
    assets: {
      id: "assets.id",
      title: "assets.title",
      mediaType: "assets.media_type",
      mimeType: "assets.mime_type",
      sizeBytes: "assets.size_bytes",
      metadata: "assets.metadata",
      objectKey: "assets.object_key",
      libraryId: "assets.library_id",
      status: "assets.status",
      role: "assets.role",
    },
  },
}));

vi.mock("../server/lib/assets.js", () => ({
  createAssetFromBuffer: createAssetFromBufferMock,
}));

vi.mock("../server/lib/storage.js", () => ({
  getObject: vi.fn(),
}));

// json.js pulls in @agent-native/core/server; upload-dedupe (kept real) only
// needs parseJson from it.
vi.mock("../server/lib/json.js", () => ({
  parseJson: (value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
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

// Each select() consumes the next row set, whether the query ends at
// `.where(...)` (awaited directly) or chains `.limit(n)`.
function createDb(rows: unknown[][]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const result = rows.shift() ?? [];
          const query = Promise.resolve(result) as Promise<unknown[]> & {
            limit: (n: number) => Promise<unknown[]>;
          };
          query.limit = vi.fn(async () => result);
          return query;
        }),
      })),
    })),
  };
}

const pngContentHash = () =>
  createHash("sha256").update(pngBytes).digest("hex");

describe("import-asset-from-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    // Fresh Response per call — a Response body stream can only be read once.
    ssrfSafeFetchMock.mockImplementation(async () =>
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
      { maxRedirects: 3, httpsOnly: true },
    );
    expect(createAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "lib-1",
        collectionId: null,
        folderId: null,
        mimeType: "image/png",
        mediaType: "image",
        role: "style_reference",
        category: "style-only",
        status: "reference",
        title: "Blog hero",
        description: "Imported from the launch post.",
        sourceUrl: "https://cdn.example.test/blog-hero.png",
        metadata: {
          contentHash: pngContentHash(),
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
        category: "logo",
      }),
    );
  });

  it("defaults the category from the role and honors explicit overrides", async () => {
    await action.run({
      libraryId: "lib-1",
      url: "https://example.test/diagram.png",
      role: "diagram_reference",
    });
    expect(createAssetFromBufferMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "diagram" }),
    );

    await action.run({
      libraryId: "lib-1",
      url: "https://example.test/hero.png",
      role: "style_reference",
      category: "hero",
    });
    expect(createAssetFromBufferMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "style_reference", category: "hero" }),
    );
  });

  it("returns the existing asset instead of duplicating a re-imported image", async () => {
    const existingForDedupe = {
      id: "asset-existing",
      title: "Blog hero",
      mediaType: "image",
      mimeType: "image/png",
      sizeBytes: pngBytes.byteLength,
      metadata: JSON.stringify({ contentHash: pngContentHash() }),
      objectKey: "local:original.png",
    };
    const existingFullRow = {
      ...existingForDedupe,
      role: "style_reference",
      status: "reference",
    };
    getDbMock.mockReturnValue(
      createDb([[existingForDedupe], [existingFullRow]]),
    );

    const result = await action.run({
      libraryId: "lib-1",
      url: "https://cdn.example.test/blog-hero.png",
      role: "style_reference",
    });

    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "asset-existing",
      deduplicated: true,
    });
  });

  it("treats empty-string collection and folder ids as unassigned", async () => {
    const db = createDb([]);
    getDbMock.mockReturnValue(db);

    await action.run({
      libraryId: "lib-1",
      url: "https://example.test/image.png",
      collectionId: "",
      folderId: "",
    });

    // Only the dedupe lookup ran — no membership validation for "" ids.
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(createAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: null, folderId: null }),
    );
  });

  it("rejects URLs with embedded credentials before fetching", async () => {
    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://user:secret@example.test/image.png",
      }),
    ).rejects.toThrow("URLs with embedded credentials cannot be imported.");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("strips credential-bearing query strings from persisted provenance", async () => {
    const signedUrl =
      "https://bucket.example.test/hero.png?X-Amz-Signature=abc123&X-Amz-Expires=300";

    await action.run({ libraryId: "lib-1", url: signedUrl });

    // The fetch uses the full signed URL; the stored provenance does not.
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      signedUrl,
      expect.anything(),
      expect.anything(),
    );
    expect(createAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://bucket.example.test/hero.png",
        metadata: expect.objectContaining({
          importedFrom: "https://bucket.example.test/hero.png",
        }),
      }),
    );
  });

  it("keeps innocuous query strings in provenance", async () => {
    await action.run({
      libraryId: "lib-1",
      url: "https://cms.example.test/media?id=42",
    });
    expect(createAssetFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://cms.example.test/media?id=42",
      }),
    );
  });

  it("releases the response body when rejecting bad responses", async () => {
    const badStatus = response("nope", { "content-type": "image/png" }, 404);
    ssrfSafeFetchMock.mockResolvedValueOnce(badStatus);
    await expect(
      action.run({ libraryId: "lib-1", url: "https://example.test/a.png" }),
    ).rejects.toThrow("(404)");
    expect(badStatus.bodyUsed).toBe(true);

    const badMime = response("<html>", { "content-type": "text/html" });
    ssrfSafeFetchMock.mockResolvedValueOnce(badMime);
    await expect(
      action.run({ libraryId: "lib-1", url: "https://example.test/b.png" }),
    ).rejects.toThrow("Only PNG");
    expect(badMime.bodyUsed).toBe(true);

    const oversized = response(pngBytes, {
      "content-type": "image/png",
      "content-length": String(25 * 1024 * 1024 + 1),
    });
    ssrfSafeFetchMock.mockResolvedValueOnce(oversized);
    await expect(
      action.run({ libraryId: "lib-1", url: "https://example.test/c.png" }),
    ).rejects.toThrow("Image too large");
    expect(oversized.bodyUsed).toBe(true);
  });
});
