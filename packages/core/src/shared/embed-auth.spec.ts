import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowsMcpDirectoryWidgetReadAction,
  canRenewMcpDirectoryWidgetCapabilityScope,
  createMcpDirectoryWidgetReadCapability,
  createMcpDirectoryWidgetWriteCapability,
  getMcpDirectoryWidgetWriteCapabilityExpiresAt,
  getMcpDirectoryWidgetWriteCapabilityGrant,
  isExpiredMcpDirectoryWidgetWriteCapability,
  isMcpDirectoryWidgetReadCapabilityScope,
  isMcpDirectoryWidgetWriteCapabilityScope,
  matchesMcpDirectoryWidgetWriteCapability,
  MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH,
  MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_AGE_MS,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX,
  normalizeMcpDirectoryWidgetReadActionArguments,
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

  it("requires every literal-bound argument to be supplied and equal", () => {
    const grant = {
      ...input(),
      resourceIds: { designId: "design-123", resourceType: "design" },
      writeActionArguments: {
        "share-design": {
          resourceType: "design",
          resourceId: "design-123",
          role: { type: "actionSchema" as const },
        },
      },
    };
    const scope = createMcpDirectoryWidgetWriteCapability(grant);
    expect(scope).toBeDefined();
    const normalize = (args: Record<string, unknown>) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
        actionName: "share-design",
        appId: grant.appId,
        resourceUri: grant.resourceUri,
        userEmail: grant.userEmail,
        orgId: grant.orgId,
        args,
        allowedArgumentNames: ["resourceType", "resourceId", "role"],
      });
    const bound = {
      resourceType: "design",
      resourceId: "design-123",
      role: "viewer",
    };

    expect(normalize(bound)).toEqual(bound);
    expect(normalize({ ...bound, resourceId: undefined })).toBeUndefined();
    expect(
      normalize({ resourceType: "design", role: "viewer" }),
    ).toBeUndefined();
    expect(
      normalize({ resourceId: "design-123", role: "viewer" }),
    ).toBeUndefined();
    expect(normalize({ role: "viewer" })).toBeUndefined();
    expect(normalize({ ...bound, resourceType: "form" })).toBeUndefined();
    expect(normalize({ ...bound, resourceId: "design-456" })).toBeUndefined();
  });
});

describe("MCP directory widget document share capabilities", () => {
  const widget = {
    appId: "content",
    resourceUri: "ui://content/shell-v69",
    userEmail: "editor@example.test",
    orgId: "org-123",
  };
  const documentId = "doc-123";
  const shareArguments = {
    "share-resource": {
      resourceType: "document",
      resourceId: documentId,
      principalType: { type: "actionSchema" as const },
      principalId: { type: "actionSchema" as const },
      role: { type: "actionSchema" as const },
      notify: { type: "actionSchema" as const },
      resourceUrl: { type: "actionSchema" as const },
      message: { type: "actionSchema" as const },
    },
    "unshare-resource": {
      resourceType: "document",
      resourceId: documentId,
      principalType: { type: "actionSchema" as const },
      principalId: { type: "actionSchema" as const },
    },
    "set-resource-visibility": {
      resourceType: "document",
      resourceId: documentId,
      visibility: { type: "actionSchema" as const },
    },
  };
  const readArguments = {
    "list-resource-shares": {
      resourceType: "document",
      resourceId: documentId,
    },
  };
  const writeScope = () =>
    createMcpDirectoryWidgetWriteCapability({
      ...widget,
      resourceIds: { documentId, resourceType: "document" },
      expiresAtMs: Date.now() + 60_000,
      readActionArguments: readArguments,
      writeActionArguments: {
        "update-document": {
          id: documentId,
          title: { type: "actionSchema" },
        },
        ...shareArguments,
      },
    });
  const bodies: Record<keyof typeof shareArguments, Record<string, unknown>> = {
    "share-resource": {
      resourceType: "document",
      resourceId: documentId,
      principalType: "user",
      principalId: "teammate@example.test",
      role: "viewer",
      notify: false,
      resourceUrl: "/page/doc-123",
      message: "Take a look",
    },
    "unshare-resource": {
      resourceType: "document",
      resourceId: documentId,
      principalType: "user",
      principalId: "teammate@example.test",
    },
    "set-resource-visibility": {
      resourceType: "document",
      resourceId: documentId,
      visibility: "org",
    },
  };
  const shareActions = Object.keys(bodies) as Array<keyof typeof bodies>;
  const normalize = (
    scope: string | undefined,
    actionName: string,
    args: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) =>
    normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
      actionName,
      ...widget,
      args,
      allowedArgumentNames: Object.keys(
        bodies[actionName as keyof typeof bodies] ?? args,
      ),
      ...overrides,
    });

  it("keeps the 15 minute grant lifetime", () => {
    expect(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_AGE_MS).toBe(
      15 * 60 * 1000,
    );
    const mint = (lifetimeMs: number) =>
      createMcpDirectoryWidgetWriteCapability({
        ...widget,
        resourceIds: { documentId, resourceType: "document" },
        expiresAtMs: Date.now() + lifetimeMs,
        readActionArguments: readArguments,
        writeActionArguments: shareArguments,
      });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_800_000_000_000);
      expect(mint(15 * 60 * 1000)).toBeDefined();
      expect(mint(15 * 60 * 1000 + 1)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(shareActions)(
    "binds %s to the ticketed document and nothing else",
    (actionName) => {
      const scope = writeScope();
      const body = bodies[actionName];

      expect(normalize(scope, actionName, body)).toEqual(body);
      expect(
        normalize(scope, actionName, { ...body, resourceId: "doc-456" }),
      ).toBeUndefined();
      expect(
        normalize(scope, actionName, { ...body, resourceType: "form" }),
      ).toBeUndefined();
      const { resourceId: _resourceId, ...withoutResourceId } = body;
      expect(normalize(scope, actionName, withoutResourceId)).toBeUndefined();
      const { resourceType: _resourceType, ...withoutResourceType } = body;
      expect(normalize(scope, actionName, withoutResourceType)).toBeUndefined();
      const {
        resourceId: _id,
        resourceType: _type,
        ...withoutResourceBinding
      } = body;
      expect(
        normalize(scope, actionName, withoutResourceBinding),
      ).toBeUndefined();
      expect(
        normalize(scope, actionName, {
          ...body,
          ownerEmail: "me@example.test",
        }),
      ).toBeUndefined();
    },
  );

  it("rejects actions outside the share allowlist", () => {
    const scope = writeScope();
    for (const actionName of [
      "delete-document",
      "set-document-discoverability",
      "list-resource-access-requests",
      "approve-resource-access-request",
      "create-agent-resource-link",
    ]) {
      const args = { resourceType: "document", resourceId: documentId };
      expect(
        normalize(scope, actionName, args, {
          allowedArgumentNames: Object.keys(args),
        }),
      ).toBeUndefined();
    }
    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(
        scope,
        widget,
      )?.actionNames.sort(),
    ).toEqual([
      "set-resource-visibility",
      "share-resource",
      "unshare-resource",
      "update-document",
    ]);
  });

  it.each(shareActions)(
    "rejects %s for another user, organization, app, or widget resource",
    (actionName) => {
      const scope = writeScope();
      const body = bodies[actionName];

      expect(normalize(scope, actionName, body)).toEqual(body);
      expect(
        normalize(scope, actionName, body, { userEmail: "other@example.test" }),
      ).toBeUndefined();
      expect(
        normalize(scope, actionName, body, { orgId: "org-other" }),
      ).toBeUndefined();
      expect(
        normalize(scope, actionName, body, { orgId: undefined }),
      ).toBeUndefined();
      expect(
        normalize(scope, actionName, body, { appId: "design" }),
      ).toBeUndefined();
      expect(
        normalize(scope, actionName, body, {
          resourceUri: "ui://content/shell-v68",
        }),
      ).toBeUndefined();
    },
  );

  it("gives a read-only capability no share write route", () => {
    const readScope = createMcpDirectoryWidgetReadCapability({
      appId: widget.appId,
      resourceUri: widget.resourceUri,
      resourceIds: { documentId, resourceType: "document" },
      actionArguments: readArguments,
    });

    for (const actionName of shareActions) {
      expect(
        normalize(readScope, actionName, bodies[actionName]),
      ).toBeUndefined();
    }
    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(readScope, widget),
    ).toBeUndefined();
    expect(
      allowsMcpDirectoryWidgetReadAction(readScope, {
        actionName: "list-resource-shares",
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        args: { resourceType: "document", resourceId: documentId },
        allowedArgumentNames: ["resourceType", "resourceId"],
      }),
    ).toBe(true);
    expect(
      allowsMcpDirectoryWidgetReadAction(readScope, {
        actionName: "list-resource-shares",
        appId: widget.appId,
        resourceUri: widget.resourceUri,
        args: { resourceType: "document", resourceId: "doc-456" },
        allowedArgumentNames: ["resourceType", "resourceId"],
      }),
    ).toBe(false);
  });

  it("downgrades the share grant to read-only when renewed without mcp:write", () => {
    const renewed = renewMcpDirectoryWidgetCapabilityScope(writeScope(), {
      ...widget,
      expiresAtMs: Date.now() + 60_000,
      readAllowed: true,
      writeAllowed: false,
    });

    expect(isMcpDirectoryWidgetWriteCapabilityScope(renewed)).toBe(false);
    for (const actionName of shareActions) {
      expect(
        normalize(renewed, actionName, bodies[actionName]),
      ).toBeUndefined();
    }
  });
});

describe("MCP directory widget capability wire format", () => {
  const READ_PREFIX = MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX;
  const WRITE_PREFIX = MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX;
  const DOCUMENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const DATABASE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const RESOURCE_URI = "ui://content/shell-v66";
  const actionSchema = { type: "actionSchema" as const };
  const identity = { userEmail: "editor@example.test", orgId: "org-1" };

  // The pre-compaction encoder: URI-encoded JSON, always starting `%7B`.
  const legacyScope = (prefix: string, wire: unknown) =>
    prefix + encodeURIComponent(JSON.stringify(wire));
  const base64UrlScope = (prefix: string, wire: unknown) =>
    prefix + Buffer.from(JSON.stringify(wire)).toString("base64url");
  const wireOf = (scope: string, prefix: string) =>
    JSON.parse(
      Buffer.from(scope.slice(prefix.length), "base64url").toString("utf8"),
    );

  const readGrant = () => ({
    appId: "content",
    resourceUri: RESOURCE_URI,
    resourceIds: {
      databaseId: DATABASE_ID,
      documentId: DOCUMENT_ID,
      resourceType: "document",
    },
    actionArguments: {
      "get-document": { id: DOCUMENT_ID },
      "list-resource-shares": {
        resourceId: DOCUMENT_ID,
        resourceType: "document",
      },
      "get-content-database": {
        databaseId: DATABASE_ID,
        documentId: DOCUMENT_ID,
        limit: { type: "integerRange" as const, min: 0, max: 5_000 },
      },
      "query-content-database-items": {
        documentId: DOCUMENT_ID,
        limit: { type: "integerRange" as const, min: 1, max: 5_000 },
        tableQuery: actionSchema,
      },
    },
  });
  const writeGrant = () => {
    const { actionArguments, ...read } = readGrant();
    return {
      ...read,
      ...identity,
      expiresAtMs: Date.now() + 10 * 60_000,
      readActionArguments: actionArguments,
      writeActionArguments: {
        "update-document": {
          id: DOCUMENT_ID,
          title: actionSchema,
          content: actionSchema,
        },
        "share-resource": {
          resourceType: "document",
          resourceId: DOCUMENT_ID,
          role: actionSchema,
        },
        "add-database-item": {
          target: {
            type: "actionSchemaResourceBound" as const,
            resourceKey: "databaseId",
          },
          title: actionSchema,
        },
      },
    };
  };

  const normalizeRead = (
    scope: string,
    actionName: string,
    allowedArgumentNames: string[],
    args: Record<string, unknown>,
  ) =>
    normalizeMcpDirectoryWidgetReadActionArguments(scope, {
      actionName,
      appId: "content",
      resourceUri: RESOURCE_URI,
      args,
      allowedArgumentNames,
    });
  const normalizeWrite = (
    scope: string,
    actionName: string,
    allowedArgumentNames: string[],
    args: Record<string, unknown>,
  ) =>
    normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
      actionName,
      appId: "content",
      resourceUri: RESOURCE_URI,
      ...identity,
      args,
      allowedArgumentNames,
    });

  it("emits base64url payloads with compact argument markers", () => {
    const writeScope = createMcpDirectoryWidgetWriteCapability(writeGrant())!;
    const readScope = createMcpDirectoryWidgetReadCapability(readGrant())!;

    for (const [scope, prefix] of [
      [writeScope, WRITE_PREFIX],
      [readScope, READ_PREFIX],
    ] as const) {
      expect(scope.startsWith(prefix)).toBe(true);
      expect(scope.slice(prefix.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(writeScope.length).toBeLessThan(
      legacyScope(WRITE_PREFIX, writeGrant()).length,
    );

    const write = wireOf(writeScope, WRITE_PREFIX);
    expect(write.resourceIds).toEqual(writeGrant().resourceIds);
    expect(write.writeActionArguments).toEqual({
      "update-document": { id: ["documentId"], title: 0, content: 0 },
      // `"document"` is shorter than `["resourceType"]`, so it stays literal.
      "share-resource": {
        resourceType: "document",
        resourceId: ["documentId"],
        role: 0,
      },
      "add-database-item": {
        target: {
          type: "actionSchemaResourceBound",
          resourceKey: "databaseId",
        },
        title: 0,
      },
    });
    expect(write.readActionArguments["get-content-database"]).toEqual({
      databaseId: ["databaseId"],
      documentId: ["documentId"],
      limit: { type: "integerRange", min: 0, max: 5_000 },
    });
    expect(
      wireOf(readScope, READ_PREFIX).actionArguments[
        "query-content-database-items"
      ],
    ).toEqual({
      documentId: ["documentId"],
      limit: { type: "integerRange", min: 1, max: 5_000 },
      tableQuery: 0,
    });
  });

  it("keeps a literal when a reference would not be shorter and references the first sorted key otherwise", () => {
    const shortIds = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: RESOURCE_URI,
      resourceIds: { documentId: "doc-1" },
      actionArguments: { "get-document": { id: "doc-1" } },
    })!;
    expect(wireOf(shortIds, READ_PREFIX).actionArguments).toEqual({
      "get-document": { id: "doc-1" },
    });

    const aliased = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: RESOURCE_URI,
      resourceIds: { zebraId: DOCUMENT_ID, alphaId: DOCUMENT_ID },
      actionArguments: { "get-document": { id: DOCUMENT_ID } },
    })!;
    expect(wireOf(aliased, READ_PREFIX).actionArguments).toEqual({
      "get-document": { id: ["alphaId"] },
    });
    expect(
      normalizeRead(aliased, "get-document", ["id"], { id: DOCUMENT_ID }),
    ).toEqual({ id: DOCUMENT_ID });
  });

  it("decodes both wire forms to the same read capability", () => {
    const grant = readGrant();
    const compact = createMcpDirectoryWidgetReadCapability(grant)!;
    const legacy = legacyScope(READ_PREFIX, { version: 1, ...grant });
    const renew = (scope: string) =>
      renewMcpDirectoryWidgetCapabilityScope(scope, {
        appId: grant.appId,
        resourceUri: grant.resourceUri,
        userEmail: identity.userEmail,
        expiresAtMs: Date.now() + 60_000,
        readAllowed: true,
        writeAllowed: false,
      });

    // Re-encoding is deterministic, so identical output means the decoded
    // structure deep-equals the original grant for either wire form.
    expect(renew(compact)).toBe(compact);
    expect(renew(legacy)).toBe(compact);
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(legacy, compact, identity),
    ).toBe(true);
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(
        legacy,
        createMcpDirectoryWidgetReadCapability({
          ...grant,
          actionArguments: {
            ...grant.actionArguments,
            "get-document": { id: "another-document" },
          },
        })!,
        identity,
      ),
    ).toBe(false);

    const cases: Array<{
      actionName: string;
      allowedArgumentNames: string[];
      args: Record<string, unknown>;
      expected: Record<string, unknown> | undefined;
    }> = [
      {
        actionName: "get-document",
        allowedArgumentNames: ["id"],
        args: { id: DOCUMENT_ID },
        expected: { id: DOCUMENT_ID },
      },
      {
        actionName: "get-document",
        allowedArgumentNames: ["id"],
        args: { id: "another-document" },
        expected: undefined,
      },
      {
        actionName: "list-resource-shares",
        allowedArgumentNames: ["resourceId", "resourceType"],
        args: { resourceId: DOCUMENT_ID, resourceType: "document" },
        expected: { resourceId: DOCUMENT_ID, resourceType: "document" },
      },
      {
        actionName: "list-resource-shares",
        allowedArgumentNames: ["resourceId", "resourceType"],
        args: { resourceId: DOCUMENT_ID, resourceType: "design" },
        expected: undefined,
      },
      {
        actionName: "get-content-database",
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
        args: { databaseId: DATABASE_ID, limit: "100" },
        expected: { databaseId: DATABASE_ID, limit: 100 },
      },
      {
        actionName: "get-content-database",
        allowedArgumentNames: ["databaseId", "documentId", "limit"],
        args: { databaseId: DATABASE_ID, limit: "5001" },
        expected: undefined,
      },
      {
        actionName: "query-content-database-items",
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
        args: {
          documentId: DOCUMENT_ID,
          limit: 50,
          tableQuery: { search: "launch" },
        },
        expected: {
          documentId: DOCUMENT_ID,
          limit: 50,
          tableQuery: { search: "launch" },
        },
      },
      {
        // A schema-bound argument alone never carries the resource binding.
        actionName: "query-content-database-items",
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
        args: { limit: 50, tableQuery: { search: "launch" } },
        expected: undefined,
      },
      {
        actionName: "delete-document",
        allowedArgumentNames: ["id"],
        args: { id: DOCUMENT_ID },
        expected: undefined,
      },
    ];
    for (const { actionName, allowedArgumentNames, args, expected } of cases) {
      for (const scope of [compact, legacy]) {
        expect(
          normalizeRead(scope, actionName, allowedArgumentNames, args),
        ).toEqual(expected);
      }
    }
  });

  it("decodes both wire forms to the same write capability", () => {
    const grant = writeGrant();
    const compact = createMcpDirectoryWidgetWriteCapability(grant)!;
    const legacy = legacyScope(WRITE_PREFIX, { version: 1, ...grant });
    const renew = (scope: string, writeAllowed = true) =>
      renewMcpDirectoryWidgetCapabilityScope(scope, {
        appId: grant.appId,
        resourceUri: grant.resourceUri,
        ...identity,
        expiresAtMs: grant.expiresAtMs,
        readAllowed: true,
        writeAllowed,
      });

    expect(renew(compact)).toBe(compact);
    expect(renew(legacy)).toBe(compact);
    expect(renew(legacy, false)).toBe(renew(compact, false));
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(legacy, compact, identity),
    ).toBe(true);
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(
        legacy,
        createMcpDirectoryWidgetWriteCapability({
          ...grant,
          writeActionArguments: {
            ...grant.writeActionArguments,
            "update-document": { id: DOCUMENT_ID, title: actionSchema },
          },
        })!,
        identity,
      ),
    ).toBe(false);

    for (const scope of [compact, legacy]) {
      const granted = getMcpDirectoryWidgetWriteCapabilityGrant(scope, {
        appId: grant.appId,
        resourceUri: grant.resourceUri,
        ...identity,
      });
      expect(granted?.resourceIds).toEqual(grant.resourceIds);
      expect(granted?.actionNames.toSorted()).toEqual([
        "add-database-item",
        "share-resource",
        "update-document",
      ]);
      expect(getMcpDirectoryWidgetWriteCapabilityExpiresAt(scope)).toBe(
        grant.expiresAtMs,
      );
    }

    const cases: Array<{
      actionName: string;
      allowedArgumentNames: string[];
      args: Record<string, unknown>;
      expected: Record<string, unknown> | undefined;
    }> = [
      {
        actionName: "update-document",
        allowedArgumentNames: ["content", "id", "title"],
        args: { id: DOCUMENT_ID, title: "Renamed", content: "# Body" },
        expected: { id: DOCUMENT_ID, title: "Renamed", content: "# Body" },
      },
      {
        // Another resource id is rejected.
        actionName: "update-document",
        allowedArgumentNames: ["content", "id", "title"],
        args: { id: "another-document", title: "Renamed" },
        expected: undefined,
      },
      {
        // An omitted literal binding is rejected.
        actionName: "update-document",
        allowedArgumentNames: ["content", "id", "title"],
        args: { title: "Renamed" },
        expected: undefined,
      },
      {
        actionName: "share-resource",
        allowedArgumentNames: ["resourceId", "resourceType", "role"],
        args: {
          resourceType: "document",
          resourceId: DOCUMENT_ID,
          role: "viewer",
        },
        expected: {
          resourceType: "document",
          resourceId: DOCUMENT_ID,
          role: "viewer",
        },
      },
      {
        actionName: "share-resource",
        allowedArgumentNames: ["resourceId", "resourceType", "role"],
        args: { resourceId: DOCUMENT_ID, role: "viewer" },
        expected: undefined,
      },
      {
        actionName: "share-resource",
        allowedArgumentNames: ["resourceId", "resourceType", "role"],
        args: { resourceType: "design", resourceId: DOCUMENT_ID },
        expected: undefined,
      },
      {
        actionName: "add-database-item",
        allowedArgumentNames: ["target", "title"],
        args: { target: { databaseId: DATABASE_ID }, title: "Row" },
        expected: { target: { databaseId: DATABASE_ID }, title: "Row" },
      },
      {
        // An unlisted action is rejected.
        actionName: "delete-document",
        allowedArgumentNames: ["id"],
        args: { id: DOCUMENT_ID },
        expected: undefined,
      },
    ];
    for (const { actionName, allowedArgumentNames, args, expected } of cases) {
      for (const scope of [compact, legacy]) {
        expect(
          normalizeWrite(scope, actionName, allowedArgumentNames, args),
        ).toEqual(expected);
      }
    }
  });

  it("round-trips marker-looking string literals as literals", () => {
    const grant = {
      appId: "content",
      resourceUri: RESOURCE_URI,
      resourceIds: { documentId: DOCUMENT_ID },
      actionArguments: {
        "get-document": {
          id: DOCUMENT_ID,
          mode: "0",
          alias: "@documentId",
          reference: '["documentId"]',
        },
      },
    };
    const scope = createMcpDirectoryWidgetReadCapability(grant)!;
    const args = {
      id: DOCUMENT_ID,
      mode: "0",
      alias: "@documentId",
      reference: '["documentId"]',
    };
    const allowedArgumentNames = ["alias", "id", "mode", "reference"];

    expect(wireOf(scope, READ_PREFIX).actionArguments["get-document"]).toEqual({
      id: ["documentId"],
      mode: "0",
      alias: "@documentId",
      reference: '["documentId"]',
    });
    expect(
      normalizeRead(scope, "get-document", allowedArgumentNames, args),
    ).toEqual(args);
    expect(
      normalizeRead(scope, "get-document", allowedArgumentNames, {
        ...args,
        mode: 0,
      }),
    ).toBeUndefined();
    expect(
      normalizeRead(scope, "get-document", allowedArgumentNames, {
        ...args,
        reference: ["documentId"],
      }),
    ).toBeUndefined();

    // A resource id that is itself a marker-looking string survives the trip.
    const markerId = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: RESOURCE_URI,
      resourceIds: { documentId: '["documentId"]' },
      actionArguments: { "get-document": { id: '["documentId"]' } },
    })!;
    expect(
      normalizeRead(markerId, "get-document", ["id"], {
        id: '["documentId"]',
      }),
    ).toEqual({ id: '["documentId"]' });
    expect(
      normalizeRead(markerId, "get-document", ["id"], { id: DOCUMENT_ID }),
    ).toBeUndefined();
  });

  describe("malformed payloads", () => {
    const readWire = (overrides: Record<string, unknown> = {}) => ({
      version: 1,
      appId: "content",
      resourceUri: RESOURCE_URI,
      resourceIds: { documentId: DOCUMENT_ID },
      actionArguments: { "get-document": { id: ["documentId"] } },
      ...overrides,
    });
    const readAllowed = (scope: string) =>
      normalizeRead(scope, "get-document", ["id"], { id: DOCUMENT_ID }) !==
      undefined;
    const writeWire = (overrides: Record<string, unknown> = {}) => ({
      version: 1,
      appId: "content",
      resourceUri: RESOURCE_URI,
      resourceIds: { documentId: DOCUMENT_ID },
      ...identity,
      expiresAtMs: Date.now() + 5 * 60_000,
      readActionArguments: { "get-document": { id: ["documentId"] } },
      writeActionArguments: {
        "update-document": { id: ["documentId"], title: 0 },
      },
      ...overrides,
    });
    const writeAllowed = (scope: string) =>
      getMcpDirectoryWidgetWriteCapabilityGrant(scope, {
        appId: "content",
        resourceUri: RESOURCE_URI,
        ...identity,
      }) !== undefined;

    it("accepts the well-formed control payloads", () => {
      expect(readAllowed(base64UrlScope(READ_PREFIX, readWire()))).toBe(true);
      expect(writeAllowed(base64UrlScope(WRITE_PREFIX, writeWire()))).toBe(
        true,
      );
    });

    it.each([
      ["a reference to a missing resource id", ["missing"]],
      ["an inherited property reference", ["toString"]],
      ["a nested array", [["documentId"]]],
      ["an empty array", []],
      ["a two-element array", ["documentId", "documentId"]],
      ["a non-string reference", [1]],
      ["the number 1", 1],
      ["a negative number", -1],
      ["a fractional number", 0.5],
      ["null", null],
      ["a boolean", true],
    ])("rejects %s as an argument value", (_label, argument) => {
      expect(
        readAllowed(
          base64UrlScope(
            READ_PREFIX,
            readWire({ actionArguments: { "get-document": { id: argument } } }),
          ),
        ),
      ).toBe(false);
      expect(
        writeAllowed(
          base64UrlScope(
            WRITE_PREFIX,
            writeWire({
              writeActionArguments: {
                "update-document": { id: ["documentId"], title: argument },
              },
            }),
          ),
        ),
      ).toBe(false);
    });

    it.each([
      ["a marker for the resourceIds map", { resourceIds: 0 }],
      ["a reference for the resourceIds map", { resourceIds: ["documentId"] }],
      ["a marker as a resource id", { resourceIds: { documentId: 0 } }],
      [
        "a reference as a resource id",
        { resourceIds: { documentId: ["documentId"] } },
      ],
      ["0 as the app id", { appId: 0 }],
      ["a reference as the app id", { appId: ["documentId"] }],
      ["0 as the resource uri", { resourceUri: 0 }],
      ["0 as the version", { version: 0 }],
      ["0 as the argument map", { actionArguments: 0 }],
      [
        "a reference as the argument map",
        { actionArguments: ["get-document"] },
      ],
      [
        "0 as an action's arguments",
        { actionArguments: { "get-document": 0 } },
      ],
      [
        "a reference as an action's arguments",
        { actionArguments: { "get-document": ["id"] } },
      ],
    ])("rejects %s outside an argument value", (_label, overrides) => {
      expect(
        readAllowed(base64UrlScope(READ_PREFIX, readWire(overrides))),
      ).toBe(false);
    });

    it.each([
      ["a marker for the resourceIds map", { resourceIds: 0 }],
      ["a reference as a resource id", { resourceIds: { documentId: [""] } }],
      ["0 as the user email", { userEmail: 0 }],
      ["a reference as the expiry", { expiresAtMs: ["documentId"] }],
      ["0 as the write map", { writeActionArguments: 0 }],
      [
        "0 as an action's write arguments",
        { writeActionArguments: { "update-document": 0 } },
      ],
      [
        "a marker that removes the only resource binding",
        { writeActionArguments: { "update-document": { id: 0, title: 0 } } },
      ],
      ["0 as the read map", { readActionArguments: 0 }],
      [
        "a missing reference in the read map",
        { readActionArguments: { "get-document": { id: ["missing"] } } },
      ],
    ])("rejects %s in a write capability", (_label, overrides) => {
      expect(
        writeAllowed(base64UrlScope(WRITE_PREFIX, writeWire(overrides))),
      ).toBe(false);
    });

    it("does not expand markers inside a legacy URI-encoded payload", () => {
      expect(readAllowed(legacyScope(READ_PREFIX, readWire()))).toBe(false);
      expect(
        readAllowed(
          legacyScope(
            READ_PREFIX,
            readWire({
              actionArguments: { "get-document": { id: DOCUMENT_ID } },
            }),
          ),
        ),
      ).toBe(true);
      expect(writeAllowed(legacyScope(WRITE_PREFIX, writeWire()))).toBe(false);
    });

    it.each([
      ["characters outside the base64url alphabet", "@@@@"],
      ["standard base64 characters", "a+b/"],
      ["padding", "AAAA="],
      ["a length that no base64 payload has", "abcde"],
      ["an empty payload", ""],
      [
        "bytes that are not UTF-8",
        Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url"),
      ],
      [
        "bytes that are not JSON",
        Buffer.from("not json").toString("base64url"),
      ],
      ["JSON that is not an object", Buffer.from("[]").toString("base64url")],
      ["JSON null", Buffer.from("null").toString("base64url")],
    ])("rejects a payload with %s", (_label, payload) => {
      expect(readAllowed(READ_PREFIX + payload)).toBe(false);
      expect(writeAllowed(WRITE_PREFIX + payload)).toBe(false);
    });
  });

  it("refuses to mint a compact scope over the length limit", () => {
    const oversizedArguments = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [
        `argument${index}`,
        `literal-${index}-`.padEnd(256, "x"),
      ]),
    );
    const readActionArguments = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `action-${index}`,
        oversizedArguments,
      ]),
    );

    expect(
      createMcpDirectoryWidgetReadCapability({
        ...readGrant(),
        actionArguments: readActionArguments,
      }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetWriteCapability({
        ...writeGrant(),
        readActionArguments,
      }),
    ).toBeUndefined();
    expect(
      createMcpDirectoryWidgetReadCapability(readGrant())!.length,
    ).toBeLessThanOrEqual(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH);
    expect(
      createMcpDirectoryWidgetWriteCapability(writeGrant())!.length,
    ).toBeLessThanOrEqual(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH);
  });
});

describe("MCP directory widget scopes minted before the compact wire form", () => {
  // Output of the URI-encoded encoder (minted at 2026-10-09T12:00:00Z), kept as
  // literals so tickets issued before a deploy keep verifying.
  const MINTED_AT_MS = Date.UTC(2026, 9, 9, 12, 0, 0);
  const LEGACY_READ_SCOPE = [
    "capability:mcp-directory-widget-read:%7B%22version%22%3A1%2C%22appId%2",
    "2%3A%22content%22%2C%22resourceUri%22%3A%22ui%3A%2F%2Fcontent%2Fshell-",
    "v66%22%2C%22resourceIds%22%3A%7B%22databaseId%22%3A%22db-1%22%2C%22doc",
    "umentId%22%3A%22doc-1%22%7D%2C%22actionArguments%22%3A%7B%22get-docume",
    "nt%22%3A%7B%22id%22%3A%22doc-1%22%7D%2C%22query-content-database-items",
    "%22%3A%7B%22documentId%22%3A%22doc-1%22%2C%22limit%22%3A%7B%22type%22%",
    "3A%22integerRange%22%2C%22min%22%3A1%2C%22max%22%3A5000%7D%2C%22tableQ",
    "uery%22%3A%7B%22type%22%3A%22actionSchema%22%7D%7D%7D%7D",
  ].join("");
  const LEGACY_WRITE_SCOPE = [
    "capability:mcp-directory-widget-write:%7B%22version%22%3A1%2C%22appId%",
    "22%3A%22content%22%2C%22resourceUri%22%3A%22ui%3A%2F%2Fcontent%2Fshell",
    "-v66%22%2C%22resourceIds%22%3A%7B%22databaseId%22%3A%22db-1%22%2C%22do",
    "cumentId%22%3A%22doc-1%22%7D%2C%22userEmail%22%3A%22editor%40example.t",
    "est%22%2C%22orgId%22%3A%22org-1%22%2C%22expiresAtMs%22%3A1791547800000",
    "%2C%22readActionArguments%22%3A%7B%22get-document%22%3A%7B%22id%22%3A%",
    "22doc-1%22%7D%2C%22query-content-database-items%22%3A%7B%22documentId%",
    "22%3A%22doc-1%22%2C%22limit%22%3A%7B%22type%22%3A%22integerRange%22%2C",
    "%22min%22%3A1%2C%22max%22%3A5000%7D%2C%22tableQuery%22%3A%7B%22type%22",
    "%3A%22actionSchema%22%7D%7D%7D%2C%22writeActionArguments%22%3A%7B%22ad",
    "d-database-item%22%3A%7B%22target%22%3A%7B%22type%22%3A%22actionSchema",
    "ResourceBound%22%2C%22resourceKey%22%3A%22databaseId%22%7D%2C%22title%",
    "22%3A%7B%22type%22%3A%22actionSchema%22%7D%7D%2C%22update-document%22%",
    "3A%7B%22id%22%3A%22doc-1%22%2C%22title%22%3A%7B%22type%22%3A%22actionS",
    "chema%22%7D%7D%7D%7D",
  ].join("");
  const resourceUri = "ui://content/shell-v66";
  const identity = { userEmail: "editor@example.test", orgId: "org-1" };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("still authorizes a legacy read scope exactly as before", () => {
    const normalize = (scope: string, args: Record<string, unknown>) =>
      normalizeMcpDirectoryWidgetReadActionArguments(scope, {
        actionName: "query-content-database-items",
        appId: "content",
        resourceUri,
        args,
        allowedArgumentNames: ["documentId", "limit", "tableQuery"],
      });

    expect(
      normalize(LEGACY_READ_SCOPE, {
        documentId: "doc-1",
        limit: "50",
        tableQuery: { search: "launch" },
      }),
    ).toEqual({
      documentId: "doc-1",
      limit: 50,
      tableQuery: { search: "launch" },
    });
    expect(
      normalize(LEGACY_READ_SCOPE, { documentId: "doc-2", limit: "50" }),
    ).toBeUndefined();
    expect(
      normalizeMcpDirectoryWidgetReadActionArguments(LEGACY_READ_SCOPE, {
        actionName: "get-document",
        appId: "content",
        resourceUri,
        args: { id: "doc-1" },
        allowedArgumentNames: ["id"],
      }),
    ).toEqual({ id: "doc-1" });
  });

  it("renews a legacy read scope into the compact form", () => {
    const renewed = renewMcpDirectoryWidgetCapabilityScope(LEGACY_READ_SCOPE, {
      appId: "content",
      resourceUri,
      userEmail: identity.userEmail,
      expiresAtMs: MINTED_AT_MS + 60_000,
      readAllowed: true,
      writeAllowed: false,
    });

    expect(renewed).toBe(
      createMcpDirectoryWidgetReadCapability({
        appId: "content",
        resourceUri,
        resourceIds: { databaseId: "db-1", documentId: "doc-1" },
        actionArguments: {
          "get-document": { id: "doc-1" },
          "query-content-database-items": {
            documentId: "doc-1",
            limit: { type: "integerRange", min: 1, max: 5_000 },
            tableQuery: { type: "actionSchema" },
          },
        },
      }),
    );
    expect(renewed).not.toContain("%");
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(
        LEGACY_READ_SCOPE,
        renewed!,
        identity,
      ),
    ).toBe(true);
  });

  it("still authorizes, expires, and renews a legacy write scope", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINTED_AT_MS);
    const widget = { appId: "content", resourceUri, ...identity };
    const normalize = (
      scope: string,
      actionName: string,
      allowedArgumentNames: string[],
      args: Record<string, unknown>,
    ) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
        ...widget,
        actionName,
        args,
        allowedArgumentNames,
      });

    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(LEGACY_WRITE_SCOPE, widget),
    ).toEqual({
      resourceIds: { databaseId: "db-1", documentId: "doc-1" },
      actionNames: ["add-database-item", "update-document"],
    });
    expect(
      normalize(LEGACY_WRITE_SCOPE, "update-document", ["id", "title"], {
        id: "doc-1",
        title: "Renamed",
      }),
    ).toEqual({ id: "doc-1", title: "Renamed" });
    expect(
      normalize(LEGACY_WRITE_SCOPE, "update-document", ["id", "title"], {
        id: "doc-2",
        title: "Renamed",
      }),
    ).toBeUndefined();
    expect(
      normalize(LEGACY_WRITE_SCOPE, "update-document", ["id", "title"], {
        title: "Renamed",
      }),
    ).toBeUndefined();
    expect(
      normalize(LEGACY_WRITE_SCOPE, "add-database-item", ["target", "title"], {
        target: { databaseId: "db-1" },
        title: "Row",
      }),
    ).toEqual({ target: { databaseId: "db-1" }, title: "Row" });
    expect(
      normalizeMcpDirectoryWidgetWriteActionArguments(LEGACY_WRITE_SCOPE, {
        ...widget,
        userEmail: "someone-else@example.test",
        actionName: "update-document",
        args: { id: "doc-1" },
        allowedArgumentNames: ["id", "title"],
      }),
    ).toBeUndefined();

    const renewed = renewMcpDirectoryWidgetCapabilityScope(LEGACY_WRITE_SCOPE, {
      ...widget,
      expiresAtMs: MINTED_AT_MS + 14 * 60_000,
      readAllowed: true,
      writeAllowed: true,
    });
    expect(
      renewed?.startsWith(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX),
    ).toBe(true);
    expect(renewed).not.toContain("%");
    expect(getMcpDirectoryWidgetWriteCapabilityExpiresAt(renewed)).toBe(
      MINTED_AT_MS + 14 * 60_000,
    );
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(
        LEGACY_WRITE_SCOPE,
        renewed!,
        identity,
      ),
    ).toBe(true);
    for (const scope of [LEGACY_WRITE_SCOPE, renewed!]) {
      expect(
        normalize(scope, "add-database-item", ["target", "title"], {
          target: { databaseId: "anything" },
          title: "Row",
        }),
      ).toEqual({ target: { databaseId: "anything" }, title: "Row" });
    }

    const downgraded = renewMcpDirectoryWidgetCapabilityScope(
      LEGACY_WRITE_SCOPE,
      {
        ...widget,
        expiresAtMs: MINTED_AT_MS + 60_000,
        readAllowed: true,
        writeAllowed: false,
      },
    );
    expect(isMcpDirectoryWidgetReadCapabilityScope(downgraded)).toBe(true);
    expect(downgraded).not.toContain("%");
    expect(
      canRenewMcpDirectoryWidgetCapabilityScope(
        LEGACY_WRITE_SCOPE,
        downgraded!,
        identity,
      ),
    ).toBe(true);

    vi.setSystemTime(MINTED_AT_MS + 600_001);
    expect(
      matchesMcpDirectoryWidgetWriteCapability(LEGACY_WRITE_SCOPE, widget),
    ).toBe(false);
    expect(
      isExpiredMcpDirectoryWidgetWriteCapability(LEGACY_WRITE_SCOPE, widget),
    ).toBe(true);
  });
});
