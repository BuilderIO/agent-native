import { describe, expect, it } from "vitest";

import { assertDatabaseWidgetWriteTarget } from "./_database-row-mutation.js";

describe("Content database widget write scope", () => {
  const context = {
    caller: "mcp-widget-write" as const,
    mcpDirectoryWidgetWrite: {
      appId: "content",
      resourceIds: {
        databaseId: "database-123",
        databaseDocumentId: "database-document-123",
        spaceId: "space-123",
      },
      actionNames: ["add-database-item", "update-database-item"],
    },
  };
  const target = {
    databaseId: "database-123",
    databaseDocumentId: "database-document-123",
    spaceId: "space-123",
  };

  it("allows the collection bound to the widget", () => {
    expect(() =>
      assertDatabaseWidgetWriteTarget(target, context),
    ).not.toThrow();
  });

  it("rejects a collection, backing page, or space outside the grant", () => {
    for (const changed of [
      { ...target, databaseId: "database-elsewhere" },
      { ...target, databaseDocumentId: "database-document-elsewhere" },
      { ...target, spaceId: "space-elsewhere" },
    ]) {
      expect(() => assertDatabaseWidgetWriteTarget(changed, context)).toThrow(
        "This widget write capability is scoped to a different Content collection.",
      );
    }
  });

  it("keeps ordinary editor requests on their existing authorization path", () => {
    expect(() =>
      assertDatabaseWidgetWriteTarget(target, undefined),
    ).not.toThrow();
  });
});
