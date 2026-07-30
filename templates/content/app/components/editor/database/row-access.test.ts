import type { ContentDatabaseItem, ContentDatabaseSource } from "@shared/api";
import { describe, expect, it } from "vitest";

import { databaseItemIsSourceBacked } from "./row-access";

describe("database row access", () => {
  function item(
    overrides: Partial<ContentDatabaseItem> = {},
  ): ContentDatabaseItem {
    return {
      id: "local-item",
      databaseId: "database-1",
      document: {
        id: "document-1",
        databaseMembership: undefined,
      } as ContentDatabaseItem["document"],
      position: 0,
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: null,
        error: null,
        version: null,
      },
      ...overrides,
    };
  }

  it("identifies source-backed memberships across attached sources", () => {
    const sources = [
      {
        rows: [{ databaseItemId: "source-item" }],
      },
    ] as ContentDatabaseSource[];

    expect(
      databaseItemIsSourceBacked(item({ id: "source-item" }), sources),
    ).toBe(true);
    expect(databaseItemIsSourceBacked(item(), sources)).toBe(false);
  });

  it("fails closed for queued hydration and item-level source metadata", () => {
    expect(
      databaseItemIsSourceBacked(
        item({
          bodyHydration: {
            status: "pending",
            attemptedAt: null,
            error: null,
            version: null,
          },
        }),
        [],
      ),
    ).toBe(true);
    expect(
      databaseItemIsSourceBacked(
        item({
          document: {
            id: "document-1",
            databaseMembership: { sourceId: "source-1" },
          } as ContentDatabaseItem["document"],
        }),
        [],
      ),
    ).toBe(true);
  });
});
