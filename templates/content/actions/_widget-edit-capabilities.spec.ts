import { describe, expect, it } from "vitest";

import { contentWidgetEditCapabilities } from "./_widget-edit-capabilities.js";

describe("contentWidgetEditCapabilities", () => {
  const widgetReadContext = {
    caller: "mcp-widget" as const,
    mcpDirectoryWidgetReadOnly: true as const,
    mcpDirectoryWidgetWrite: {
      appId: "content",
      resourceIds: {
        documentId: "document-1",
        spaceId: "space-1",
      },
      actionNames: ["update-document"],
    },
  };

  it("allows body editing only for the exact document with update permission", () => {
    expect(
      contentWidgetEditCapabilities(widgetReadContext, {
        id: "document-1",
        spaceId: "space-1",
      }),
    ).toEqual({ canEditDocument: true, canEditDatabaseRows: false });
    expect(
      contentWidgetEditCapabilities(widgetReadContext, {
        id: "document-2",
        spaceId: "space-1",
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
  });

  it("allows row edits only for the exact granted collection and keeps its page read-only", () => {
    const context = {
      ...widgetReadContext,
      mcpDirectoryWidgetWrite: {
        appId: "content",
        resourceIds: {
          databaseId: "database-1",
          databaseDocumentId: "document-1",
          documentId: "document-1",
          spaceId: "space-1",
        },
        actionNames: ["add-database-item", "update-database-item"],
      },
    };

    expect(
      contentWidgetEditCapabilities(context, {
        id: "document-1",
        spaceId: "space-1",
        databaseId: "database-1",
        databaseDocumentId: "document-1",
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: true });
    expect(
      contentWidgetEditCapabilities(context, {
        id: "document-1",
        spaceId: "space-1",
        databaseId: "database-2",
        databaseDocumentId: "document-1",
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
  });

  it("does not expose row editing when the grant has no authoritative space", () => {
    const context = {
      ...widgetReadContext,
      mcpDirectoryWidgetWrite: {
        appId: "content",
        resourceIds: {
          databaseId: "database-1",
          databaseDocumentId: "document-1",
          documentId: "document-1",
        },
        actionNames: ["add-database-item", "update-database-item"],
      },
    };

    expect(
      contentWidgetEditCapabilities(context, {
        id: "document-1",
        spaceId: "space-1",
        databaseId: "database-1",
        databaseDocumentId: "document-1",
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
  });

  it("keeps an exact document write grant usable without a space ID", () => {
    const context = {
      ...widgetReadContext,
      mcpDirectoryWidgetWrite: {
        appId: "content",
        resourceIds: { documentId: "document-1" },
        actionNames: ["update-document"],
      },
    };

    expect(
      contentWidgetEditCapabilities(context, {
        id: "document-1",
        spaceId: "space-1",
      }),
    ).toEqual({ canEditDocument: true, canEditDatabaseRows: false });
  });

  it("does not enable editing for read-only tickets or another app", () => {
    expect(
      contentWidgetEditCapabilities(
        { caller: "mcp-widget", mcpDirectoryWidgetReadOnly: true },
        { id: "document-1", spaceId: "space-1" },
      ),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
    expect(
      contentWidgetEditCapabilities(
        {
          ...widgetReadContext,
          mcpDirectoryWidgetWrite: {
            ...widgetReadContext.mcpDirectoryWidgetWrite,
            appId: "slides",
          },
        },
        { id: "document-1", spaceId: "space-1" },
      ),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
  });
});
