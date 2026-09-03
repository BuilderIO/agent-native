import { beforeEach, describe, expect, it, vi } from "vitest";

const executeProviderApiRequest = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/provider-api", () => ({
  executeProviderApiRequest,
}));

const { default: action } = await import("./pylon-issues");

describe("pylon-issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses Pylon search with body-cursor pagination through the provider substrate", async () => {
    executeProviderApiRequest.mockResolvedValue({
      items: [{ id: "issue-1" }],
      pagesRead: 2,
      totalItems: 1,
      lastStatus: 200,
      truncated: false,
      nextCursor: null,
    });

    await expect(
      action.run({ days: 371, pageSize: 500, maxPages: 20 }),
    ).resolves.toMatchObject({
      issues: [{ id: "issue-1" }],
      total: 1,
      pagesRead: 2,
      coverageComplete: true,
      truncated: false,
      source: "pylon-issues-search",
      nextCursor: null,
    });
    expect(executeProviderApiRequest).toHaveBeenCalledWith({
      provider: "pylon",
      method: "POST",
      path: "/issues/search",
      body: {
        filter: {
          field: "created_at",
          operator: "time_is_after",
          value: expect.any(String),
        },
        limit: 500,
      },
      fetchAllPages: {
        cursorPath: "pagination.cursor",
        cursorBodyPath: "cursor",
        itemsPath: "data",
        maxPages: 20,
      },
    });
  });

  it("reports incomplete coverage when the provider recipe still has a cursor", async () => {
    executeProviderApiRequest.mockResolvedValue({
      items: [{ id: "issue-1" }],
      pagesRead: 20,
      totalItems: 1,
      lastStatus: 200,
      truncated: true,
      nextCursor: "page-21",
    });

    await expect(
      action.run({ days: 371, pageSize: 500, maxPages: 20 }),
    ).resolves.toMatchObject({
      coverageComplete: false,
      truncated: true,
      nextCursor: "page-21",
    });
  });
});
