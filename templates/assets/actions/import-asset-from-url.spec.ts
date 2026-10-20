import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const createAssetFromBufferMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const getObjectMock = vi.hoisted(() => vi.fn());
const serializeAssetMock = vi.hoisted(() => vi.fn((row: unknown) => row));
const ssrfSafeFetchMock = vi.hoisted(() => vi.fn());
const libraryAccessMock = vi.hoisted(() =>
  vi.fn(async () => ({ role: "owner", canApprove: true })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));
const deleteDraftMock = vi.hoisted(() => vi.fn(async () => true));
const unrestrictedScope = vi.hoisted(() => ({
  unrestricted: true,
  approvableLibraryIds: new Set<string>(),
  ownRunIds: new Set<string>(),
  callerEmail: "viewer@example.test",
}));

vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraft: libraryAccessMock,
  assertCanApprove: libraryAccessMock,
  assertCanDraftAuthoredBy: libraryAccessMock,
  assertCanDeleteAsset: libraryAccessMock,
  draftScopeForLibrary: vi.fn(async () => unrestrictedScope),
  resolveDraftReadScope: vi.fn(async () => unrestrictedScope),
  unrestrictedDraftReadScope: vi.fn(() => unrestrictedScope),
  assertCanUseAssets: vi.fn(),
  assertCanUseRuns: vi.fn(),
  canReadDraftAsset: vi.fn(() => true),
  canReadRun: vi.fn(() => true),
  draftReadFilter: vi.fn(() => undefined),
  runReadFilter: vi.fn(() => undefined),
  sessionReadFilter: vi.fn(() => undefined),
  canReadSession: vi.fn(() => true),
  deleteDraftAssetIfUnchanged: deleteDraftMock,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  asc: vi.fn((column) => ({ op: "asc", column })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  gt: vi.fn((column, value) => ({ op: "gt", column, value })),
  isNull: vi.fn((column) => ({ op: "isNull", column })),
  or: vi.fn((...conditions) => ({ op: "or", conditions })),
  sql: vi.fn((strings, ...values) => ({ op: "sql", strings, values })),
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
  getObject: getObjectMock,
}));

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

import { AssetDedupeSearchLimitError } from "../server/lib/upload-dedupe.js";
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
  const whereConditions: unknown[] = [];
  return {
    whereConditions,
    select: vi.fn(() => ({
      from: vi.fn(() => {
        let result: unknown[] | undefined;
        const load = () => (result ??= rows.shift() ?? []);
        const query: any = {
          where: vi.fn((condition: unknown) => {
            whereConditions.push(condition);
            load();
            return query;
          }),
          orderBy: vi.fn(() => query),
          limit: vi.fn(async (count: number) => load().slice(0, count)),
          then: (
            resolve: (value: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve(load()).then(resolve, reject),
        };
        return query;
      }),
    })),
  };
}

const pngContentHash = () =>
  createHash("sha256").update(pngBytes).digest("hex");

describe("import-asset-from-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryAccessMock.mockResolvedValue({ role: "owner", canApprove: true });
    assertAccessMock.mockResolvedValue(undefined);
    getObjectMock.mockImplementation(async (key: string) => Buffer.from(key));
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

    expect(libraryAccessMock).toHaveBeenCalledWith("lib-1", expect.any(String));
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
    libraryAccessMock.mockRejectedValue(new Error("No access"));

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

  it("aborts the import when duplicate checking reaches its byte limit", async () => {
    const legacyAsset = {
      id: "asset-legacy",
      title: "Legacy reference",
      mediaType: "image",
      mimeType: "image/png",
      sizeBytes: pngBytes.byteLength,
      metadata: "{}",
      objectKey: "local:legacy.png",
    };
    getDbMock.mockReturnValue(createDb([[], [legacyAsset]]));
    getObjectMock.mockRejectedValueOnce(new AssetDedupeSearchLimitError());

    await expect(
      action.run({
        libraryId: "lib-1",
        url: "https://cdn.example.test/legacy-image.png",
        role: "style_reference",
      }),
    ).rejects.toBeInstanceOf(AssetDedupeSearchLimitError);

    expect(getObjectMock).toHaveBeenCalledOnce();
    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
  });

  it("uses guarded top-level string hashes in duplicate candidate queries", async () => {
    const db = createDb([[], []]);
    getDbMock.mockReturnValue(db);

    await action.run({
      libraryId: "lib-1",
      url: "https://cdn.example.test/top-level-hash.png",
      role: "style_reference",
    });

    const sqlExpressions: any[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if ((value as any).op === "sql") sqlExpressions.push(value);
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    db.whereConditions.forEach(visit);
    const hashExpressions = sqlExpressions.filter((expression) =>
      expression.strings.join("").includes("contentHash"),
    );

    expect(hashExpressions.length).toBeGreaterThan(0);
    expect(
      hashExpressions.every((expression) => {
        const source = expression.strings.join("");
        return (
          source.includes("IS JSON") &&
          source.includes("jsonb_typeof") &&
          source.includes("NULLIF") &&
          !source.includes("substring")
        );
      }),
    ).toBe(true);
  });

  it("finds a hashless legacy duplicate after the first 100 matching candidates", async () => {
    const candidate = (id: string) => ({
      id,
      title: "Legacy image",
      mediaType: "image",
      mimeType: "image/png",
      sizeBytes: pngBytes.byteLength,
      metadata: "{}",
      objectKey: id,
    });
    const firstBatch = Array.from({ length: 100 }, (_, index) =>
      candidate(`legacy-${String(index).padStart(3, "0")}`),
    );
    const laterDuplicate = candidate("legacy-100");
    const fullRow = {
      ...laterDuplicate,
      role: "style_reference",
      status: "reference",
    };
    getDbMock.mockReturnValue(
      createDb([[], firstBatch, [laterDuplicate], [fullRow]]),
    );
    getObjectMock.mockImplementation(async (key: string) =>
      key === laterDuplicate.objectKey
        ? pngBytes
        : Buffer.alloc(pngBytes.byteLength),
    );

    const result = await action.run({
      libraryId: "lib-1",
      url: "https://cdn.example.test/legacy.png",
      role: "style_reference",
    });

    expect(createAssetFromBufferMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "legacy-100",
      deduplicated: true,
    });
    expect(getObjectMock).toHaveBeenCalledTimes(101);
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

    expect(db.select).toHaveBeenCalledTimes(2);
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
