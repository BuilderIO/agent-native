import { describe, expect, it, vi } from "vitest";

import {
  allowsMcpDirectoryWidgetReadAction,
  createMcpDirectoryWidgetReadCapability,
  createMcpDirectoryWidgetWriteCapability,
  getMcpDirectoryWidgetWriteCapabilityGrant,
  isExpiredMcpDirectoryWidgetWriteCapability,
  isMcpDirectoryWidgetReadCapabilityScope,
  isMcpDirectoryWidgetWriteCapabilityScope,
  MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX,
  normalizeMcpDirectoryWidgetWriteActionArguments,
  renewMcpDirectoryWidgetCapabilityScope,
} from "./embed-auth.js";

describe("MCP directory widget read capabilities", () => {
  const capability = {
    appId: "design",
    resourceUri: "ui://design/shell-v69",
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
        resourceUri: "ui://design/shell-v69",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "get-design-snapshot",
        appId: "slides",
        resourceUri: "ui://design/shell-v69",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
    const contentScope = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v69",
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
        resourceUri: "ui://content/shell-v69",
        args: { databaseId: "database-123", limit: "100" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: { documentId: "document-123", limit: 5_000 },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: { databaseId: "database-123", documentId: "another-document" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "query-content-database-items",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
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
        resourceUri: "ui://content/shell-v69",
        args: { limit: "50", tableQuery: { search: "launch" } },
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "query-content-database-items",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
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
        resourceUri: "ui://content/shell-v69",
        args: { databaseId: "database-123", limit: "5001" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: { databaseId: "database-123", limit: "100.5" },
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(contentScope, {
        actionName: "get-content-database",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
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
        resourceUri: "ui://design/shell-v69",
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
          resourceUri: "ui://design/shell-v69",
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
          resourceUri: "ui://design/shell-v69",
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
          resourceUri: "ui://design/shell-v69",
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
      resourceUri: "ui://content/shell-v69",
      resourceIds: { documentId: "document-123" },
      actionArguments: { "list-content-spaces": {} },
    });

    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "list-content-spaces",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: {},
        allowedArgumentNames: [],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(scope, {
        actionName: "list-content-spaces",
        appId: "content",
        resourceUri: "ui://content/shell-v69",
        args: { unexpected: true },
        allowedArgumentNames: [],
      }),
    ).toBe(false);
  });
});

describe("MCP directory widget capability renewal", () => {
  const widget = {
    appId: "design",
    resourceUri: "ui://design/shell-v69",
    resourceIds: { designId: "design-123" },
    userEmail: "reviewer@example.com",
    expiresAtMs: Date.now() + 60_000,
    readActionArguments: {
      "get-design-snapshot": { designId: "design-123" },
    },
    writeActionArguments: {
      "update-design": {
        id: "design-123",
        content: { type: "actionSchema" as const },
      },
    },
  };

  it("downgrades a saved widget to read-only when renewed without mcp:write", () => {
    const sourceScope = createMcpDirectoryWidgetWriteCapability(widget);
    expect(sourceScope).toBeDefined();

    const renewedScope = renewMcpDirectoryWidgetCapabilityScope(sourceScope, {
      appId: widget.appId,
      resourceUri: widget.resourceUri,
      userEmail: widget.userEmail,
      expiresAtMs: Date.now() + 60_000,
      readAllowed: true,
      writeAllowed: false,
    });

    expect(renewedScope).toContain(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX);
    expect(isMcpDirectoryWidgetWriteCapabilityScope(renewedScope)).toBe(false);
    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(renewedScope, {
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        userEmail: widget.userEmail,
      }),
    ).toBeUndefined();
    expect(
      allowsMcpDirectoryWidgetReadAction(renewedScope, {
        actionName: "get-design-snapshot",
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(true);
  });

  it("does not renew widget capabilities when the caller lacks mcp:read", () => {
    const sourceScope = createMcpDirectoryWidgetWriteCapability(widget);

    expect(
      renewMcpDirectoryWidgetCapabilityScope(sourceScope, {
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        userEmail: widget.userEmail,
        expiresAtMs: Date.now() + 60_000,
        readAllowed: false,
        writeAllowed: true,
      }),
    ).toBeUndefined();
  });

  it("rebinds a stale write capability to the current shared widget resource", () => {
    const staleScope = createMcpDirectoryWidgetWriteCapability({
      ...widget,
      resourceUri: "ui://design/shell-v68",
    });
    expect(staleScope).toBeDefined();

    const renewedScope = renewMcpDirectoryWidgetCapabilityScope(staleScope, {
      appId: widget.appId,
      resourceUri: widget.resourceUri,
      userEmail: widget.userEmail,
      expiresAtMs: Date.now() + 60_000,
      readAllowed: true,
      writeAllowed: true,
    });

    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(renewedScope, {
        appId: widget.appId,
        resourceUri: "ui://design/shell-v68",
        userEmail: widget.userEmail,
      }),
    ).toBeUndefined();
    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(renewedScope, {
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        userEmail: widget.userEmail,
      }),
    ).toEqual({
      resourceIds: widget.resourceIds,
      actionNames: ["update-design"],
    });
  });

  it("rebinds a stale read capability without broadening its resource or actions", () => {
    const staleScope = createMcpDirectoryWidgetReadCapability({
      appId: widget.appId,
      resourceUri: "ui://design/shell-v68",
      resourceIds: widget.resourceIds,
      actionArguments: widget.readActionArguments,
    });
    expect(staleScope).toBeDefined();

    const renewedScope = renewMcpDirectoryWidgetCapabilityScope(staleScope, {
      appId: widget.appId,
      resourceUri: widget.resourceUri,
      userEmail: widget.userEmail,
      expiresAtMs: Date.now() + 60_000,
      readAllowed: true,
      writeAllowed: false,
    });

    expect(
      allowsMcpDirectoryWidgetReadAction(renewedScope, {
        actionName: "get-design-snapshot",
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(renewedScope, {
        actionName: "get-design-snapshot",
        appId: widget.appId,
        resourceUri: "ui://design/shell-v68",
        args: { designId: "design-123" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(renewedScope, {
        actionName: "get-design-snapshot",
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        args: { designId: "different-design" },
        allowedArgumentNames: ["designId"],
      }),
    ).toBe(false);
    expect(
      allowsMcpDirectoryWidgetReadAction(renewedScope, {
        actionName: "update-design",
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        args: { id: "design-123" },
        allowedArgumentNames: ["id"],
      }),
    ).toBe(false);
  });
});

describe("MCP directory widget write capabilities", () => {
  const input = () => ({
    appId: "design",
    resourceUri: "ui://design/shell-v69",
    resourceIds: { designId: "design-123" },
    userEmail: "reviewer@example.test",
    orgId: "org-123",
    expiresAtMs: Date.now() + 60_000,
    readActionArguments: {
      "get-design-snapshot": { designId: "design-123" },
    },
    writeActionArguments: {
      "update-design": {
        designId: "design-123",
        operations: { type: "actionSchema" },
      },
    },
  });

  it("binds each editor mutation to one user, workspace, artifact, and action", () => {
    const grant = input();
    const scope = createMcpDirectoryWidgetWriteCapability(grant);
    expect(scope).toContain(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX);
    const args = {
      designId: "design-123",
      operations: [{ op: "set_text", elementId: "headline", text: "Hello" }],
    };
    const normalize = (overrides: Record<string, unknown> = {}) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
        actionName: "update-design",
        appId: "design",
        resourceUri: "ui://design/shell-v69",
        userEmail: "REVIEWER@example.test",
        orgId: "org-123",
        args,
        allowedArgumentNames: ["designId", "operations"],
        ...overrides,
      });

    expect(normalize()).toEqual(args);
    expect(normalize({ appId: "slides" })).toBeUndefined();
    expect(normalize({ resourceUri: "ui://design/shell-v67" })).toBeUndefined();
    expect(normalize({ userEmail: "other@example.test" })).toBeUndefined();
    expect(normalize({ orgId: "another-org" })).toBeUndefined();
    expect(normalize({ orgId: undefined })).toBeUndefined();
    expect(normalize({ actionName: "delete-design" })).toBeUndefined();
    expect(
      normalize({
        allowedArgumentNames: ["designId", "operations", "otherDesignId"],
        args: { ...args, otherDesignId: "design-elsewhere" },
      }),
    ).toBeUndefined();
    expect(
      normalize({
        args: { ...args, designId: "design-elsewhere" },
      }),
    ).toBeUndefined();
  });

  it("retains resource-bound schema fields and rejects arguments outside the grant", () => {
    const grant = {
      ...input(),
      writeActionArguments: {
        "update-file": {
          id: {
            type: "actionSchemaResourceBound" as const,
            resourceKey: "designId",
          },
          content: { type: "actionSchema" as const },
        },
      },
    };
    const scope = createMcpDirectoryWidgetWriteCapability(grant);
    expect(scope).toContain(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX);

    const normalize = (args: Record<string, unknown>) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
        actionName: "update-file",
        appId: grant.appId,
        resourceUri: grant.resourceUri,
        userEmail: grant.userEmail,
        orgId: grant.orgId,
        args,
        allowedArgumentNames: ["content", "id"],
      });
    const fileUpdate = { id: "file-in-design", content: "<html />" };

    expect(normalize(fileUpdate)).toEqual(fileUpdate);
    expect(
      normalize({ ...fileUpdate, designId: "design-elsewhere" }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetWriteCapability({
        ...grant,
        resourceIds: {},
      }),
    ).toBeUndefined();
  });

  it("fails closed after expiry and rejects grants with an invalid lifetime", () => {
    const expired = createMcpDirectoryWidgetWriteCapability({
      ...input(),
      expiresAtMs: Date.now() - 1,
    });
    const tooLong = createMcpDirectoryWidgetWriteCapability({
      ...input(),
      expiresAtMs: Date.now() + 24 * 60 * 60 * 1000 + 1,
    });
    expect(expired).toBeUndefined();
    expect(tooLong).toBeUndefined();

    const grant = input();
    const scope = createMcpDirectoryWidgetWriteCapability(grant);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(grant.expiresAtMs + 1);
      expect(
        normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
          actionName: "update-design",
          appId: "design",
          resourceUri: "ui://design/shell-v69",
          userEmail: grant.userEmail,
          orgId: grant.orgId,
          args: {
            designId: "design-123",
            operations: [
              { op: "set_text", elementId: "headline", text: "Hello" },
            ],
          },
          allowedArgumentNames: ["designId", "operations"],
        }),
      ).toBeUndefined();
      expect(
        isExpiredMcpDirectoryWidgetWriteCapability(scope, {
          appId: "design",
          resourceUri: "ui://design/shell-v69",
          userEmail: "reviewer@example.test",
          orgId: "org-123",
        }),
      ).toBe(true);
      expect(
        isExpiredMcpDirectoryWidgetWriteCapability(scope, {
          appId: "slides",
          resourceUri: "ui://design/shell-v69",
          userEmail: "reviewer@example.test",
          orgId: "org-123",
        }),
      ).toBe(false);
      expect(
        isExpiredMcpDirectoryWidgetWriteCapability(scope, {
          appId: "design",
          resourceUri: "ui://design/shell-v69",
          userEmail: "other@example.test",
          orgId: "org-123",
        }),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mint a write grant without a server-bound artifact id", () => {
    expect(
      createMcpDirectoryWidgetWriteCapability({
        ...input(),
        writeActionArguments: {
          "update-design": { operations: { type: "actionSchema" } },
        },
      }),
    ).toBeUndefined();
  });
});
