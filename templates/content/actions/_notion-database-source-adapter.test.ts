import { beforeEach, describe, expect, it, vi } from "vitest";

const { notionFetch, getNotionConnectionForOwner } = vi.hoisted(() => ({
  notionFetch: vi.fn(),
  getNotionConnectionForOwner: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "source-reader@example.com",
}));
vi.mock("../server/lib/notion.js", () => ({
  notionFetch,
  getNotionConnectionForOwner,
}));

import { readNotionDatabaseSource } from "./_notion-database-source-adapter.js";

describe("Notion database source adapter", () => {
  beforeEach(() => {
    notionFetch.mockReset();
    getNotionConnectionForOwner.mockReset();
    getNotionConnectionForOwner.mockResolvedValue({
      accessToken: "example-test-token",
      workspaceName: "Example workspace",
    });
  });

  it("maps the bounded supported property set and preserves unsupported fields", async () => {
    notionFetch
      .mockResolvedValueOnce({
        id: "data-source-1",
        title: [{ plain_text: "Projects" }],
        properties: {
          Name: { id: "title-id", name: "Name", type: "title" },
          Score: { id: "score-id", name: "Score", type: "number" },
          Relation: {
            id: "relation-id",
            name: "Relation",
            type: "relation",
          },
        },
      })
      .mockResolvedValueOnce({
        results: [
          {
            object: "page",
            id: "page-1",
            url: "https://www.notion.so/example-page",
            last_edited_time: "2026-07-10T00:00:00.000Z",
            properties: {
              Name: {
                id: "title-id",
                type: "title",
                title: [{ plain_text: "Alpha" }],
              },
              Score: { id: "score-id", type: "number", number: 42 },
              Relation: {
                id: "relation-id",
                type: "relation",
                relation: [{ id: "related-page" }],
              },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });

    const result = await readNotionDatabaseSource({
      sourceTable: "data-source-1",
      limit: 100,
      offset: 0,
    });

    expect(result.entries[0]).toMatchObject({
      id: "page-1",
      title: "Alpha",
      sourceValues: {
        "title-id": "Alpha",
        "score-id": 42,
        "relation-id": "[Unsupported Notion property: relation]",
      },
    });
    expect(result.fields).toContainEqual(
      expect.objectContaining({
        name: "relation-id",
        type: "unsupported:relation",
      }),
    );
    expect(result.metadata).toMatchObject({
      provider: "notion",
      dataSourceId: "data-source-1",
      unsupportedPropertyCount: 1,
    });
  });

  it("uses the current user's OAuth connection and never returns its token", async () => {
    notionFetch
      .mockResolvedValueOnce({ id: "data-source-2", properties: {} })
      .mockResolvedValueOnce({ results: [], has_more: false });

    const result = await readNotionDatabaseSource({
      sourceTable: "data-source-2",
      limit: 25,
      offset: 0,
    });

    expect(getNotionConnectionForOwner).toHaveBeenCalledWith(
      "source-reader@example.com",
    );
    expect(JSON.stringify(result)).not.toContain("example-test-token");
  });
});
