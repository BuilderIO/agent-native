import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listMetadata: vi.fn(),
  vectorSearch: vi.fn(),
  queryFts: vi.fn(async () => []),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => null),
  writeAppState: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: vi.fn(() => ({ execute: vi.fn() })),
  isPostgres: vi.fn(() => true),
}));

vi.mock("../embeddings/providers.js", () => ({
  availableEmbeddingFamilies: vi.fn(async () => [
    {
      id: "test-family",
      provider: "test",
      model: "test-model",
      version: "v1",
      dimensions: 2,
      embed: vi.fn(async () => [[0.1, 0.9]]),
    },
  ]),
}));

vi.mock("../jobs/index.js", () => ({
  dispatchCreativeContextImportJob: vi.fn(async () => {}),
}));

vi.mock("../search/postgres-fts.js", () => ({
  queryPostgresFts: mocks.queryFts,
}));

vi.mock("../store/index.js", () => ({
  createContextPack: vi.fn(),
  createJob: vi.fn(),
  getActiveEmbeddingSet: vi.fn(async () => ({
    id: "set-1",
    family: "test-family",
    model: "test-model",
    version: "v1",
    dimensions: 2,
  })),
  getContextSource: vi.fn(),
  getCreativeContextItem: vi.fn(),
  listAccessibleLexicalCandidates: vi.fn(async () => ({ results: [] })),
  listAccessibleSearchDocuments: mocks.listDocuments,
  listEmbeddingMetadata: mocks.listMetadata,
}));

vi.mock("./context.js", () => ({
  getCreativeContext: vi.fn(() => ({
    vectorAdapter: { search: mocks.vectorSearch },
  })),
}));

const { performCreativeContextSearch } = await import("./retrieval.js");

function document(itemId: string, chunkId: string) {
  return {
    itemId,
    externalId: itemId,
    itemVersionId: `${itemId}-v1`,
    chunkId,
    chunkOrdinal: 0,
    sourceId: "source-1",
    sourceName: "Corpus",
    kind: "slide",
    title: itemId,
    body: `${itemId} body`,
    summary: null,
    tags: [],
    colors: [],
    updatedAt: "2026-07-16T00:00:00.000Z",
    curationRank: "normal",
    starred: false,
    indexState: "indexed",
    inventoryOnly: false,
    priorReuseCount: 0,
    helpfulFeedbackCount: 0,
    excerpt: `${itemId} excerpt`,
    score: 0,
    canonicalUrl: null,
    mimeType: null,
  };
}

describe("creative context full-corpus vector retrieval", () => {
  beforeEach(() => {
    mocks.listDocuments.mockReset();
    mocks.listMetadata.mockReset();
    mocks.vectorSearch.mockReset();
    mocks.queryFts.mockReset().mockResolvedValue([]);
  });

  it("searches late accessible vectors and hydrates only the ANN match", async () => {
    const early = document("early-item", "early-chunk");
    const late = document("late-item", "late-chunk");
    late.body = "semantic query appears only in the late indexed document";
    mocks.listDocuments.mockImplementation(async (input) =>
      input.itemIds ? [late] : [early],
    );
    mocks.listMetadata.mockResolvedValue([
      {
        id: "embedding-late",
        embeddingSetId: "set-1",
        itemId: "late-item",
        itemVersionId: "late-item-v1",
        chunkId: "late-chunk",
        targetType: "chunk",
        targetId: "late-chunk",
        vectorKey: "vector-late",
        dimensions: 2,
      },
    ]);
    mocks.vectorSearch.mockResolvedValue([
      { embeddingId: "vector-late", score: 0.99 },
    ]);

    const result = await performCreativeContextSearch({
      query: "semantic query",
      limit: 1,
      snapshot: false,
    });

    expect(mocks.listMetadata).toHaveBeenCalledWith({
      embeddingSetId: "set-1",
      sourceIds: undefined,
      packId: undefined,
      kinds: undefined,
      tags: undefined,
      colors: undefined,
      updatedAfter: undefined,
      updatedBefore: undefined,
      statuses: undefined,
    });
    expect(mocks.vectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({ allowedVectorKeys: ["vector-late"] }),
    );
    expect(mocks.listDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemIds: ["late-item"] }),
    );
    expect(result.results.map((entry) => entry.itemId)).toEqual(["late-item"]);
  });

  it("hydrates global FTS candidates through access-scoped document lookup", async () => {
    const early = document("early-item", "early-chunk");
    const late = document("late-item", "late-chunk");
    late.body = "semantic query appears only in the late indexed document";
    mocks.listDocuments.mockImplementation(async (input) =>
      input.chunkIds?.includes("late-chunk") ? [late] : [early],
    );
    mocks.listMetadata.mockResolvedValue([]);
    mocks.queryFts.mockResolvedValue([
      { chunkId: "late-chunk", itemVersionId: "late-item-v1", score: 0.99 },
    ]);

    const result = await performCreativeContextSearch({
      query: "semantic query",
      limit: 1,
      snapshot: false,
    });

    expect(mocks.queryFts).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ allowedChunkIds: expect.anything() }),
    );
    expect(mocks.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIds: ["late-chunk"] }),
    );
    expect(result.results.map((entry) => entry.itemId)).toEqual(["late-item"]);
  });
});
