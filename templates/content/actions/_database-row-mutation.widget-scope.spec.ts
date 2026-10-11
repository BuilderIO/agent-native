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
      assertDatabaseWidgetWriteTarget(target, "add-database-item", context),
    ).not.toThrow();
  });

  it("rejects a collection, backing page, or space outside the grant", () => {
    for (const changed of [
      { ...target, databaseId: "database-elsewhere" },
      { ...target, databaseDocumentId: "database-document-elsewhere" },
      { ...target, spaceId: "space-elsewhere" },
    ]) {
      expect(() =>
        assertDatabaseWidgetWriteTarget(changed, "add-database-item", context),
      ).toThrow(
        "This Content widget write capability is missing or scoped to a different collection or action.",
      );
    }
  });

  it("fails closed when the write grant is missing or does not include the action", () => {
    expect(() =>
      assertDatabaseWidgetWriteTarget(target, "add-database-item", {
        caller: "mcp-widget-write",
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "mcp_widget_write_scope_mismatch",
        statusCode: 403,
      }),
    );
    expect(() =>
      assertDatabaseWidgetWriteTarget(target, "add-database-item", {
        ...context,
        mcpDirectoryWidgetWrite: {
          ...context.mcpDirectoryWidgetWrite,
          actionNames: ["update-database-item"],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "mcp_widget_write_scope_mismatch",
        statusCode: 403,
      }),
    );
  });

  it("keeps ordinary editor requests on their existing authorization path", () => {
    expect(() =>
      assertDatabaseWidgetWriteTarget(target, "add-database-item", undefined),
    ).not.toThrow();
  });
});
