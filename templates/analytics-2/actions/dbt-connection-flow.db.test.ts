import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";

const state = vi.hoisted(() => ({
  dbtMode: "ok" as "ok" | "denied",
  dbtAuthorization: [] as string[],
  dbtBodies: [] as string[],
}));

const dbtToken = "dbt-service-token-marker";
const serviceAccount = "service-account-marker";

const modelNode = {
  uniqueId: "model.qa.qa_orders",
  name: "qa_orders",
  description: "Validated order facts",
  database: "qa-project",
  schema: "qa_sales",
  alias: "qa_orders",
  accountId: "42",
  projectId: "77",
  catalog: {
    runId: "9001",
    runGeneratedAt: "2024-05-01T00:00:00+00:00",
    columns: [
      { name: "order_id", description: "Order primary key", type: "string" },
      { name: "amount", description: "Gross amount", type: "numeric" },
    ],
  },
  tests: [
    {
      name: "not_null_qa_orders_order_id",
      columnName: "order_id",
      executionInfo: { lastRunStatus: "pass" },
    },
  ],
  executionInfo: {
    executeCompletedAt: "2024-05-01T01:00:00+00:00",
    lastSuccessRunId: "9001",
  },
  parents: [
    {
      uniqueId: "source.qa.qa_raw_orders",
      name: "qa_raw_orders",
      resourceType: "source",
    },
  ],
};

const sourceNode = {
  uniqueId: "source.qa.qa_raw_events",
  name: "qa_raw_events",
  description: "Raw event landing",
  database: "qa-project",
  schema: "qa_sales",
  identifier: "qa_raw_events",
  accountId: "42",
  projectId: "77",
  catalog: {
    runId: "9001",
    runGeneratedAt: "2024-05-01T00:00:00+00:00",
    columns: [{ name: "event_id", description: "Event id", type: "string" }],
  },
  freshness: {
    freshnessStatus: "warn",
    maxLoadedAt: "2024-05-02T00:00:00+00:00",
    freshnessRunId: "9002",
  },
  state: "warn",
  tests: [],
};

const legacyNode = {
  uniqueId: "model.qa.qa_legacy_orders",
  name: "qa_legacy_orders",
  description: "Legacy documented model",
  database: "qa-project",
  schema: "qa_sales",
  alias: "qa_legacy_orders",
  accountId: "42",
  projectId: "77",
  runId: "5005",
  runGeneratedAt: "2024-04-01T00:00:00+00:00",
  columns: [{ name: "id", description: "Legacy id", type: "integer" }],
  executeCompletedAt: "2024-04-01T02:00:00+00:00",
  tests: [{ name: "unique_legacy_id", columnName: "id", status: "pass" }],
  parentsModels: [
    { uniqueId: "model.qa.upstream", name: "upstream", resourceType: "model" },
  ],
  parentsSources: [],
};

function page(nodes: unknown[]) {
  return {
    edges: nodes.map((node) => ({ node })),
    pageInfo: { hasNextPage: false, endCursor: null },
  };
}

function dbtGraphql(query: string, variables: Record<string, unknown>) {
  if (query.includes("ValidateEnvironment"))
    return {
      data: { environment: { applied: { models: page([modelNode]) } } },
    };
  if (query.includes("job(id:"))
    return {
      data: {
        job: {
          models: variables.identifier === legacyNode.alias ? [legacyNode] : [],
          sources: [],
        },
      },
    };
  const kind = query.includes("sources(") ? "sources" : "models";
  const byIdentifier: Record<string, unknown> = {
    qa_orders: { models: [modelNode], sources: [] },
    qa_raw_events: { models: [], sources: [sourceNode] },
  };
  const nodes =
    byIdentifier[String(variables.identifier)]?.[
      kind as "models" | "sources"
    ] ?? [];
  return { data: { environment: { applied: { [kind]: page(nodes) } } } };
}

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: async (
    url: string | URL,
    init?: { headers?: Record<string, string>; body?: string },
  ) => {
    const target = String(url);
    state.dbtAuthorization.push(init?.headers?.Authorization ?? "");
    if (state.dbtMode === "denied")
      return new Response("denied", { status: 401 });
    state.dbtBodies.push(init?.body ?? target);
    const payload = init?.body
      ? dbtGraphql(
          String(JSON.parse(init.body).query),
          JSON.parse(init.body).variables ?? {},
        )
      : {
          data: [
            {
              id: 5,
              project_id: 77,
              environment_id: 9,
              generate_docs: true,
            },
          ],
          status: { is_success: true },
        };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
}));

vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/data-connection-provider.js")
    >()),
    // External provider I/O only: service-account validation and query transport.
    validateSubmittedServiceAccount: async () => {},
    executeQueryPage: async () => ({
      jobComplete: true,
      status: "complete" as const,
      jobReference: { projectId: "qa-project", jobId: "qa-job" },
      columns: [{ name: "order_id", type: "string" }],
      rows: [["order-1"]],
      totalRows: "1",
      totalBytesProcessed: "0",
      pageToken: null,
      hasNextPage: false,
    }),
  }),
);

vi.mock("../server/model/data-table-provider.js", () => ({
  // External BigQuery REST read only.
  requestTableDetails: async (
    _runtime: unknown,
    table: { projectId: string; datasetId: string; tableId: string },
  ) => ({
    projectId: table.projectId,
    datasetId: table.datasetId,
    tableId: table.tableId,
    name: table.tableId,
    type: "TABLE",
    description: "Warehouse table",
    numRows: "10",
    numBytes: "100",
    lastModifiedTime: null,
    columnCount: 1,
    columns: [
      {
        name: "order_id",
        type: "STRING",
        mode: "NULLABLE",
        description: null,
        fields: [],
      },
    ],
  }),
}));

import { getDb } from "../server/db/index.js";
import {
  deleteDataConnection,
  executeConnectionQuery,
} from "../server/model/data-connections.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import getConnectionForm from "./get-data-connection-form.js";
import getSaveResult from "./get-data-connection-save-result.js";
import getDbtMetadata from "./get-data-dbt-metadata.js";
import listConnections from "./list-data-connections.js";
import saveConnection from "./save-data-connection.js";

const round = mkdtempSync(join(tmpdir(), "dbt-flow-"));
const previousDatabase = process.env.DATABASE_URL;
const previousSecret = process.env.BETTER_AUTH_SECRET;
const orgId = `qa-dbt-flow-${randomUUID()}`;
const actor = "dbt-flow-owner@example.test";
const appId = "analytics-2";

const asActor = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: actor, orgId, authUserId: actor, isSyntheticTraffic: true },
    call,
  );

const actionContext = {
  caller: "frontend" as const,
  userEmail: actor,
  orgId,
  appId,
};

beforeEach(() => {
  state.dbtMode = "ok";
  state.dbtAuthorization = [];
  state.dbtBodies = [];
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_dbt_flow_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA dbt flow workspace",
    createdBy: actor,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: actor,
    role: "owner",
    joinedAt: Date.now(),
  });
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;
  const owned = resolve(round);
  if (!owned.startsWith(resolve(tmpdir()) + "/dbt-flow-"))
    throw new Error("Refused own runtime cleanup");
  rmSync(owned, { recursive: true, force: true });
});

it("runs the real dbt save, vault, form, metadata and query flow end to end", async () => {
  const saveRequestId = randomUUID();
  const draft = await asActor(() =>
    saveConnection.run(
      {
        requestId: saveRequestId,
        type: "bigquery",
        draft: true,
        values: {
          name: "QA dbt flow draft",
          projectId: "qa-project",
          serviceAccount,
          includeForAI: true,
          queryAccessGroupIds: ["workspace"],
          hasDbtMetadata: true,
          dbtVersion: "current",
          dbtEnvironmentId: "9",
          dbtCloudHostname: "cloud.getdbt.com",
          dbtToken,
        },
      },
      actionContext,
    ),
  );
  expect(draft.isDraft).toBe(true);
  // A draft save never sends the token to dbt; activation validates it.
  expect(state.dbtAuthorization).toEqual([]);

  const draftSaveResult = await asActor(() =>
    getSaveResult.run({ requestId: saveRequestId }, actionContext),
  );
  expect(draftSaveResult.connection.id).toBe(draft.id);
  expect(JSON.stringify(draftSaveResult)).not.toContain(dbtToken);

  const activated = await asActor(() =>
    saveConnection.run(
      {
        requestId: randomUUID(),
        id: draft.id,
        type: "bigquery",
        draft: false,
        values: { name: "QA dbt flow active" },
      },
      actionContext,
    ),
  );
  expect(activated.isDraft).toBe(false);
  expect(activated.hasDbtMetadata).toBe(true);
  expect(activated.aiUsage).toBe("included");
  // Real dbt validation used the vault-resolved token, not a stored echo.
  expect(state.dbtAuthorization).toEqual([`Token ${dbtToken}`]);

  const listed = await asActor(() => listConnections.run({}, actionContext));
  expect(
    listed.connections.find((row) => row.id === draft.id)?.hasDbtMetadata,
  ).toBe(true);

  const form = await asActor(() =>
    getConnectionForm.run({ id: draft.id }, actionContext),
  );
  expect(form.connection.hasDbtMetadata).toBe(true);
  expect(form.configuredCredentialFields).toEqual([
    "serviceAccount",
    "dbtToken",
  ]);
  expect(form.values.hasDbtMetadata).toBe(true);
  expect(form.values.dbtEnvironmentId).toBe("9");
  expect(form.values).not.toHaveProperty("serviceAccount");
  expect(form.values).not.toHaveProperty("dbtToken");
  expect(JSON.stringify(form)).not.toContain(dbtToken);

  state.dbtAuthorization = [];
  const modelTableId = `table:${encodeURIComponent("qa-project")}:${encodeURIComponent("qa_sales")}:${encodeURIComponent("qa_orders")}`;
  const model = await asActor(() =>
    getDbtMetadata.run(
      { connectionId: draft.id, tableId: modelTableId },
      actionContext,
    ),
  );
  expect(
    state.dbtAuthorization.every((header) => header === `Token ${dbtToken}`),
  ).toBe(true);
  expect(model.metadata).toMatchObject({
    uniqueId: "model.qa.qa_orders",
    resourceType: "model",
    description: "Validated order facts",
    columns: [
      { name: "order_id", description: "Order primary key", type: "string" },
      { name: "amount", description: "Gross amount", type: "numeric" },
    ],
    tests: [
      {
        name: "not_null_qa_orders_order_id",
        status: "pass",
        columnName: "order_id",
      },
    ],
    lastRefreshed: "2024-05-01T01:00:00+00:00",
    freshness: null,
    docsUrl:
      "https://cloud.getdbt.com/accounts/42/runs/9001/docs/#!/model/model.qa.qa_orders",
  });
  expect(JSON.stringify(model)).not.toContain(dbtToken);

  const sourceTableId = `table:${encodeURIComponent("qa-project")}:${encodeURIComponent("qa_sales")}:${encodeURIComponent("qa_raw_events")}`;
  const source = await asActor(() =>
    getDbtMetadata.run(
      { connectionId: draft.id, tableId: sourceTableId },
      actionContext,
    ),
  );
  expect(source.metadata).toMatchObject({
    uniqueId: "source.qa.qa_raw_events",
    resourceType: "source",
    lastRefreshed: "2024-05-02T00:00:00+00:00",
    freshness: "warn",
  });

  // Real SQL read-only validation runs before the stubbed provider transport.
  await expect(
    asActor(() =>
      executeConnectionQuery(
        {
          connectionId: draft.id,
          query: "DELETE FROM qa_sales.qa_orders",
          first: 1,
        },
        { userEmail: actor, orgId, caller: "frontend" },
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "warehouse_query_not_readonly" });
  const query = await asActor(() =>
    executeConnectionQuery(
      {
        connectionId: draft.id,
        query: "SELECT order_id FROM qa_sales.qa_orders",
        first: 1,
      },
      { userEmail: actor, orgId, caller: "frontend" },
    ),
  );
  expect(query).toMatchObject({
    status: "complete",
    columns: [{ name: "order_id", type: "string" }],
    rows: [["order-1"]],
  });

  // Close and reopen the store: the encrypted credential must still decrypt.
  await closeDbExec();
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();

  const reopened = await asActor(() =>
    getConnectionForm.run({ id: draft.id }, actionContext),
  );
  expect(reopened.connection.id).toBe(draft.id);
  expect(reopened.configuredCredentialFields).toContain("dbtToken");
  expect(JSON.stringify(reopened)).not.toContain(dbtToken);
  state.dbtAuthorization = [];
  const readback = await asActor(() =>
    getDbtMetadata.run(
      { connectionId: draft.id, tableId: modelTableId },
      actionContext,
    ),
  );
  expect(readback.metadata?.description).toBe("Validated order facts");
  expect(state.dbtAuthorization).toEqual([`Token ${dbtToken}`]);

  // The legacy configuration shape is served by the same helpers.
  const legacy = await asActor(() =>
    saveConnection.run(
      {
        requestId: randomUUID(),
        type: "bigquery",
        draft: false,
        values: {
          name: "QA dbt legacy",
          projectId: "qa-project",
          serviceAccount,
          includeForAI: true,
          queryAccessGroupIds: ["workspace"],
          hasDbtMetadata: true,
          dbtVersion: "legacy",
          dbtAccountId: "42",
          dbtProjectId: "77",
          dbtEnvironmentId: "9",
          dbtCloudHostname: "cloud.getdbt.com",
          dbtToken,
        },
      },
      actionContext,
    ),
  );
  const legacyTableId = `table:${encodeURIComponent("qa-project")}:${encodeURIComponent("qa_sales")}:${encodeURIComponent("qa_legacy_orders")}`;
  const legacyMetadata = await asActor(() =>
    getDbtMetadata.run(
      { connectionId: legacy.id, tableId: legacyTableId },
      actionContext,
    ),
  );
  expect(legacyMetadata.metadata).toMatchObject({
    uniqueId: "model.qa.qa_legacy_orders",
    description: "Legacy documented model",
    columns: [{ name: "id", description: "Legacy id", type: "integer" }],
    tests: [{ name: "unique_legacy_id", status: "pass", columnName: "id" }],
    lastRefreshed: "2024-04-01T02:00:00+00:00",
    docsUrl:
      "https://cloud.getdbt.com/accounts/42/runs/5005/docs/#!/model/model.qa.qa_legacy_orders",
  });
  // The public action omits dbt parent lineage.
  expect(legacyMetadata.metadata).not.toHaveProperty("parents");

  for (const id of [draft.id, legacy.id])
    await asActor(() => deleteDataConnection({ id }));
  const remaining = await asActor(() => listConnections.run({}, actionContext));
  expect(
    remaining.connections.filter(
      (connection) => connection.id !== SAMPLE_DATA_SOURCE_ID,
    ),
  ).toEqual([]);
  expect(remaining.connections).toContainEqual(
    expect.objectContaining({ id: SAMPLE_DATA_SOURCE_ID }),
  );
  expect(await asActor(() => getWorkspaceConnection(draft.id))).toBeNull();
  const rows = await getDbExec().execute({
    sql: "SELECT COUNT(*) AS count FROM settings WHERE key LIKE ?",
    args: ["%credential:%"],
  });
  expect(Number(rows.rows[0]?.count)).toBe(0);
});

it("rejects an unusable dbt token when activating and leaves no active connection", async () => {
  const saved = await asActor(() =>
    saveConnection.run(
      {
        requestId: randomUUID(),
        type: "bigquery",
        draft: true,
        values: {
          name: "QA dbt token rejection",
          projectId: "qa-project",
          serviceAccount,
          hasDbtMetadata: true,
          dbtVersion: "current",
          dbtEnvironmentId: "9",
          dbtCloudHostname: "cloud.getdbt.com",
          dbtToken,
        },
      },
      actionContext,
    ),
  );
  state.dbtMode = "denied";
  await expect(
    asActor(() =>
      saveConnection.run(
        {
          requestId: randomUUID(),
          id: saved.id,
          type: "bigquery",
          draft: false,
          values: { name: "QA dbt token rejection active" },
        },
        actionContext,
      ),
    ),
  ).rejects.toMatchObject({
    statusCode: 401,
    errorCode: "data_dbt_access_denied",
  });
  const stored = await asActor(() => getWorkspaceConnection(saved.id));
  expect(stored?.status).toBe("disabled");
  expect(stored?.config.draft).toBe(true);
  const active = await asActor(() => listConnections.run({}, actionContext));
  expect(
    active.connections.find((connection) => connection.id === saved.id)
      ?.isDraft,
  ).toBe(true);
  await asActor(() => deleteDataConnection({ id: saved.id }));
  expect(await asActor(() => getWorkspaceConnection(saved.id))).toBeNull();
});
