import { hashEmail } from "@agent-native/core/mcp-client";
import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auditRows = vi.hoisted(() => [] as Record<string, unknown>[]);
const listToolsMock = vi.hoisted(() => vi.fn());
const callToolMock = vi.hoisted(() => vi.fn());
const savedServersMock = vi.hoisted(() => vi.fn());
const contentServersMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../packages/core/dist/audit/store.js", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async (event: Record<string, unknown>) => {
    auditRows.push(event);
  },
}));
vi.mock("@agent-native/core/mcp-client", async (original) => ({
  ...(await original<object>()),
  listVisibleMcpTools: listToolsMock,
  listRemoteServers: savedServersMock,
  findConnectedMcpServersForProvider: contentServersMock,
  callMcpTool: callToolMock,
}));
vi.mock("../lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: async () => undefined,
}));
vi.mock("../lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: async () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../lib/factory-automation-resources.js", () => ({
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));
vi.mock("../lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));

import * as upsertContentRow from "../../actions/upsert-content-row.js";
import type { OperationExecutor } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationCatalog } from "../workflow/operations.js";
import {
  fixed,
  fromPath,
  type NodeSpec,
} from "../workflow/story-graphs.fixture.js";
import {
  chain,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../workflow/testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../workflow/testing/make-host.js";
import { buildTestCatalog } from "../workflow/testing/test-catalog.js";
import { createOperationExecutor } from "./operation-executor.js";

const registry = loadActionsFromStaticRegistry({
  "upsert-content-row": upsertContentRow,
});

const testCatalog = buildTestCatalog();
const catalog: OperationCatalog = {
  get: (id) => testCatalog.get(id) ?? OPERATION_CATALOG.get(id),
};

async function setup(graph: ReturnType<typeof chain>) {
  const test = makeHost({ catalog });
  const fake = test.operations;
  const real = createOperationExecutor({
    owner: "owner@example.test",
    orgId: test.scope.orgId,
    factoryId: test.scope.factoryId,
    automation: {
      triggerId: "job-1",
      triggerName: `factories/${test.scope.factoryId}/flow`,
    },
    runId: "run-1",
    signal: new AbortController().signal,
    deps: { actions: async () => registry },
  });
  // raw-sql-ok: the workflow operation executor, not a database call
  const executor: OperationExecutor = {
    execute: (request) =>
      request.operation.provider === "test"
        ? fake.execute(request)
        : real.execute(request),
  };
  Object.assign(test.host, { operations: executor });
  const workflow = await seedWorkflow(test, graph);
  return { test, fake, id: workflow.id };
}

const SERVER = `user_${hashEmail("owner@example.test")}_content`;
const KEY = "prop-key";
const COLLECTION = "https://content.agent-native.com/page/doc-db";

const tools = (serverId = SERVER) => [
  { serverId, name: "get-content-database", description: "", inputSchema: {} },
  {
    serverId,
    name: "upsert-database-item-by-key",
    description: "",
    inputSchema: {},
  },
];
const answer = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});
const collection = (rows: unknown[] = []) =>
  answer({
    mutationContract: {
      target: {
        authorityScope: { kind: "organization", id: "org-1" },
        spaceId: "space-1",
        databaseId: "db-1",
        databaseDocumentId: "doc-db",
      },
      schemaRevision: "schema-7",
      naturalKeyPropertyId: KEY,
      properties: [
        { id: KEY, name: "Key", type: "text", writable: true },
        { id: "prop-status", name: "Status", type: "select", writable: true },
      ],
    },
    items: rows,
    pagination: { hasMore: false },
  });
const receipt = (outcome: string) =>
  answer({
    receipt: {
      outcome,
      row: {
        itemId: "item-1",
        documentId: "doc-row",
        urlPath: "/page/doc-row?databaseId=db-1&databaseDocumentId=doc-db",
        rowRevision: "rev-4",
      },
    },
  });

function connected(write: () => unknown = () => receipt("created")) {
  listToolsMock.mockResolvedValue(tools());
  const saved = {
    id: "saved-1",
    name: "content",
    url: "https://content.agent-native.com/_agent-native/mcp",
  };
  savedServersMock.mockResolvedValue([saved]);
  contentServersMock.mockResolvedValue({
    servers: [{ ...saved, scope: "user" }],
    unreadableScopes: [],
  });
  callToolMock.mockImplementation(
    async (_serverId: string, name: string, args: Record<string, unknown>) => {
      if (name === "get-content-database") return collection();
      if (name === "upsert-database-item-by-key") return write();
      throw new Error(`unplanned ${name} ${JSON.stringify(args)}`);
    },
  );
}

const writes = () =>
  callToolMock.mock.calls.filter(
    ([, name]) => name === "upsert-database-item-by-key",
  );

const offered = (extras: Record<string, unknown>) =>
  sourceResult([normalizedItem("a", { extras })]);

const addRow = () =>
  [
    "row",
    "action",
    {
      operation: "content.upsertRow",
      args: {
        collection: fixed(COLLECTION),
        key: fromPath("item.extras.key"),
        title: fromPath("item.extras.title"),
        values: fixed({ Status: "Done" }),
      },
    },
  ] as NodeSpec;

beforeEach(() => {
  auditRows.length = 0;
  listToolsMock.mockReset();
  savedServersMock.mockReset();
  contentServersMock.mockReset();
  callToolMock.mockReset();
});

afterEach(() => {
  for (const [serverId, name, , options] of callToolMock.mock.calls) {
    expect(serverId).toBe(SERVER);
    expect(["get-content-database", "upsert-database-item-by-key"]).toContain(
      name,
    );
    expect(options).toMatchObject({ providerId: "content" });
  }
});

describe("content.upsertRow, run through the engine", () => {
  it("adds the row in a live run: two reads, one write, a receipt, and an audit row without the values", async () => {
    const { test, fake, id } = await setup(chain([addRow()]));
    fake.script("test.items", offered({ key: "TASK-1", title: "Fix login" }));
    connected();

    const result = await ran(test, id);

    expect(callToolMock.mock.calls.map(([, name]) => name)).toEqual([
      "get-content-database",
      "get-content-database",
      "upsert-database-item-by-key",
    ]);
    expect(writes()[0]?.[2]).toMatchObject({
      keyValue: "TASK-1",
      expectedRowRevision: null,
      title: "Fix login",
      propertyEntries: [
        { propertyId: "prop-status", propertyType: "select", value: "Done" },
      ],
    });
    expect(stepOf(result, "row")).toMatchObject({ status: "succeeded" });
    expect(result.run.counts).toMatchObject({ done: 1, itemFailures: 0 });
    const effect = (await eventsOf(test, id, "a")).find(
      (event) => event.nodeId === "row" && event.kind === "effect",
    );
    expect(effect?.summary).toContain("called content.upsertRow");

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "upsert-content-row",
      caller: "automation",
      targetType: "content-row",
      targetId: "doc-row",
      visibility: "private",
      status: "success",
      summary: "Added a Content row",
      input: null,
    });
    expect(JSON.stringify(auditRows[0])).not.toContain("Done");
  });

  it("stops for a person, and never writes again, when the write's outcome is unknown", async () => {
    const { test, fake, id } = await setup(chain([addRow()]));
    fake.script("test.items", offered({ key: "TASK-1", title: "Fix login" }));
    connected(() => {
      throw new Error("socket hang up");
    });

    const first = await ran(test, id);
    fake.script("test.items", offered({ key: "TASK-1", title: "Fix login" }));
    const second = await ran(test, id);

    expect(stepOf(first, "row")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
    expect(stepOf(first, "row").error?.message).toContain(
      "content_write_outcome_unknown",
    );
    expect(second.run.counts.done).toBe(0);
    expect(writes()).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "upsert-content-row",
      status: "error",
      summary: "Tried to write a Content row",
    });
  });

  it("sends nothing and says Content is not connected when the owner has only a workspace connection", async () => {
    const { test, fake, id } = await setup(chain([addRow()]));
    fake.script("test.items", offered({ key: "TASK-1", title: "Fix login" }));
    connected();
    listToolsMock.mockResolvedValue(tools("org_acme_content"));
    savedServersMock.mockResolvedValue([]);
    contentServersMock.mockResolvedValue({ servers: [], unreadableScopes: [] });

    const result = await ran(test, id);

    expect(stepOf(result, "row")).toMatchObject({
      status: "failed",
      error: { code: "credential_missing" },
    });
    const message = stepOf(result, "row").error?.message ?? "";
    expect(message).toContain("Only the workflow's owner can connect Content");
    expect(message.split("request-workflow-connection")).toHaveLength(2);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("never writes in a dry run", async () => {
    const { test, fake, id } = await setup(chain([addRow()]));
    fake.script("test.items", offered({ key: "TASK-1", title: "Fix login" }));
    connected();

    const result = await ran(test, id, { mode: "dry" });

    expect(callToolMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
    expect(stepOf(result, "row")).toMatchObject({
      status: "succeeded",
      fields: { wouldCallCount: 1 },
    });
  });
});
