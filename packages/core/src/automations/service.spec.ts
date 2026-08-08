import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const atomicBatchMock = vi.hoisted(() => vi.fn());
const dbRuntime = vi.hoisted(() => ({ dialect: "sqlite" }));
const transactionExecuteMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const resourceDeleteWithDbMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourcePutWithDbMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const listAccessibleAutomationsMock = vi.hoisted(() => vi.fn());
const resolveAutomationAccessMock = vi.hoisted(() => vi.fn());
const replaceSharingMock = vi.hoisted(() => vi.fn());
const deleteSharingMock = vi.hoisted(() => vi.fn());
const deleteRunsWithDbMock = vi.hoisted(() => vi.fn());
const resourceNotificationMock = vi.hoisted(() => vi.fn());

vi.mock("./access.js", () => ({
  listAccessibleAutomations: listAccessibleAutomationsMock,
  resolveAutomationAccess: resolveAutomationAccessMock,
}));

vi.mock("./sharing-store.js", () => ({
  deleteAutomationSharingStateWithDb: deleteSharingMock,
  ensureAutomationSharingTables: vi.fn(),
  normalizeAutomationSharingEmail: (email: string) =>
    email.trim().toLowerCase(),
  prepareAutomationSharingDelete: (resourceId: string, guard: unknown) => ({
    statements: [
      { sql: "sharing-delete-grants", args: [resourceId, guard] },
      { sql: "sharing-delete-overlay", args: [resourceId, guard] },
    ],
  }),
  prepareAutomationSharingReplacement: (
    resourceId: string,
    sharing: unknown,
    options: unknown,
  ) => ({
    statements: [
      { sql: "sharing-replace", args: [resourceId, sharing, options] },
    ],
  }),
  replaceAutomationSharingStateWithDb: replaceSharingMock,
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: executeMock,
    transaction: transactionMock,
    atomicBatch: atomicBatchMock,
  }),
  getDialect: () => dbRuntime.dialect,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(),
  ensureIndexExists: vi.fn(),
}));

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: getUserSettingMock,
}));

vi.mock("../resources/store.js", () => ({
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  ensureResourceStoreReady: vi.fn(),
  prepareResourceBatchAssertion: (condition: unknown) => ({
    statements: [
      { sql: "atomic-guard-create" },
      { sql: "atomic-guard-assert", args: [condition] },
    ],
    cleanupStatement: { sql: "atomic-guard-delete" },
  }),
  prepareResourceCreate: ({ id, owner, path, content }: any) => ({
    value: resource(content, owner, { id, path }),
    statements: [{ sql: "resource-create", args: [id, owner, path, content] }],
    notifyAfterCommit: resourceNotificationMock,
  }),
  prepareResourceDelete: (current: any) => ({
    value: true,
    statements: [{ sql: "resource-delete", args: [current.id] }],
    notifyAfterCommit: resourceNotificationMock,
  }),
  prepareResourceUpdate: ({ current, content }: any) => ({
    value: { ...current, content, updatedAt: current.updatedAt + 1 },
    statements: [{ sql: "resource-update", args: [current.id, content] }],
    notifyAfterCommit: resourceNotificationMock,
  }),
  resourceDeleteWithDb: resourceDeleteWithDbMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceList: resourceListMock,
  resourcePutWithDb: resourcePutWithDbMock,
}));

vi.mock("../jobs/run-history.js", () => ({
  deleteAutomationRunsWithDb: deleteRunsWithDbMock,
  ensureAutomationRunHistoryReady: vi.fn(),
  prepareAutomationRunsDelete: (
    owner: string,
    name: string,
    guard: unknown,
  ) => ({ sql: "history-delete", args: [owner, name, guard] }),
}));

import { parseJobResource } from "../jobs/frontmatter.js";
import {
  automationMatchesEventOwner,
  defineAutomation,
  deleteAutomation,
  listAccessibleAutomationDefinitions,
  listAutomationDefinitions,
  resolveAutomationExecutionIdentity,
  updateAutomation,
} from "./service.js";

const actor = { userEmail: "Alice@Example.com", orgId: "org-1" };
const orgOwner = "__organization__:org-1";

function resource(
  content: string,
  owner = orgOwner,
  overrides: { id?: string; path?: string } = {},
) {
  return {
    id: overrides.id ?? "automation-1",
    owner,
    path: overrides.path ?? "jobs/notify.md",
    content,
    mimeType: "text/markdown",
    size: content.length,
    createdAt: 1,
    updatedAt: 1,
    createdBy: "agent" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

function accessible(
  automationResource: ReturnType<typeof resource>,
  role: "owner" | "collaborate" | "view" = "owner",
) {
  const parsed = parseJobResource(automationResource.content);
  const organization = automationResource.owner.startsWith("__organization__:");
  return {
    resource: automationResource,
    name: automationResource.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
    classification: parsed.classification,
    meta: parsed.meta,
    body: parsed.body,
    immutableCreator: parsed.meta.createdBy ?? automationResource.owner,
    owningOrganizationId: organization ? "org-1" : null,
    effectiveRole: role,
    capabilities: {
      canEdit: role !== "view",
      canOperate: role !== "view",
      canDelete: role === "owner",
      canManageSharing: role === "owner",
    },
    sharing: {
      source: "explicit" as const,
      visibility: "private" as const,
      organizationId: organization ? "org-1" : null,
      grantCount: role === "owner" ? 0 : 1,
    },
    creator: {
      email: parsed.meta.createdBy ?? automationResource.owner,
      label: parsed.meta.createdBy ?? automationResource.owner,
    },
  };
}

const eventAutomation = `---
schedule: ""
enabled: true
triggerType: event
event: mail.received
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
runAs: creator
model: "claude-sonnet"
mcpTools: ["mcp__mail__read"]
deliveryPlatform: "slack"
deliveryDestination: "channel-1"
---

Send the notification.`;

const eventAutomationWithCondition = `---
schedule: ""
enabled: true
triggerType: event
event: mail.received
condition: only for urgent messages
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
runAs: creator
---

Send the notification.`;

function batchResults(count: number, successIndex: number, affected = 1) {
  return Array.from({ length: count }, (_, index) => ({
    rows: [],
    rowsAffected: index === successIndex ? affected : 1,
  }));
}

describe("automation domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRuntime.dialect = "sqlite";
    atomicBatchMock.mockResolvedValue([]);
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    transactionExecuteMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    transactionMock.mockImplementation(async (work) =>
      work({ execute: transactionExecuteMock }),
    );
    resourceDeleteWithDbMock.mockResolvedValue({
      value: true,
      notifyAfterCommit: vi.fn(),
    });
    resourceGetByPathMock.mockResolvedValue(null);
    resourceListMock.mockResolvedValue([]);
    resourcePutWithDbMock.mockImplementation(
      async (_tx, owner: string, path: string, content: string) => ({
        value: resource(content, owner),
        notifyAfterCommit: vi.fn(),
      }),
    );
    replaceSharingMock.mockResolvedValue(undefined);
    deleteSharingMock.mockResolvedValue(undefined);
    deleteRunsWithDbMock.mockResolvedValue(undefined);
    getUserSettingMock.mockResolvedValue(null);
    listAccessibleAutomationsMock.mockResolvedValue([]);
  });

  it("maps the centralized access result into the unified service list", async () => {
    listAccessibleAutomationsMock.mockResolvedValue([
      {
        resource: resource(eventAutomation),
        name: "notify",
        classification: {
          kind: "automation",
          hasExplicitTriggerType: true,
          triggerType: "event",
        },
        meta: { triggerType: "event" },
        body: "Send the notification.",
        immutableCreator: "alice@example.com",
        owningOrganizationId: "org-1",
        effectiveRole: "collaborate",
        capabilities: {
          canEdit: true,
          canOperate: true,
          canDelete: false,
          canManageSharing: false,
        },
        sharing: {
          source: "explicit",
          visibility: "private",
          organizationId: "org-1",
          grantCount: 1,
        },
        creator: {
          email: "alice@example.com",
          label: "Alice",
        },
      },
    ]);

    const result = await listAccessibleAutomationDefinitions(actor);

    expect(listAccessibleAutomationsMock).toHaveBeenCalledWith({
      userEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(result[0]).toMatchObject({
      scope: "organization",
      effectiveRole: "collaborate",
      canUpdate: true,
      capabilities: { canManageSharing: false },
    });
  });

  it("schedules a new automation in the timezone the creator saved", async () => {
    getUserSettingMock.mockResolvedValue({ timezone: "America/New_York" });
    resourceGetByPathMock
      .mockResolvedValueOnce(null)
      .mockImplementation(async (owner: string) =>
        resource(resourcePutWithDbMock.mock.calls.at(-1)?.[3] as string, owner),
      );

    const definition = await defineAutomation(actor, {
      name: "digest",
      scope: "organization",
      triggerType: "schedule",
      schedule: "0 8 * * *",
      body: "Send the digest.",
    });

    expect(definition.meta.timezone).toBe("America/New_York");
    // 8am Eastern is 12:00 or 13:00 UTC depending on DST, never 08:00 UTC.
    expect(definition.meta.nextRun).toBeTruthy();
    expect(new Date(definition.meta.nextRun as string).getUTCHours()).not.toBe(
      8,
    );
  });

  it("creates a manual automation without automatic trigger fields", async () => {
    resourceGetByPathMock.mockResolvedValueOnce(null);

    const definition = await defineAutomation(actor, {
      name: "on-demand-report",
      scope: "organization",
      triggerType: "manual",
      body: "Build the report.",
      schedule: "0 8 * * *",
      timezone: "Not/A-Timezone",
      event: "mail.received",
      condition: "only for urgent messages",
    });

    expect(definition.meta).toMatchObject({
      schedule: "",
      enabled: true,
      triggerType: "manual",
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
    });
    expect(definition.meta).not.toHaveProperty("timezone");
    expect(definition.meta).not.toHaveProperty("event");
    expect(definition.meta).not.toHaveProperty("condition");
    expect(definition.meta).not.toHaveProperty("nextRun");

    const content = resourcePutWithDbMock.mock.calls[0]?.[3] as string;
    expect(content).toContain("triggerType: manual");
    expect(content).not.toMatch(/^(event|condition|nextRun|timezone):/m);
  });

  it("creates an organization event automation owned by the org but run as its creator", async () => {
    resourceGetByPathMock
      .mockResolvedValueOnce(null)
      .mockImplementation(async (owner: string, path: string) =>
        resource(resourcePutWithDbMock.mock.calls.at(-1)?.[3] as string, owner),
      );

    const definition = await defineAutomation(actor, {
      name: "notify",
      scope: "organization",
      triggerType: "event",
      event: "mail.received",
      body: "Send the notification.",
      model: "claude-sonnet",
      mcpTools: ["mcp__mail__read"],
      delivery: { platform: "slack", destination: "channel-1" },
    });

    expect(resourcePutWithDbMock).toHaveBeenCalledWith(
      expect.objectContaining({ execute: transactionExecuteMock }),
      orgOwner,
      "jobs/notify.md",
      expect.stringMatching(
        /createdBy: alice@example\.com[\s\S]*orgId: "org-1"[\s\S]*runAs: creator/,
      ),
    );
    expect(definition.meta).toMatchObject({
      triggerType: "event",
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
      model: "claude-sonnet",
      mcpTools: ["mcp__mail__read"],
      deliveryPlatform: "slack",
      deliveryDestination: "channel-1",
    });
  });

  it("fails closed when the caller is not a current organization member", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await expect(
      defineAutomation(actor, {
        name: "notify",
        scope: "organization",
        triggerType: "event",
        event: "mail.received",
        body: "Send the notification.",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutWithDbMock).not.toHaveBeenCalled();
  });

  it("normalizes unique existing accounts and requires acknowledgement for outside collaborators", async () => {
    executeMock.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes('FROM "user"')) {
        return {
          rows: [
            { email: "viewer@example.com" },
            { email: "outside@example.com" },
          ],
        };
      }
      if (sql.includes("LOWER(email) IN")) {
        return { rows: [{ email: "viewer@example.com" }] };
      }
      return { rows: [{ role: "member" }] };
    });

    await expect(
      defineAutomation(actor, {
        name: "shared-digest",
        scope: "organization",
        triggerType: "manual",
        body: "Build it.",
        sharing: {
          kind: "specific",
          grants: [
            { email: " Viewer@Example.com ", role: "view" },
            { email: "OUTSIDE@example.com", role: "collaborate" },
          ],
        },
      }),
    ).rejects.toThrow(/Acknowledge outside-organization collaborators/);
    expect(transactionMock).not.toHaveBeenCalled();

    await defineAutomation(actor, {
      name: "shared-digest",
      scope: "organization",
      triggerType: "manual",
      body: "Build it.",
      sharing: {
        kind: "specific",
        grants: [
          { email: " Viewer@Example.com ", role: "view" },
          { email: "OUTSIDE@example.com", role: "collaborate" },
        ],
      },
      acknowledgeExternalCollaborators: true,
    });
    expect(replaceSharingMock).toHaveBeenCalledWith(
      expect.anything(),
      "automation-1",
      {
        kind: "specific",
        organizationId: "org-1",
        grants: [
          { email: "viewer@example.com", role: "view" },
          { email: "outside@example.com", role: "collaborate" },
        ],
      },
    );
  });

  it("rejects duplicate, nonexistent, and public sharing before writes", async () => {
    executeMock.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes('FROM "user"')
        ? { rows: [] }
        : { rows: [{ role: "member" }] },
    );
    const base = {
      name: "invalid-sharing",
      scope: "organization" as const,
      triggerType: "manual" as const,
      body: "Build it.",
    };

    await expect(
      defineAutomation(actor, {
        ...base,
        sharing: {
          kind: "specific",
          grants: [
            { email: "same@example.com", role: "view" },
            { email: " SAME@example.com ", role: "collaborate" },
          ],
        },
      }),
    ).rejects.toThrow(/unique/);
    await expect(
      defineAutomation(actor, {
        ...base,
        sharing: {
          kind: "specific",
          grants: [{ email: "missing@example.com", role: "view" }],
        },
      }),
    ).rejects.toThrow(/do not exist/);
    await expect(
      defineAutomation(actor, {
        ...base,
        sharing: { kind: "public" } as never,
      }),
    ).rejects.toThrow(/Unsupported automation sharing state/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects Collaborate changing complete sharing state", async () => {
    const automationResource = resource(eventAutomation);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "collaborate"),
    );

    await expect(
      updateAutomation(
        { userEmail: "collaborator@example.com", orgId: "org-1" },
        {
          resourceId: "automation-1",
          sharing: { kind: "personal" },
        },
      ),
    ).rejects.toThrow(/Only the automation owner can change sharing/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not notify or replace sharing when either atomic write fails", async () => {
    resourcePutWithDbMock.mockRejectedValueOnce(new Error("definition failed"));
    await expect(
      defineAutomation(actor, {
        name: "rollback-definition",
        scope: "organization",
        triggerType: "manual",
        body: "Build it.",
      }),
    ).rejects.toThrow("definition failed");
    expect(replaceSharingMock).not.toHaveBeenCalled();

    const notifyAfterCommit = vi.fn();
    resourcePutWithDbMock.mockResolvedValueOnce({
      value: resource(eventAutomation),
      notifyAfterCommit,
    });
    replaceSharingMock.mockRejectedValueOnce(new Error("sharing failed"));
    await expect(
      defineAutomation(actor, {
        name: "rollback-sharing",
        scope: "organization",
        triggerType: "manual",
        body: "Build it.",
      }),
    ).rejects.toThrow("sharing failed");
    expect(notifyAfterCommit).not.toHaveBeenCalled();
  });

  describe("D1 atomic mutations", () => {
    beforeEach(() => {
      dbRuntime.dialect = "d1";
    });

    it("creates the resource and complete sharing state in one atomic batch", async () => {
      atomicBatchMock.mockResolvedValue(batchResults(5, 2));

      await defineAutomation(actor, {
        name: "d1-create",
        scope: "organization",
        triggerType: "manual",
        body: "Build it.",
      });

      expect(transactionMock).not.toHaveBeenCalled();
      expect(atomicBatchMock).toHaveBeenCalledTimes(1);
      expect(atomicBatchMock.mock.calls[0]?.[0].slice(2, -1)).toEqual([
        expect.objectContaining({ sql: "resource-create" }),
        expect.objectContaining({ sql: "sharing-replace" }),
      ]);
      expect(resourceNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("updates content and sharing in one guarded atomic batch", async () => {
      const current = resource(eventAutomation);
      resolveAutomationAccessMock.mockResolvedValue(
        accessible(current, "owner"),
      );
      atomicBatchMock.mockResolvedValue(batchResults(5, 2));

      await updateAutomation(actor, {
        resourceId: current.id,
        enabled: false,
        sharing: { kind: "personal" },
      });

      expect(atomicBatchMock.mock.calls[0]?.[0].slice(2, -1)).toEqual([
        expect.objectContaining({ sql: "resource-update" }),
        expect.objectContaining({
          sql: "sharing-replace",
          args: expect.arrayContaining([
            current.id,
            expect.objectContaining({ kind: "personal" }),
            expect.objectContaining({ guard: expect.anything() }),
          ]),
        }),
      ]);
      expect(resourceNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("deletes sharing, history, and the guarded resource in one batch", async () => {
      const current = resource(eventAutomation);
      resolveAutomationAccessMock.mockResolvedValue(
        accessible(current, "owner"),
      );
      atomicBatchMock.mockResolvedValue(batchResults(7, 5));

      await deleteAutomation(actor, { resourceId: current.id });

      expect(atomicBatchMock.mock.calls[0]?.[0].slice(2, -1)).toEqual([
        expect.objectContaining({ sql: "sharing-delete-grants" }),
        expect.objectContaining({ sql: "sharing-delete-overlay" }),
        expect.objectContaining({ sql: "history-delete" }),
        expect.objectContaining({ sql: "resource-delete" }),
      ]);
      expect(resourceNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("leaves notification pending when create or update batches fail", async () => {
      atomicBatchMock.mockRejectedValueOnce(new Error("D1 batch failed"));
      await expect(
        defineAutomation(actor, {
          name: "d1-failure",
          scope: "organization",
          triggerType: "manual",
          body: "Build it.",
        }),
      ).rejects.toThrow("D1 batch failed");
      expect(resourceNotificationMock).not.toHaveBeenCalled();

      const current = resource(eventAutomation);
      resolveAutomationAccessMock.mockResolvedValue(
        accessible(current, "owner"),
      );
      atomicBatchMock.mockRejectedValueOnce(new Error("sharing insert failed"));
      await expect(
        updateAutomation(actor, {
          resourceId: current.id,
          enabled: false,
          sharing: { kind: "personal" },
        }),
      ).rejects.toThrow("sharing insert failed");
      expect(resourceNotificationMock).not.toHaveBeenCalled();
    });

    it("reports conditional create and delete conflicts without notifying", async () => {
      atomicBatchMock.mockResolvedValueOnce(batchResults(5, 2, 0));
      await expect(
        defineAutomation(actor, {
          name: "d1-conflict",
          scope: "organization",
          triggerType: "manual",
          body: "Build it.",
        }),
      ).rejects.toMatchObject({ statusCode: 409 });

      const current = resource(eventAutomation);
      resolveAutomationAccessMock.mockResolvedValue(
        accessible(current, "owner"),
      );
      atomicBatchMock.mockResolvedValueOnce(batchResults(7, 5, 0));
      await expect(
        deleteAutomation(actor, { resourceId: current.id }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(resourceNotificationMock).not.toHaveBeenCalled();
    });
  });

  it("lists org automations for members and computes creator/admin mutation rights", async () => {
    resourceListMock.mockResolvedValue([{ path: "jobs/notify.md" }]);
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    const creatorItems = await listAutomationDefinitions(actor, "organization");
    expect(creatorItems).toHaveLength(1);
    expect(creatorItems[0]).toMatchObject({
      name: "notify",
      scope: "organization",
      canUpdate: true,
    });

    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const adminItems = await listAutomationDefinitions(
      { userEmail: "admin@example.com", orgId: "org-1" },
      "organization",
    );
    expect(adminItems[0]?.canUpdate).toBe(true);

    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const memberItems = await listAutomationDefinitions(
      { userEmail: "member@example.com", orgId: "org-1" },
      "organization",
    );
    expect(memberItems[0]?.canUpdate).toBe(false);
  });

  it("lets Collaborate edit without retargeting identity but reserves delete for Owner", async () => {
    const automationResource = resource(eventAutomation);
    resourceGetByPathMock.mockResolvedValue(automationResource);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "collaborate"),
    );
    transactionExecuteMock.mockResolvedValue({
      rows: [{ id: "automation-1" }],
      rowsAffected: 1,
    });

    const updated = await updateAutomation(
      { userEmail: "collaborator@example.com", orgId: "org-1" },
      {
        resourceId: "automation-1",
        enabled: false,
        model: "claude-opus",
        mcpTools: ["mcp__mail__read", "mcp__mail__send"],
      },
    );
    expect(updated.meta).toMatchObject({
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
      enabled: false,
      model: "claude-opus",
      mcpTools: ["mcp__mail__read", "mcp__mail__send"],
    });
    expect(transactionExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "resource-update",
        args: [
          "automation-1",
          expect.stringContaining("createdBy: alice@example.com"),
        ],
      }),
    );

    await expect(
      deleteAutomation(
        { userEmail: "collaborator@example.com", orgId: "org-1" },
        { resourceId: "automation-1" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(transactionExecuteMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ sql: "resource-delete" }),
    );

    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "owner"),
    );
    await deleteAutomation(actor, { resourceId: "automation-1" });
    expect(transactionExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "resource-delete",
        args: ["automation-1"],
      }),
    );
    expect(deleteSharingMock).toHaveBeenCalled();
    expect(deleteRunsWithDbMock).toHaveBeenCalledWith(
      expect.anything(),
      orgOwner,
      "notify",
    );
  });

  it("rejects a stale non-D1 update as a 409 conflict without writing sharing", async () => {
    const automationResource = resource(eventAutomation);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "owner"),
    );
    transactionExecuteMock.mockImplementation(async (statement: any) => {
      if (statement?.sql === "resource-update") {
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ id: "automation-1" }], rowsAffected: 1 };
    });

    await expect(
      updateAutomation(actor, { resourceId: "automation-1", enabled: false }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(replaceSharingMock).not.toHaveBeenCalled();
    expect(resourceNotificationMock).not.toHaveBeenCalled();
  });

  it("rejects a stale non-D1 delete as a 409 conflict without deleting sharing or history", async () => {
    const automationResource = resource(eventAutomation);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "owner"),
    );
    transactionExecuteMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(
      deleteAutomation(actor, { resourceId: "automation-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(deleteSharingMock).not.toHaveBeenCalled();
    expect(deleteRunsWithDbMock).not.toHaveBeenCalled();
    expect(resourceNotificationMock).not.toHaveBeenCalled();
  });

  it("clears a leftover event condition when an automation switches to schedule", async () => {
    const automationResource = resource(eventAutomationWithCondition);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "owner"),
    );
    transactionExecuteMock.mockResolvedValue({
      rows: [{ id: "automation-1" }],
      rowsAffected: 1,
    });

    const updated = await updateAutomation(actor, {
      resourceId: "automation-1",
      triggerType: "schedule",
      schedule: "0 8 * * *",
    });

    expect(updated.meta.triggerType).toBe("schedule");
    expect(updated.meta.condition).toBeUndefined();
  });

  it("rejects an explicit condition for a schedule automation", async () => {
    const automationResource = resource(eventAutomation);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "owner"),
    );

    await expect(
      updateAutomation(actor, {
        resourceId: "automation-1",
        triggerType: "schedule",
        schedule: "0 8 * * *",
        condition: "only when urgent",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects View mutating another creator's automation", async () => {
    const automationResource = resource(eventAutomation);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "view"),
    );

    await expect(
      updateAutomation(
        { userEmail: "member@example.com", orgId: "org-1" },
        {
          resourceId: "automation-1",
          enabled: false,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutWithDbMock).not.toHaveBeenCalled();
  });

  it("revalidates creator existence and membership for execution and scopes events to the creator", async () => {
    executeMock.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes('FROM "user"')
        ? { rows: [{ exists: 1 }] }
        : { rows: [{ role: "member" }] },
    );
    const result = await resolveAutomationExecutionIdentity(orgOwner, {
      schedule: "",
      enabled: true,
      triggerType: "event",
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
    });

    expect(result).toEqual({
      ok: true,
      identity: {
        userEmail: "alice@example.com",
        orgId: "org-1",
        eventOwner: "alice@example.com",
      },
    });
    if (result.ok) {
      expect(
        automationMatchesEventOwner(result.identity, "Alice@Example.com"),
      ).toBe(true);
      expect(
        automationMatchesEventOwner(result.identity, "bob@example.com"),
      ).toBe(false);
      expect(automationMatchesEventOwner(result.identity, undefined)).toBe(
        false,
      );
    }

    executeMock
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      resolveAutomationExecutionIdentity(orgOwner, {
        schedule: "",
        enabled: true,
        triggerType: "event",
        createdBy: "alice@example.com",
        orgId: "org-1",
        runAs: "creator",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("no longer a member"),
    });
  });

  it("rejects organization execution that is not explicitly creator-run", async () => {
    await expect(
      resolveAutomationExecutionIdentity(orgOwner, {
        schedule: "",
        enabled: true,
        triggerType: "event",
        createdBy: "alice@example.com",
        orgId: "org-1",
        runAs: "shared",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "Organization automations must run as their creator.",
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
