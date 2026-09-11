import type { ContentDatabaseItem, ContentDatabaseSource } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  databaseItemCanDuplicate,
  databaseItemCanRemoveFromDatabase,
  databaseItemHasViewerAccess,
  databaseItemIsSourceBacked,
} from "./row-access";

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

  it("uses explicit page-view capability and fails closed when it is absent", () => {
    expect(
      databaseItemHasViewerAccess(
        item({
          document: {
            id: "document-1",
            canView: true,
          } as ContentDatabaseItem["document"],
        }),
      ),
    ).toBe(true);
    expect(databaseItemHasViewerAccess(item())).toBe(false);
  });

  it("offers duplication only for visible non-workspace pages", () => {
    const visibleItem = item({
      document: {
        id: "document-1",
        canView: true,
      } as ContentDatabaseItem["document"],
    });

    expect(databaseItemCanDuplicate(visibleItem, false)).toBe(true);
    expect(databaseItemCanDuplicate(item(), false)).toBe(false);
    expect(databaseItemCanDuplicate(visibleItem, true)).toBe(false);
  });

  it("shares one fail-closed removal decision across database row views", () => {
    const visibleItem = item({
      document: {
        id: "document-1",
        canView: true,
      } as ContentDatabaseItem["document"],
    });
    expect(
      databaseItemCanRemoveFromDatabase({
        item: visibleItem,
        databaseCanManage: true,
        databaseSystemRole: null,
        isWorkspaceCatalog: false,
        sources: [],
      }),
    ).toBe(true);
    expect(
      databaseItemCanRemoveFromDatabase({
        item: item(),
        databaseCanManage: true,
        databaseSystemRole: null,
        isWorkspaceCatalog: false,
        sources: [],
      }),
    ).toBe(false);
    expect(
      databaseItemCanRemoveFromDatabase({
        item: visibleItem,
        databaseCanManage: false,
        databaseSystemRole: null,
        isWorkspaceCatalog: false,
        sources: [],
      }),
    ).toBe(false);
    expect(
      databaseItemCanRemoveFromDatabase({
        item: visibleItem,
        databaseCanManage: true,
        databaseSystemRole: "files",
        isWorkspaceCatalog: false,
        sources: [],
      }),
    ).toBe(false);
    expect(
      databaseItemCanRemoveFromDatabase({
        item: visibleItem,
        databaseCanManage: true,
        databaseSystemRole: undefined,
        isWorkspaceCatalog: false,
        sources: [],
      }),
    ).toBe(false);
  });
});
