import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const nanoidMock = vi.hoisted(() => vi.fn());
const neMock = vi.hoisted(() =>
  vi.fn((column, value) => ({ op: "ne", column, value })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(({ app, view, params }) =>
    JSON.stringify({ app, view, params }),
  ),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "designer@example.com"),
  getRequestOrgId: vi.fn(() => "org-1"),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
  ne: neMock,
}));

vi.mock("nanoid", () => ({
  nanoid: nanoidMock,
}));

vi.mock("../server/lib/json.js", () => ({
  nowIso: vi.fn(() => "2026-06-17T00:00:00.000Z"),
  parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
  stringifyJson: vi.fn((value: unknown) => JSON.stringify(value ?? {})),
}));

vi.mock("./_helpers.js", () => ({
  serializeAsset: vi.fn((row: unknown) => row),
  serializeGenerationPreset: vi.fn((row: unknown) => row),
  serializeLibrary: vi.fn((row: unknown) => row),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetLibraries: {
      id: "libraries.id",
    },
    assetCollections: {
      libraryId: "collections.library_id",
    },
    assetFolders: {
      libraryId: "folders.library_id",
    },
    assetGenerationPresets: {
      libraryId: "presets.library_id",
    },
    assets: {
      libraryId: "assets.library_id",
      status: "assets.status",
      role: "assets.role",
    },
  },
}));

import action from "./duplicate-library.js";

function createSelectResult(rows: unknown[]) {
  return {
    limit: vi.fn(async () => rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
}

function createDb(selectRows: unknown[][]) {
  const inserted: Record<string, unknown[]> = {};
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => createSelectResult(selectRows.shift() ?? [])),
      __table: table,
    })),
  }));
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (rows: unknown | unknown[]) => {
      inserted[String(table)] = Array.isArray(rows) ? rows : [rows];
    }),
  }));
  return {
    insert,
    inserted,
    select,
    transaction: vi.fn(async (fn: (tx: { insert: typeof insert }) => unknown) =>
      fn({ insert }),
    ),
  };
}

describe("duplicate-library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    nanoidMock
      .mockReturnValueOnce("copy-lib")
      .mockReturnValueOnce("copy-collection")
      .mockReturnValueOnce("copy-folder")
      .mockReturnValueOnce("copy-preset")
      .mockReturnValueOnce("copy-reference")
      .mockReturnValueOnce("copy-saved");
  });

  it("creates a private current-user copy with durable child rows remapped", async () => {
    const sourceLibrary = {
      id: "source-lib",
      title: "Acme",
      description: "Original kit",
      customInstructions: "Stay sharp.",
      styleBrief: JSON.stringify({ heroAssetId: "asset-ref" }),
      settings: JSON.stringify({
        canonicalStyleAssetIds: ["asset-ref"],
        presetId: "preset-main",
      }),
      canonicalLogoAssetId: "asset-ref",
      coverAssetId: "asset-saved",
    };
    const collection = {
      id: "collection-main",
      title: "Heroes",
      description: null,
      category: "hero",
      styleBrief: "{}",
      promptTemplate: null,
      defaultAspectRatio: "16:9",
      defaultImageSize: "2K",
      sortOrder: 1,
    };
    const folder = {
      id: "folder-main",
      parentId: null,
      title: "Launch",
      description: null,
      sortOrder: 2,
    };
    const preset = {
      id: "preset-main",
      collectionId: "collection-main",
      title: "Blog hero",
      description: null,
      category: "hero",
      mediaType: "image",
      promptTemplate: "Use asset-ref",
      aspectRatio: "16:9",
      imageSize: "2K",
      model: "gemini-3.1-flash-image",
      textPolicy: "",
      referencePolicy: "auto",
      settings: JSON.stringify({ pinnedAssetId: "asset-ref" }),
      sortOrder: 3,
    };
    const referenceAsset = {
      id: "asset-ref",
      collectionId: "collection-main",
      folderId: "folder-main",
      mediaType: "image",
      role: "style_reference",
      status: "reference",
      title: "Reference",
      description: null,
      altText: null,
      prompt: null,
      model: null,
      aspectRatio: null,
      imageSize: null,
      mimeType: "image/png",
      width: 100,
      height: 100,
      durationSeconds: null,
      sizeBytes: 10,
      objectKey: "local:ref.png",
      thumbnailObjectKey: "local:ref-thumb.webp",
      sourceUrl: null,
      generationRunId: "old-run",
      metadata: JSON.stringify({ sourceAssetId: "asset-saved" }),
    };
    const savedAsset = {
      ...referenceAsset,
      id: "asset-saved",
      title: "Saved",
      status: "saved",
      objectKey: "local:saved.png",
      thumbnailObjectKey: null,
      generationRunId: "old-run-2",
      metadata: "{}",
    };
    const db = createDb([
      [sourceLibrary],
      [collection],
      [folder],
      [preset],
      [referenceAsset, savedAsset],
    ]);
    getDbMock.mockReturnValue(db);

    const result = (await action.run({ id: "source-lib" })) as any;

    expect(assertAccessMock).toHaveBeenCalledWith(
      "asset-library",
      "source-lib",
      "viewer",
    );
    expect(neMock).toHaveBeenCalledWith("assets.role", "subject_reference");
    expect(result.id).toBe("copy-lib");
    expect(result.title).toBe("Acme (copy)");
    expect(result.ownerEmail).toBe("designer@example.com");
    expect(result.orgId).toBe("org-1");
    expect(result.visibility).toBe("private");
    expect(result.canonicalLogoAssetId).toBe("copy-reference");
    expect(result.coverAssetId).toBe("copy-saved");
    expect(JSON.parse(result.settings)).toMatchObject({
      canonicalStyleAssetIds: ["copy-reference"],
      presetId: "copy-preset",
    });
    expect(result.copiedCounts).toEqual({
      collections: 1,
      folders: 1,
      presets: 1,
      assets: 2,
    });
    expect(result.collections[0]).toMatchObject({
      id: "copy-collection",
      libraryId: "copy-lib",
    });
    expect(result.folders[0]).toMatchObject({
      id: "copy-folder",
      libraryId: "copy-lib",
    });
    expect(result.generationPresets[0]).toMatchObject({
      id: "copy-preset",
      libraryId: "copy-lib",
      collectionId: "copy-collection",
    });
    expect(result.assets[0]).toMatchObject({
      id: "copy-reference",
      libraryId: "copy-lib",
      collectionId: "copy-collection",
      folderId: "copy-folder",
      generationRunId: null,
    });
    expect(JSON.parse(result.assets[0].metadata)).toMatchObject({
      sourceAssetId: "copy-saved",
    });
  });
});
