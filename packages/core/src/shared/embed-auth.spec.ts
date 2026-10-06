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
    resourceUri: "ui://design/shell-v67",
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
        resourceUri: "ui://design/shell-v67",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "get-design-snapshot",
        appId: "slides",
        resourceUri: "ui://design/shell-v67",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
    const contentScope = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v67",
      resourceIds: { databaseId: "database-123", documentId: "document-123" },
      actionArguments: {
        "get-content-database": {
          databaseId: "database-123",
          documentId: "document-123",
        },
      },
    });
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v67",
        args: { databaseId: "database-123" },
        allowedArgumentNames: ["databaseId", "documentId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v67",
        args: { documentId: "document-123" },
        allowedArgumentNames: ["databaseId", "documentId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v67",
        args: { databaseId: "database-123", documentId: "another-document" },
        allowedArgumentNames: ["databaseId", "documentId"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v67",
        args: { databaseId: "database-123", includeRows: "all" },
        allowedArgumentNames: ["databaseId", "documentId"],
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
        resourceUri: "ui://design/shell-v67",
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
      allowsMcpDirectoryWidgetReadAction(
        `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}%7Bmalformed`,
        {
          actionName: "get-design-snapshot",
          appId: "design",
          resourceUri: "ui://design/shell-v67",
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
          resourceUri: "ui://design/shell-v67",
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
          resourceUri: "ui://design/shell-v67",
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
});
