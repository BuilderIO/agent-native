import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const getObjectMock = vi.hoisted(() => vi.fn());

const schemaMock = vi.hoisted(() => ({
  assetLibraries: {
    id: "assetLibraries.id",
    settings: "assetLibraries.settings",
  },
  assets: {
    libraryId: "assets.libraryId",
    id: "assets.id",
  },
}));

vi.mock("@agent-native/core/server", () => ({
  FeatureNotConfiguredError: class FeatureNotConfiguredError extends Error {
    readonly requiredCredential: string;

    constructor(opts: { requiredCredential: string; message?: string }) {
      super(opts.message ?? `Feature requires ${opts.requiredCredential}.`);
      this.name = "FeatureNotConfiguredError";
      this.requiredCredential = opts.requiredCredential;
    }
  },
  getBuilderImageGenerationBaseUrl: vi.fn(),
  resolveBuilderAuthHeader: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ op: "and", args })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
  schema: schemaMock,
}));

vi.mock("./storage.js", () => ({
  getObject: getObjectMock,
}));

import { selectReferences } from "./generation.js";

type AssetRow = {
  id: string;
  role: string;
  mimeType: string;
  status: string;
  createdAt: string;
  objectKey: string;
  metadata: string;
  collectionId?: string | null;
};

function createDb(settings: Record<string, unknown>, assets: AssetRow[]) {
  const rowsForTable = (table: unknown) => {
    if (table === schemaMock.assetLibraries) {
      return [{ settings: JSON.stringify(settings) }];
    }
    if (table === schemaMock.assets) return assets;
    return [];
  };
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          const rowsPromise = Promise.resolve(rowsForTable(table)) as Promise<
            unknown[]
          > & {
            limit: (count: number) => Promise<unknown[]>;
          };
          rowsPromise.limit = vi.fn(async (count: number) =>
            rowsForTable(table).slice(0, count),
          );
          return rowsPromise;
        }),
      })),
    })),
  };
}

describe("selectReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getObjectMock.mockImplementation(async (key: string) => Buffer.from(key));
  });

  it("uses subject first, anchors next, and deterministic fill", async () => {
    const assets: AssetRow[] = [
      {
        id: "subject",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "subject-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
      {
        id: "anchor-json",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "anchor-json-bytes",
        metadata: JSON.stringify({ category: "hero" }),
      },
      {
        id: "anchor-meta",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "anchor-meta-bytes",
        metadata: JSON.stringify({ isStyleAnchor: true }),
      },
      {
        id: "latest-fill",
        role: "logo_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-23T00:00:00.000Z",
        objectKey: "latest-fill-bytes",
        metadata: JSON.stringify({ category: "hero" }),
      },
      {
        id: "subject-upload-not-selected",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-25T00:00:00.000Z",
        objectKey: "unused-subject-bytes",
        metadata: JSON.stringify({ intent: "subject" }),
      },
    ];
    getDbMock.mockReturnValue(
      createDb({ canonicalStyleAssetIds: ["anchor-json"] }, assets),
    );
    const randomSpy = vi.spyOn(Math, "random");

    const refs = await selectReferences({
      libraryId: "library-1",
      subjectAssetId: "subject",
      intent: "restyle",
      categories: ["hero"],
      limit: 4,
    });
    const refsAgain = await selectReferences({
      libraryId: "library-1",
      subjectAssetId: "subject",
      intent: "restyle",
      categories: ["hero"],
      limit: 4,
    });

    expect(refs.map((ref) => ref.id)).toEqual([
      "subject",
      "anchor-json",
      "anchor-meta",
      "latest-fill",
    ]);
    expect(refsAgain.map((ref) => ref.id)).toEqual(refs.map((ref) => ref.id));
    expect(refs[0]).toEqual(
      expect.objectContaining({
        id: "subject",
        role: "subject_reference",
        selectionReason: "subject",
      }),
    );
    expect(refs.map((ref) => ref.selectionReason)).toEqual([
      "subject",
      "anchor",
      "anchor",
      "scored",
    ]);
    expect(refs.some((ref) => ref.id === "subject-upload-not-selected")).toBe(
      false,
    );
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("keeps explicit reference IDs in caller order with subject prepended", async () => {
    const assets: AssetRow[] = [
      {
        id: "subject",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-24T00:00:00.000Z",
        objectKey: "subject-bytes",
        metadata: "{}",
      },
      {
        id: "explicit-a",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-22T00:00:00.000Z",
        objectKey: "explicit-a-bytes",
        metadata: "{}",
      },
      {
        id: "explicit-b",
        role: "style_reference",
        mimeType: "image/png",
        status: "reference",
        createdAt: "2026-05-21T00:00:00.000Z",
        objectKey: "explicit-b-bytes",
        metadata: "{}",
      },
    ];
    getDbMock.mockReturnValue(createDb({}, assets));

    const refs = await selectReferences({
      libraryId: "library-1",
      subjectAssetId: "subject",
      referenceAssetIds: ["explicit-b", "explicit-a"],
      intent: "restyle",
      limit: 2,
    });

    expect(refs.map((ref) => ref.id)).toEqual([
      "subject",
      "explicit-b",
      "explicit-a",
    ]);
    expect(refs[0].role).toBe("subject_reference");
  });
});
