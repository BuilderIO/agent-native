import { describe, expect, it } from "vitest";

import {
  allowsMcpDirectoryWidgetReadAction,
  createMcpDirectoryWidgetReadCapability,
  isMcpDirectoryWidgetReadCapabilityScope,
  MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX,
} from "./embed-auth.js";

describe("MCP directory widget read capabilities", () => {
  const capability = {
    appId: "design",
    resourceUri: "ui://design/shell-v68",
    resourceIds: { designId: "design-123" },
    actionArguments: {
      "get-design-snapshot": { designId: "design-123" },
    },
  };

  it("binds read actions to one app, widget resource, and record", () => {
    const scope = createMcpDirectoryWidgetReadCapability(capability);

    expect(scope).toContain(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "get-design-snapshot",
        appId: "design",
        resourceUri: "ui://design/shell-v68",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "get-design-snapshot",
        appId: "slides",
        resourceUri: "ui://design/shell-v68",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
    const contentScope = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v68",
      resourceIds: { databaseId: "database-123", documentId: "document-123" },
      actionArguments: {
        "get-content-database": {
          databaseId: "database-123",
          documentId: "document-123",
          limit: { type: "integerRange", min: 0, max: 5_000 },
        },
        "query-content-database-items": {
          documentId: "document-123",
          limit: { type: "integerRange", min: 1, max: 5_000 },
          tableQuery: { type: "actionSchema" },
        },
      },
    });
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { databaseId: "database-123", limit: "100" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { documentId: "document-123", limit: 5_000 },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { databaseId: "database-123", documentId: "another-document" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "query-content-database-items",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: {
          documentId: "document-123",
          limit: "50",
          tableQuery: { search: "launch" },
        },
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "query-content-database-items",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { limit: "50", tableQuery: { search: "launch" } },
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "query-content-database-items",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: {
          documentId: "document-123",
          limit: "50",
          tableQuery: { search: "launch" },
          navigation: { parentId: null },
        },
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { databaseId: "database-123", limit: "5001" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { databaseId: "database-123", limit: "100.5" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { databaseId: "database-123", limit: "-1" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "get-design-snapshot",
        appId: "design",
        resourceUri: "ui://design/shell-v65",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "get-design-snapshot",
        appId: "design",
        resourceUri: "ui://design/shell-v68",
        args: { designId: "different-design" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
  });

  it("fails closed for malformed, incomplete, and oversized scopes", () => {
    expect(
      createMcpDirectoryWidgetReadCapability({
        ...capability,
        actionArguments: {},
      }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetReadCapability({
        ...capability,
        actionArguments: {
          "get-design-snapshot": {
            designId: "design-123",
            filters: { type: "actionSchema", allowAll: true },
          },
        },
      }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetReadCapability({
        ...capability,
        appId: "../design",
      }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetReadCapability({
        ...capability,
        resourceIds: { designId: "" },
      }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetReadCapability({
        ...capability,
        actionArguments: {
          "get-design-snapshot": {
            designId: "design-123",
            limit: { type: "integerRange", min: 0, max: 5_001 },
          },
        },
      }),
    ).toBeUndefined();
    expect(
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}%7Bmalformed`,
        {
          actionName: "get-design-snapshot",
          appId: "design",
          resourceUri: "ui://design/shell-v68",
          args: { designId: "design-123" },
          allowedArgumentNames: ["designId"],
        },
      ),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}%E0%A4%A`,
        {
          actionName: "get-design-snapshot",
          appId: "design",
          resourceUri: "ui://design/shell-v68",
          args: { designId: "design-123" },
          allowedArgumentNames: ["designId"],
        },
      ),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}${"a".repeat(2100)}`,
        {
          actionName: "get-design-snapshot",
          appId: "design",
          resourceUri: "ui://design/shell-v68",
          args: { designId: "design-123" },
          allowedArgumentNames: ["designId"],
        },
      ),
    ).toBe(false);
    expect(
      isMcpDirectoryWidgetReadCapabilityScope(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}malformed`,
      ),
    ).toBe(true);
  });

  it("supports an explicitly scoped read action with no input arguments", () => {
    const scope = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v68",
      resourceIds: { documentId: "document-123" },
      actionArguments: { "list-content-spaces": {} },
    });

    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "list-content-spaces",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: {},
        allowedArgumentNames: [],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "list-content-spaces",
        appId: "content",
        resourceUri: "ui://content/shell-v68",
        args: { unexpected: true },
        allowedArgumentNames: [],
      }),
    ).toBe(false);
  });
});
