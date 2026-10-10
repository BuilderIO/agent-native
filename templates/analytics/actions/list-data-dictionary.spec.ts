import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "user@example.test"),
  listOrgSettings: vi.fn(),
  listSettingsByPrefix: vi.fn(),
  readSourceIndex: vi.fn(),
  sourceIndexDictionaryEntries: vi.fn(),
  dataDictionaryTrustRank: vi.fn(() => 0),
  decodeSearchCursor: vi.fn((_search: string, cursor?: string) =>
    cursor ? Number(cursor) : 0,
  ),
  matchSearchFields: vi.fn(() => ({ score: 0, matchedTerms: [] })),
  paginateSearchResults: vi.fn(
    (args: {
      results: Array<Record<string, unknown>>;
      searched: number;
      limit: number;
      offset: number;
    }) => ({
      results: args.results.slice(args.offset, args.offset + args.limit),
      nextPage:
        args.offset + args.limit < args.searched
          ? String(args.offset + args.limit)
          : null,
    }),
  ),
  semanticScopeCompatibility: vi.fn(() => 0),
  semanticScopeForSearch: vi.fn(() => ""),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  listOrgSettings: mocks.listOrgSettings,
  listSettingsByPrefix: mocks.listSettingsByPrefix,
}));

vi.mock("../server/lib/analytics-term-matcher.js", () => ({
  dataDictionaryTrustRank: mocks.dataDictionaryTrustRank,
  decodeSearchCursor: mocks.decodeSearchCursor,
  matchSearchFields: mocks.matchSearchFields,
  paginateSearchResults: mocks.paginateSearchResults,
  semanticScopeCompatibility: mocks.semanticScopeCompatibility,
  semanticScopeForSearch: mocks.semanticScopeForSearch,
}));

vi.mock("../server/lib/source-index-store.js", () => ({
  readSourceIndex: mocks.readSourceIndex,
  sourceIndexDictionaryEntries: mocks.sourceIndexDictionaryEntries,
}));

const { default: action } = await import("./list-data-dictionary");

describe("list-data-dictionary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOrgSettings.mockResolvedValue({
      curated: { id: "curated", metric: "Curated entry" },
    });
    mocks.listSettingsByPrefix.mockResolvedValue([
      { value: { id: "user", metric: "User entry" } },
    ]);
    mocks.readSourceIndex.mockResolvedValue({
      status: "available",
      bundle: { generatedAt: "2026-10-09T00:00:00.000Z" },
    });
    mocks.sourceIndexDictionaryEntries.mockReturnValue([
      { id: "index-generated", metric: "Generated index entry" },
    ]);
  });

  it("includes generated index entries in unfiltered, bounded pages", async () => {
    const result = await action.run({ limit: 2 }, {} as never);

    expect(mocks.readSourceIndex).toHaveBeenCalledWith("org_test");
    expect(mocks.paginateSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 2,
        searched: 3,
        results: expect.arrayContaining([
          expect.objectContaining({ id: "curated" }),
          expect.objectContaining({ id: "index-generated" }),
          expect.objectContaining({ id: "user" }),
        ]),
      }),
    );
    expect(result.results).toHaveLength(2);
    expect(result.results).toContainEqual(
      expect.objectContaining({ id: "index-generated" }),
    );
    expect(result.sourceIndexStatus).toBe("available");
    expect(result.nextPage).toBe("2");
  });

  it("keeps saved entries browsable and reports an unreadable source index", async () => {
    mocks.readSourceIndex.mockResolvedValue({ status: "unavailable" });

    const result = await action.run({ limit: 50 }, {} as never);

    expect(result).toMatchObject({
      sourceIndexStatus: "unavailable",
      results: expect.arrayContaining([
        expect.objectContaining({ id: "curated" }),
        expect.objectContaining({ id: "user" }),
      ]),
    });
    expect(result.results).not.toContainEqual(
      expect.objectContaining({ id: "index-generated" }),
    );
  });

  it("keeps live generated lifecycle status ahead of a saved overlay", async () => {
    mocks.listOrgSettings.mockResolvedValue({
      "saved-index-copy": {
        id: "index-generated",
        metric: "Saved copy",
        definition: "Reviewed overlay",
        status: "active",
        approved: true,
      },
    });
    mocks.sourceIndexDictionaryEntries.mockReturnValue([
      {
        id: "index-generated",
        metric: "Generated index entry",
        status: "deprecated",
        sourceIndex: true,
        sourceIndexGeneratedAt: "2026-10-10T00:00:00.000Z",
      },
    ]);

    const result = await action.run({ limit: 50 }, {} as never);
    const entry = result.results.find(
      (candidate: Record<string, unknown>) =>
        candidate.id === "index-generated",
    );

    expect(entry).toMatchObject({
      metric: "Saved copy",
      definition: "Reviewed overlay",
      approved: true,
      status: "deprecated",
      sourceIndexGeneratedAt: "2026-10-10T00:00:00.000Z",
    });
  });
});
