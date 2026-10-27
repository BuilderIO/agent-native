import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const executeMock = vi.hoisted(() => vi.fn());
const atomicBatchMock = vi.hoisted(() => vi.fn());
const dbRuntime = vi.hoisted(() => ({ dialect: "sqlite" }));
const transactionExecuteMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const resourceDeleteWithDbMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourcePutWithDbMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
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
  ensureColumnExists: vi.fn(),
}));

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: getUserSettingMock,
}));

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
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
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
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

import { defineAction, type ActionRunContext } from "../action.js";
import { nextOccurrence } from "../jobs/cron.js";
import { parseJobResource } from "../jobs/frontmatter.js";
import {
  automationMatchesEventOwner,
  canQueueAutomationRunNow,
  canUpdateAutomationResource,
  defineAutomation,
  deleteAutomation,
  listAccessibleAutomationDefinitions,
  listAutomationDefinitions,
  resolveAutomationExecutionIdentity,
  updateAutomation,
} from "./service.js";

const omittedCallerActor = {
  userEmail: "Alice@Example.com",
  orgId: "org-1",
  appId: "mail",
};
const actor = { ...omittedCallerActor, caller: "frontend" as const };
const orgOwner = "__organization__:org-1";

type Origin = Pick<ActionRunContext, "caller" | "networkProtocol">;
const outsideOrigins: { label: string; context: Origin }[] = [
  { label: "A2A caller", context: { caller: "a2a" } },
  {
    label: "tool over A2A",
    context: { caller: "tool", networkProtocol: "a2a" },
  },
  {
    label: "tool over MCP ask_app",
    context: { caller: "tool", networkProtocol: "mcp" },
  },
  {
    label: "tool over provider API",
    context: { caller: "tool", networkProtocol: "provider-api" },
  },
];

/** Runs `run` inside an app action frame, as an action wrapper that omits the caller does. */
function inAppAction<T>(context: Origin, run: () => Promise<T>) {
  return defineAction({
    description: "Change an app-owned automation.",
    schema: z.object({}),
    run,
  }).run({}, { ...context, userEmail: actor.userEmail });
}

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
appId: mail
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
appId: mail
runAs: creator
---

Send the notification.`;

function batchResults(count: number, successIndex: number, affected = 1) {
  return Array.from({ length: count }, (_, index) => ({
    rows: [],
    rowsAffected: index === successIndex ? affected : 1,
  }));
}
const factoryAutomation = `---
schedule: "*/5 * * * *"
enabled: true
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: factory
domain: factory
runAs: creator
---

Observe Slack.`;

describe("automation domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRuntime.dialect = "sqlite";
    atomicBatchMock.mockRejectedValue(
      new Error("This database does not support atomic batches."),
    );
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
    resourcePutMock.mockResolvedValue(undefined);
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => ({
        id: "automation-1",
        owner: input.owner,
        path: input.path,
        content: input.content,
      }),
    );
    getUserSettingMock.mockResolvedValue(null);
    listAccessibleAutomationsMock.mockResolvedValue([]);
    resolveAutomationAccessMock.mockImplementation(
      async (_actor: unknown, resourceId: string) => {
        const latest = resourceGetByPathMock.mock.results.at(-1);
        const automationResource =
          latest?.type === "return" ? await latest.value : null;
        return automationResource?.id === resourceId
          ? accessible(automationResource, "owner")
          : null;
      },
    );
  });

  it.each(["mcp", "tool"] as const)(
    "keeps %s provenance through app action wrappers that omit the caller",
    async (caller) => {
      const action = defineAction({
        description: "Create an app-owned automation.",
        schema: z.object({}),
        run: () =>
          defineAutomation(omittedCallerActor, {
            name: "app-created",
            scope: "personal",
            triggerType: "manual",
            body: "Send a reminder.",
          }),
      });
      const result = await action.run(
        {},
        { caller, userEmail: actor.userEmail },
      );
      expect(result.meta.mcpManaged).toBe(caller === "mcp" ? true : undefined);
      expect(
        parseJobResource(resourcePutWithDbMock.mock.calls[0][3]).meta
          .mcpManaged,
      ).toBe(caller === "mcp" ? true : undefined);
    },
  );

  it.each(outsideOrigins)(
    "marks $label definitions through app action wrappers that omit the caller",
    async ({ context }) => {
      const result = await inAppAction(context, () =>
        defineAutomation(omittedCallerActor, {
          name: "outside-created",
          scope: "personal",
          triggerType: "manual",
          body: "Send a reminder.",
        }),
      );
      expect(result.meta.mcpManaged).toBe(true);
      expect(
        parseJobResource(resourcePutWithDbMock.mock.calls[0][3]).meta
          .mcpManaged,
      ).toBe(true);
    },
  );

  it("marks definitions from an A2A actor outside any action frame", async () => {
    const result = await defineAutomation(
      { ...actor, caller: "a2a" },
      {
        name: "a2a-created",
        scope: "personal",
        triggerType: "manual",
        body: "Send a reminder.",
      },
    );
    expect(result.meta.mcpManaged).toBe(true);
    expect(
      parseJobResource(resourcePutWithDbMock.mock.calls[0][3]).meta.mcpManaged,
    ).toBe(true);
  });

  it.each([
    { label: "an unrecognized caller", who: { ...actor, caller: "future" } },
    { label: "no caller and no action frame", who: omittedCallerActor },
  ])("treats $label as outside provenance", async ({ who }) => {
    const result = await defineAutomation(who as typeof actor, {
      name: "unknown-origin",
      scope: "personal",
      triggerType: "manual",
      body: "Send a reminder.",
    });
    expect(result.meta.mcpManaged).toBe(true);
  });

  it.each(["frontend", "tool"] as const)(
    "keeps definitions and edits from the app's own %s unmarked",
    async (caller) => {
      const created = await inAppAction({ caller }, () =>
        defineAutomation(omittedCallerActor, {
          name: "app-created",
          scope: "personal",
          triggerType: "manual",
          body: "Send a reminder.",
        }),
      );
      expect(created.meta.mcpManaged).toBeUndefined();
      expect(
        parseJobResource(resourcePutWithDbMock.mock.calls[0][3]).meta
          .mcpManaged,
      ).toBeUndefined();
      resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));
      const updated = await inAppAction({ caller }, () =>
        updateAutomation(omittedCallerActor, {
          name: "notify",
          scope: "organization",
          enabled: false,
        }),
      );
      expect(updated.meta.enabled).toBe(false);
      expect(updated.meta.mcpManaged).toBeUndefined();
      expect(
        parseJobResource(updated.resource.content).meta.mcpManaged,
      ).toBeUndefined();
    },
  );

  it.each(outsideOrigins)(
    "marks $label edits and keeps the mark through later ordinary edits",
    async ({ context }) => {
      let stored = resource(eventAutomation);
      resourceGetByPathMock.mockImplementation(async () => stored);
      resourcePutIfCurrentMock.mockImplementation(async (input) => {
        stored = {
          ...stored,
          content: input.content,
          updatedAt: stored.updatedAt + 1,
        };
        return stored;
      });
      const first = await inAppAction(context, () =>
        updateAutomation(omittedCallerActor, {
          name: "notify",
          scope: "organization",
          body: "Send a changed reminder.",
        }),
      );
      expect(first.meta.mcpManaged).toBe(true);
      expect(parseJobResource(stored.content).meta.mcpManaged).toBe(true);
      const second = await updateAutomation(
        { ...actor, caller: "frontend" },
        { name: "notify", scope: "organization", enabled: false },
      );
      expect(second.meta.mcpManaged).toBe(true);
      expect(parseJobResource(stored.content).meta.mcpManaged).toBe(true);
    },
  );

  it("keeps A2A provenance through nested actions with a different inner caller", async () => {
    let stored = resource(eventAutomation);
    resourceGetByPathMock.mockImplementation(async () => stored);
    resourcePutIfCurrentMock.mockImplementation(async (input) => {
      stored = {
        ...stored,
        content: input.content,
        updatedAt: stored.updatedAt + 1,
      };
      return stored;
    });
    const result = await inAppAction({ caller: "a2a" }, () =>
      inAppAction({ caller: "tool" }, () =>
        updateAutomation(
          { ...actor, caller: "frontend" },
          { name: "notify", scope: "organization", enabled: false },
        ),
      ),
    );
    expect(result.meta.mcpManaged).toBe(true);
    expect(parseJobResource(stored.content).meta.mcpManaged).toBe(true);
  });

  it("keeps MCP provenance through nested actions with a different inner caller", async () => {
    let stored = resource(eventAutomation);
    resourceGetByPathMock.mockImplementation(async () => stored);
    resourcePutIfCurrentMock.mockImplementation(async (input) => {
      stored = {
        ...stored,
        content: input.content,
        updatedAt: stored.updatedAt + 1,
      };
      return stored;
    });
    const inner = defineAction({
      description: "Update an app-owned automation.",
      schema: z.object({}),
      run: () =>
        updateAutomation(
          { ...actor, caller: "frontend" },
          { name: "notify", scope: "organization", enabled: false },
        ),
    });
    const outer = defineAction({
      description: "Delegate an automation update.",
      schema: z.object({}),
      run: () => inner.run({}, { caller: "tool", userEmail: actor.userEmail }),
    });
    const result = await outer.run(
      {},
      { caller: "mcp", userEmail: actor.userEmail },
    );
    expect(result.meta.mcpManaged).toBe(true);
    expect(parseJobResource(stored.content).meta.mcpManaged).toBe(true);
  });

  it.each(["mcp", "tool", "frontend"] as const)(
    "persists MCP provenance only for %s definitions",
    async (caller) => {
      const result = await defineAutomation(
        { ...actor, caller },
        {
          name: "mcp-created",
          scope: "personal",
          triggerType: "manual",
          body: "Send a reminder.",
          ...({ mcpManaged: false, caller: "frontend" } as any),
        },
      );
      const content = resourcePutWithDbMock.mock.calls[0][3];
      expect(parseJobResource(content).meta.mcpManaged).toBe(
        caller === "mcp" ? true : undefined,
      );
      expect(result.meta.mcpManaged).toBe(caller === "mcp" ? true : undefined);
    },
  );

  it("marks MCP edits and keeps the mark through later trusted edits and rebuilds", async () => {
    let stored = resource(eventAutomation);
    resourceGetByPathMock.mockImplementation(async () => stored);
    resourcePutIfCurrentMock.mockImplementation(async (input) => {
      stored = {
        ...stored,
        content: input.content,
        updatedAt: stored.updatedAt + 1,
      };
      return stored;
    });
    const first = await updateAutomation(
      { ...actor, caller: "mcp" },
      {
        name: "notify",
        scope: "organization",
        body: "Send a changed reminder.",
        ...({ mcpManaged: false } as any),
      },
    );
    expect(first.meta.mcpManaged).toBe(true);
    expect(parseJobResource(stored.content).meta.mcpManaged).toBe(true);
    const second = await updateAutomation(
      { ...actor, caller: "frontend" },
      {
        name: "notify",
        scope: "organization",
        enabled: false,
        ...({ mcpManaged: false } as any),
      },
    );
    expect(second.meta.mcpManaged).toBe(true);
    const { buildJobResourceContent } = await import("../jobs/frontmatter.js");
    const rebuilt = buildJobResourceContent(second.meta, second.body);
    expect(parseJobResource(rebuilt).meta.mcpManaged).toBe(true);
  });

  it.each([false, true])(
    "rejects first MCP takeover of a running automation (sharing: %s)",
    async (sharing) => {
      resourceGetByPathMock.mockResolvedValue(
        resource(
          eventAutomation.replace(
            "runAs: creator",
            "runAs: creator\nlastStatus: running",
          ),
        ),
      );

      await expect(
        updateAutomation(
          { ...actor, caller: "mcp" },
          {
            name: "notify",
            scope: "organization",
            enabled: false,
            ...(sharing ? { sharing: { kind: "personal" as const } } : {}),
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          "This automation is running. Wait for it to finish before managing it through an external agent.",
      });
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
      expect(atomicBatchMock).not.toHaveBeenCalled();
      expect(replaceSharingMock).not.toHaveBeenCalled();
      expect(resourceNotificationMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caller: "mcp" as const, marked: true },
    { caller: "tool" as const, marked: false },
  ])(
    "preserves running automation edits from $caller (marked: $marked)",
    async ({ caller, marked }) => {
      resourceGetByPathMock.mockResolvedValue(
        resource(
          eventAutomation.replace(
            "runAs: creator",
            `runAs: creator\nlastStatus: running${marked ? "\nmcpManaged: true" : ""}`,
          ),
        ),
      );
      const updated = await updateAutomation(
        { ...actor, caller },
        { name: "notify", scope: "organization", enabled: false },
      );
      expect(updated.meta.enabled).toBe(false);
      expect(updated.meta.lastStatus).toBe("running");
      expect(updated.meta.mcpManaged).toBe(marked ? true : undefined);
      expect(parseJobResource(updated.resource.content).meta).toMatchObject({
        enabled: false,
        lastStatus: "running",
      });
    },
  );

  it.each(["mcp", "tool"] as const)(
    "rechecks %s takeover when a concurrent run starts during an edit retry",
    async (caller) => {
      const before = resource(eventAutomation);
      const running = {
        ...before,
        content: eventAutomation.replace(
          "runAs: creator",
          "runAs: creator\nlastStatus: running",
        ),
        updatedAt: 2,
      };
      resourceGetByPathMock
        .mockResolvedValueOnce(before)
        .mockResolvedValue(running);
      resourcePutIfCurrentMock
        .mockResolvedValueOnce(null)
        .mockImplementation(async (input) => ({
          ...running,
          content: input.content,
        }));

      const update = updateAutomation(
        { ...actor, caller },
        { name: "notify", scope: "organization", enabled: false },
      );
      if (caller === "mcp") {
        await expect(update).rejects.toMatchObject({ statusCode: 409 });
        expect(resourcePutIfCurrentMock).toHaveBeenCalledOnce();
      } else {
        await expect(update).resolves.toMatchObject({
          meta: { enabled: false, lastStatus: "running" },
        });
        expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(2);
      }
    },
  );

  it("localizes the running MCP takeover refusal for the editor", async () => {
    getUserSettingMock.mockResolvedValue({ locale: "es-ES" });
    resourceGetByPathMock.mockResolvedValue(
      resource(
        eventAutomation.replace(
          "runAs: creator",
          "runAs: creator\nlastStatus: running",
        ),
      ),
    );

    await expect(
      updateAutomation(
        { ...actor, caller: "mcp" },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Esta automatización se está ejecutando. Espera a que termine antes de gestionarla mediante un agente externo.",
    });
    expect(getUserSettingMock).toHaveBeenCalledWith(
      "alice@example.com",
      "localization",
    );
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
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
      appId: "mail",
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

  it("defaults a new scheduled automation to an hourly cadence", async () => {
    resourceGetByPathMock
      .mockResolvedValueOnce(null)
      .mockImplementation(async (owner: string) =>
        resource(resourcePutWithDbMock.mock.calls.at(-1)?.[3] as string, owner),
      );

    const definition = await defineAutomation(actor, {
      name: "hourly-check",
      scope: "organization",
      triggerType: "schedule",
      body: "Check for changed work.",
    });

    expect(definition.meta.schedule).toBe("0 * * * *");
    expect(resourcePutWithDbMock).toHaveBeenCalledWith(
      expect.objectContaining({ execute: transactionExecuteMock }),
      orgOwner,
      "jobs/hourly-check.md",
      expect.stringContaining('schedule: "0 * * * *"'),
    );
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
        /appId: "mail"[\s\S]*createdBy: alice@example\.com[\s\S]*orgId: "org-1"[\s\S]*runAs: creator/,
      ),
    );
    expect(definition.meta).toMatchObject({
      triggerType: "event",
      createdBy: "alice@example.com",
      orgId: "org-1",
      appId: "mail",
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
        {
          userEmail: "collaborator@example.com",
          orgId: "org-1",
          appId: "mail",
        },
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
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      "organization",
    );
    expect(adminItems[0]?.canUpdate).toBe(true);

    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    const memberItems = await listAutomationDefinitions(
      { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
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
      {
        userEmail: "collaborator@example.com",
        orgId: "org-1",
        appId: "mail",
      },
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
    expect(resourcePutIfCurrentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: orgOwner,
        path: "jobs/notify.md",
        expectedId: "automation-1",
        content: expect.stringContaining("createdBy: alice@example.com"),
      }),
    );

    await expect(
      deleteAutomation(
        {
          userEmail: "collaborator@example.com",
          orgId: "org-1",
          appId: "mail",
        },
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

  it("refuses an execution host on an automation that names a job runner", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(
      resource(`---
schedule: "0 9 * * *"
timezone: UTC
enabled: true
triggerType: schedule
mode: agentic
runner: workflow
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
---

Send the digest.`),
    );

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        {
          name: "notify",
          scope: "organization",
          executionHostId: "remote-device-laptop",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("cannot also target an execution host"),
    });
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("lets an org admin update or delete without retargeting the creator", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      {
        name: "notify",
        scope: "organization",
        enabled: false,
        model: "claude-opus",
        reasoningEffort: "high",
        mcpTools: ["mcp__mail__read", "mcp__mail__send"],
      },
    );
    expect(updated.meta).toMatchObject({
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
      enabled: false,
      model: "claude-opus",
      reasoningEffort: "high",
      mcpTools: ["mcp__mail__read", "mcp__mail__send"],
    });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: orgOwner,
        path: "jobs/notify.md",
        content: expect.stringContaining("createdBy: alice@example.com"),
      }),
    );

    const updatedContent = resourcePutIfCurrentMock.mock.calls[0][0]
      .content as string;
    expect(updatedContent).toContain('deliveryPlatform: "slack"');
    expect(updatedContent).toContain('deliveryDestination: "channel-1"');
    expect(updatedContent).toContain("mcp__mail__send");
    expect(updatedContent.indexOf("deliveryPlatform:")).toBeGreaterThan(
      updatedContent.indexOf("mcpTools:"),
    );

    await deleteAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      "organization",
      "notify",
    );
    expect(transactionExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "resource-delete",
        args: ["automation-1"],
      }),
    );
  });

  it("rejects a stale non-D1 update as a 409 conflict without writing sharing", async () => {
    const automationResource = resource(eventAutomation);
    resolveAutomationAccessMock.mockResolvedValue(
      accessible(automationResource, "owner"),
    );
    resourceGetByPathMock.mockResolvedValue(automationResource);
    resourcePutIfCurrentMock.mockResolvedValue(null);

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
        { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
        {
          resourceId: "automation-1",
          enabled: false,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutWithDbMock).not.toHaveBeenCalled();
  });

  it("lifts a framework pause when the owner enables the automation again", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const pausedAutomation = eventAutomation
      .replace("enabled: true", "enabled: false")
      .replace(
        "runAs: creator",
        [
          "runAs: creator",
          "lastStatus: paused",
          'lastError: "Paused after 3 consecutive missing_tools failures: gone."',
          'lastErrorCode: "missing_tools"',
          "consecutiveFailures: 3",
          'pausedReason: "missing_tools"',
          'pausedAt: "2026-10-01T12:00:00.000Z"',
        ].join("\n"),
      );
    resourceGetByPathMock.mockResolvedValue(resource(pausedAutomation));

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: true },
    );

    const content = resourcePutIfCurrentMock.mock.calls[0][0].content as string;
    expect(content).toContain("enabled: true");
    for (const field of [
      "lastStatus",
      "lastError",
      "lastErrorCode",
      "consecutiveFailures",
      "pausedReason",
      "pausedAt",
    ]) {
      expect(content).not.toContain(`${field}:`);
    }
    expect(updated.meta.pausedReason).toBeUndefined();
    expect(updated.meta.enabled).toBe(true);
  });

  it("keeps a healthy automation's last status when it is enabled while already enabled", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(
      resource(
        eventAutomation.replace(
          "runAs: creator",
          "runAs: creator\nlastStatus: success",
        ),
      ),
    );

    await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: true },
    );

    expect(resourcePutIfCurrentMock.mock.calls[0][0].content).toContain(
      "lastStatus: success",
    );
  });

  it("preserves concurrent run state and MCP provenance when retrying an update", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const withRun = (status: string, runAt: string) =>
      resource(
        eventAutomation.replace(
          "runAs: creator",
          `runAs: creator\nlastStatus: ${status}\nlastRun: "${runAt}"`,
        ),
      );
    const before = withRun("success", "2026-10-01T00:00:00.000Z");
    const concurrentRun = {
      ...withRun("running", "2026-10-07T09:00:00.000Z"),
      content: withRun("running", "2026-10-07T09:00:00.000Z").content.replace(
        "runAs: creator",
        "runAs: creator\nmcpManaged: true",
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(concurrentRun);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentRun,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: false },
    );

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(2);
    const written = resourcePutIfCurrentMock.mock.calls[1][0].content as string;
    expect(written).toContain("enabled: false");
    expect(written).toContain("lastStatus: running");
    expect(written).toContain("2026-10-07T09:00:00.000Z");
    // The caller reports what landed, not the pre-conflict snapshot.
    expect(updated.meta.enabled).toBe(false);
    expect(updated.meta.lastStatus).toBe("running");
    expect(updated.meta.mcpManaged).toBe(true);
    expect(updated.resource.content).toBe(written);
  });

  it("re-derives nextRun over a schedule another writer changed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    try {
      executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
      const scheduled = (schedule: string) =>
        resource(`---
schedule: "${schedule}"
timezone: UTC
enabled: true
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
---

Send the digest.`);
      const before = scheduled("0 9 * * *");
      const concurrentSchedule = { ...scheduled("0 21 * * *"), updatedAt: 2 };
      resourceGetByPathMock
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(concurrentSchedule);
      resourcePutIfCurrentMock
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(
          async (input: { owner: string; path: string; content: string }) => ({
            ...concurrentSchedule,
            content: input.content,
          }),
        );

      await updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        { name: "notify", scope: "organization", timezone: "Asia/Tokyo" },
      );

      const written = resourcePutIfCurrentMock.mock.calls[1][0]
        .content as string;
      const { meta } = parseJobResource(written);
      expect(meta.schedule).toBe("0 21 * * *");
      expect(meta.timezone).toBe("Asia/Tokyo");
      expect(meta.nextRun).toBe(
        nextOccurrence("0 21 * * *", undefined, "Asia/Tokyo").toISOString(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a failure recorded after the update was read alone", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const scheduled = (failure: string) =>
      resource(`---
schedule: "0 9 * * *"
timezone: UTC
enabled: false
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
${failure}
---

Send the digest.`);
    const before = scheduled(
      [
        "lastStatus: paused",
        'lastErrorCode: "missing_credentials"',
        "consecutiveFailures: 3",
        'pausedReason: "missing_credentials"',
        'pausedAt: "2026-10-01T00:00:00.000Z"',
      ].join("\n"),
    );
    const concurrentFailure = {
      ...scheduled(
        [
          "lastStatus: error",
          'lastErrorCode: "http_502"',
          "consecutiveFailures: 1",
          'pausedReason: "http_502"',
          'pausedAt: "2026-10-10T00:00:00.000Z"',
        ].join("\n"),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(concurrentFailure);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentFailure,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", enabled: true },
    );

    expect(updated.meta.enabled).toBe(true);
    const written = resourcePutIfCurrentMock.mock.calls[1][0].content as string;
    expect(written).toContain('lastErrorCode: "http_502"');
    expect(written).toContain("consecutiveFailures: 1");
    expect(written).toContain('pausedReason: "http_502"');
    expect(written).not.toContain("missing_credentials");
  });

  it("does not report a change another writer already applied", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const requestedBody = "Updated digest.";
    const concurrent = {
      ...resource(
        eventAutomation.replace("Send the notification.", requestedBody),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrent);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrent,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      {
        userEmail: "admin@example.com",
        orgId: "org-1",
        appId: "mail",
        caller: "frontend",
      },
      { name: "notify", scope: "organization", body: requestedBody },
    );

    expect(updated.changed).toBe(false);
    expect(updated.body).toBe(requestedBody);
  });

  it("lifts the pause but keeps an active run marker on update", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const scheduled = (status: string) =>
      resource(`---
schedule: "0 9 * * *"
timezone: UTC
enabled: false
triggerType: schedule
mode: agentic
createdBy: alice@example.com
orgId: "org-1"
appId: mail
runAs: creator
lastStatus: ${status}
lastErrorCode: "missing_credentials"
consecutiveFailures: 3
pausedReason: "missing_credentials"
pausedAt: "2026-10-01T00:00:00.000Z"
---

Send the digest.`);
    const concurrentRun = { ...scheduled("running"), updatedAt: 2 };
    resourceGetByPathMock
      .mockResolvedValueOnce(scheduled("paused"))
      .mockResolvedValueOnce(concurrentRun);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentRun,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      {
        userEmail: "admin@example.com",
        orgId: "org-1",
        appId: "mail",
        caller: "frontend",
      },
      { name: "notify", scope: "organization", enabled: true },
    );

    expect(updated.meta.enabled).toBe(true);
    expect(updated.meta.lastStatus).toBe("running");
    expect(updated.meta.lastErrorCode).toBe("missing_credentials");
    expect(updated.meta.pausedReason).toBeUndefined();
    expect(updated.meta.pausedAt).toBeUndefined();
  });

  it("reports a change when the edit restores a value another writer changed", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const requestedBody = "Send the notification.";
    const concurrent = {
      ...resource(
        eventAutomation.replace(requestedBody, "Changed by another writer."),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrent);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrent,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
      { name: "notify", scope: "organization", body: requestedBody },
    );

    expect(updated.changed).toBe(true);
    expect(updated.body).toBe(requestedBody);
  });

  it("does not attribute a concurrent pause to a no-op update", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const concurrentPaused = {
      ...resource(
        eventAutomation.replace(
          "enabled: true",
          'enabled: false\nlastStatus: paused\npausedReason: "http_502"',
        ),
      ),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrentPaused);
    resourcePutIfCurrentMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        async (input: { owner: string; path: string; content: string }) => ({
          ...concurrentPaused,
          content: input.content,
        }),
      );

    const updated = await updateAutomation(
      {
        userEmail: "admin@example.com",
        orgId: "org-1",
        appId: "mail",
        caller: "frontend",
      },
      {
        name: "notify",
        scope: "organization",
        body: "Send the notification.",
      },
    );

    expect(updated.changed).toBe(false);
    expect(updated.meta.enabled).toBe(false);
  });

  it("rejects the retry when the automation is no longer an automation", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const legacyJob = `---
schedule: "0 9 * * *"
enabled: true
createdBy: alice@example.com
orgId: "org-1"
appId: mail
---

Run this as a recurring job.`;
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce({ ...resource(legacyJob), updatedAt: 2 });
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);

    await expect(
      updateAutomation(
        {
          userEmail: "admin@example.com",
          orgId: "org-1",
          appId: "mail",
          caller: "frontend",
        },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(1);
  });

  it("denies the retry when the automation no longer belongs to the app", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    const concurrentOtherApp = {
      ...resource(eventAutomation.replace("appId: mail", "appId: calendar")),
      updatedAt: 2,
    };
    resourceGetByPathMock
      .mockResolvedValueOnce(resource(eventAutomation))
      .mockResolvedValueOnce(concurrentOtherApp);
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);

    await expect(
      updateAutomation(
        {
          userEmail: "admin@example.com",
          orgId: "org-1",
          appId: "mail",
          caller: "frontend",
        },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with a conflict when the automation keeps changing", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));
    resourcePutIfCurrentMock.mockResolvedValue(null);

    await expect(
      updateAutomation(
        {
          userEmail: "admin@example.com",
          orgId: "org-1",
          appId: "mail",
          caller: "frontend",
        },
        { name: "notify", scope: "organization", enabled: false },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized reasoningEffort value", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        {
          name: "notify",
          scope: "organization",
          reasoningEffort: "extreme" as never,
        },
      ),
    ).rejects.toThrow(/Invalid reasoning effort/);
  });

  it("patches Factory extras in place instead of rebuilding the job document", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(
      resource(`---
enabled: true
slackChannelId: C0BUK2293SA
displayName: Slack feedback
triggerType: schedule
schedule: "*/5 * * * *"
createdBy: alice@example.com
orgId: "org-1"
appId: factory
runAs: creator
---

Observe Slack.`),
    );

    await updateAutomation(
      { userEmail: "admin@example.com", orgId: "org-1", appId: "factory" },
      {
        name: "notify",
        scope: "organization",
        enabled: false,
      },
    );

    const updatedContent = resourcePutIfCurrentMock.mock.calls[0][0]
      .content as string;
    expect(updatedContent).toContain("enabled: false");
    expect(updatedContent).toContain("slackChannelId: C0BUK2293SA");
    expect(updatedContent).toContain("displayName: Slack feedback");
    expect(updatedContent.indexOf("slackChannelId: C0BUK2293SA")).toBeLessThan(
      updatedContent.indexOf("triggerType: schedule"),
    );
  });

  it("rejects an invalid delegatedPolicyId on update without rewriting the job", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "admin" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));

    await expect(
      updateAutomation(
        { userEmail: "admin@example.com", orgId: "org-1", appId: "mail" },
        {
          name: "notify",
          scope: "organization",
          delegatedPolicyId: "crm-safe\nenabled: false",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/Delegated automation policy IDs/),
    });
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("rejects an ordinary org member mutating another creator's automation", async () => {
    executeMock.mockResolvedValue({ rows: [{ role: "member" }] });
    resourceGetByPathMock.mockResolvedValue(resource(eventAutomation));
    resolveAutomationAccessMock.mockResolvedValue(null);

    await expect(
      updateAutomation(
        { userEmail: "member@example.com", orgId: "org-1", appId: "mail" },
        {
          resourceId: "automation-1",
          enabled: false,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
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
      code: "owner_missing",
    });
  });

  it("marks a verified personal owner so background execution can preserve personal scope", async () => {
    const result = await resolveAutomationExecutionIdentity(
      "alice@example.com",
      {
        schedule: "",
        enabled: true,
        triggerType: "event",
        createdBy: "alice@example.com",
      },
    );

    expect(result).toEqual({
      ok: true,
      identity: {
        userEmail: "alice@example.com",
        orgScope: "personal",
        eventOwner: "alice@example.com",
      },
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
      code: "config_invalid",
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
