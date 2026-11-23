// dbt Cloud Discovery contract test (simulated provider transport).
//
// The dbt transport is answered from the small fixture next to this file, which
// carries expected metadata derived from the public jaffle_shop sample
// (github.com/dbt-labs/jaffle_shop_duckdb, Apache-2.0) plus synthetic Cloud ids.
// Apache-2.0 attribution: actions/fixtures/dbt-cloud-contract.NOTICE.md.
//
// This proves the shipped action/vault/form wiring against the recorded wire
// contract. It is NOT genuine dbt Cloud authentication and not a served-UI claim.
//
// The fixture's GraphQL documents are this test's independent request contract.
// A recorded response is served only when the whole operation, variables and
// document match; whitespace and commas are insignificant, but removing the
// applied filter or a selected metadata field is not. The query transform below
// is a test-only seam: it proves that red proof without editing product source.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";

type WireRequest = {
  method: string;
  url: string;
  operation: string | null;
  kind: "models" | "sources" | null;
  variables: Record<string, unknown> | null;
  query: string | null;
  authorization: string | null;
};

type FixtureCall = {
  method?: string;
  url: string;
  operation?: string;
  variables?: Record<string, unknown>;
  query?: string;
  queryWithFreshnessCriteria?: string;
  response: unknown;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/dbt-cloud-contract.fixture.json", import.meta.url),
    "utf8",
  ),
) as {
  providerProject: string;
  datasetId: string;
  environmentId: string;
  dbtMarker: string;
  serviceAccountMarker: string;
  current: {
    validateEnvironment: FixtureCall;
    tableCalls: Record<string, FixtureCall>;
  };
  legacy: {
    listJobs: FixtureCall;
    validateJob: FixtureCall;
    tableCalls: Record<string, FixtureCall>;
  };
  expected: Record<
    "orders" | "raw_orders",
    {
      uniqueId: string;
      resourceType: "model" | "source";
      description: string | null;
      columns: {
        name: string;
        description: string | null;
        type: string | null;
      }[];
      lastRefreshed: string | null;
      freshness: string | null;
      tests: {
        name: string;
        status: string | null;
        columnName: string | null;
      }[];
      docsUrl: string | null;
    }
  >;
};

const model = "model.jaffle_shop.orders";
const source = "source.jaffle_shop.jaffle_raw.raw_orders";

const state = vi.hoisted(() => ({
  mode: "current" as "current" | "legacy",
  override: null as null | ((request: WireRequest) => unknown | undefined),
  queryTransform: null as null | ((query: string) => string),
  requests: [] as WireRequest[],
}));

function tableIdentity(identifier: string) {
  return `table:${fixture.providerProject}:${fixture.datasetId}:${identifier}`;
}

function recordedKind(call: FixtureCall) {
  const data = (call.response as { data?: Record<string, unknown> }).data ?? {};
  const branch =
    (data.environment as { applied?: Record<string, unknown> })?.applied ??
    (data.job as Record<string, unknown> | undefined);
  if (!branch) return null;
  if ("models" in branch) return "models" as const;
  if ("sources" in branch) return "sources" as const;
  return null;
}

function canonical(value: Record<string, unknown> | null) {
  if (value === null) return "null";
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

// GraphQL equivalence at the request-contract level: insignificant whitespace,
// commas and comments disappear, while every name, variable, argument, field
// and punctuation token is compared. String literals stay byte-exact.
function canonicalGraphql(query: string | null) {
  if (query === null) return "null";
  const tokens: string[] = [];
  let index = 0;
  const isName = (character: string) => /[A-Za-z0-9_]/.test(character);
  while (index < query.length) {
    const character = query.charAt(index);
    if (/\s/.test(character) || character === ",") {
      index++;
      continue;
    }
    if (character === "#") {
      while (index < query.length && !/[\r\n]/.test(query.charAt(index)))
        index++;
      continue;
    }
    if (character === '"') {
      const block = query.startsWith('"""', index);
      const quote = block ? '"""' : '"';
      let cursor = index + quote.length;
      let value = "";
      while (cursor < query.length && !query.startsWith(quote, cursor)) {
        if (!block && query[cursor] === "\\") {
          value += query.slice(cursor, cursor + 2);
          cursor += 2;
          continue;
        }
        value += query[cursor];
        cursor++;
      }
      if (cursor >= query.length)
        throw new Error("Unterminated GraphQL string in contract request.");
      tokens.push(`string:${JSON.stringify(value)}`);
      index = cursor + quote.length;
      continue;
    }
    if (isName(character)) {
      let cursor = index + 1;
      while (cursor < query.length && isName(query.charAt(cursor))) cursor++;
      tokens.push(`name:${query.slice(index, cursor)}`);
      index = cursor;
      continue;
    }
    if (query.startsWith("...", index)) {
      tokens.push("punct:...");
      index += 3;
      continue;
    }
    tokens.push(`punct:${character}`);
    index++;
  }
  return tokens.join("\u0000");
}

function recordedCall(request: WireRequest, mode: "current" | "legacy") {
  const calls =
    mode === "current"
      ? [
          fixture.current.validateEnvironment,
          ...Object.values(fixture.current.tableCalls),
        ]
      : [
          fixture.legacy.listJobs,
          fixture.legacy.validateJob,
          ...Object.values(fixture.legacy.tableCalls),
        ];
  // A recorded call matches only when the method, URL, operation, every
  // GraphQL variable and the full document match, so a drifted filter, dropped
  // selection field or changed argument cannot silently reuse a recorded
  // response. Source documents now also require the additive freshness selection;
  // the prior documents remain in the fixture as the earlier contract version.
  return calls.find(
    (call) =>
      call.url === request.url &&
      recordedKind(call) === request.kind &&
      (call.operation ?? null) === request.operation &&
      (call.method ?? "POST") === request.method &&
      canonical(call.variables ?? null) ===
        canonical(request.variables ?? null) &&
      canonicalGraphql(
        call.queryWithFreshnessCriteria ?? call.query ?? null,
      ) === canonicalGraphql(request.query),
  );
}

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: async (
    url: string | URL,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    let operation: string | null = null;
    let variables: Record<string, unknown> | null = null;
    let query: string | null = null;
    let kind: "models" | "sources" | null = null;
    if (init?.body) {
      const body = JSON.parse(init.body) as {
        query?: string;
        variables?: Record<string, unknown>;
      };
      query = state.queryTransform
        ? state.queryTransform(body.query ?? "")
        : (body.query ?? null);
      operation = /query\s+(\w+)/.exec(query ?? "")?.[1] ?? null;
      variables = body.variables ?? null;
      kind = /\bmodels\s*\(/.test(query ?? "")
        ? "models"
        : /\bsources\s*\(/.test(query ?? "")
          ? "sources"
          : null;
    }
    const request: WireRequest = {
      method: init?.method ?? "GET",
      url: String(url),
      operation,
      kind,
      variables,
      query,
      authorization: init?.headers?.Authorization ?? null,
    };
    state.requests.push(request);
    const overridden = state.override?.(request);
    if (overridden !== undefined)
      return new Response(JSON.stringify(overridden), { status: 200 });
    const call = recordedCall(request, state.mode);
    if (!call)
      return new Response("unrecorded fixture request", { status: 599 });
    return new Response(JSON.stringify(call.response), { status: 200 });
  },
}));

vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/data-connection-provider.js")
    >()),
    // External provider I/O only: service-account validation is not the subject.
    validateSubmittedServiceAccount: async () => {},
  }),
);

vi.mock("../server/model/data-table-provider.js", () => ({
  // External warehouse read only; table policy and dbt metadata stay real.
  requestTableDetails: async (
    _runtime: unknown,
    table: { projectId: string; datasetId: string; tableId: string },
  ) => ({
    projectId: table.projectId,
    datasetId: table.datasetId,
    tableId: table.tableId,
    name: table.tableId,
    type: "TABLE",
    description: null,
    numRows: null,
    numBytes: null,
    lastModifiedTime: null,
    columnCount: 0,
    columns: [],
  }),
}));

import { getDb } from "../server/db/index.js";
import { deleteDataConnection } from "../server/model/data-connections.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import getConnectionForm from "./get-data-connection-form.js";
import getSaveResult from "./get-data-connection-save-result.js";
import getDbtMetadata from "./get-data-dbt-metadata.js";
import saveConnection from "./save-data-connection.js";

const round = mkdtempSync(join(tmpdir(), "dbt-contract-"));
const previousDatabase = process.env.DATABASE_URL;
const previousSecret = process.env.BETTER_AUTH_SECRET;
const orgId = `qa-dbt-contract-${randomUUID()}`;
const actor = "dbt-contract-owner@example.test";
const actionContext = {
  caller: "frontend" as const,
  userEmail: actor,
  orgId,
  appId: "analytics-2",
};

const asActor = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: actor, orgId, authUserId: actor, isSyntheticTraffic: true },
    call,
  );

const ownedConnections = new Set<string>();
const ownedCredentialKeys = new Set<string>();

type StoredConnection = {
  config: Record<string, unknown>;
  credentialRefs: readonly { key: string }[];
};

function connectionCredentialKeys(connection: StoredConnection) {
  return new Set([
    ...connection.credentialRefs.map((ref) => ref.key),
    ...["dbtCredentialKey", "serviceAccountCredentialKey"]
      .map((field) => connection.config[field])
      .filter((key): key is string => typeof key === "string"),
  ]);
}

async function trackOwnedConnection(id: string) {
  ownedConnections.add(id);
  const connection = await asActor(() => getWorkspaceConnection(id));
  if (connection)
    for (const key of connectionCredentialKeys(connection))
      ownedCredentialKeys.add(key);
}

function scopedCredentialKey(key: string) {
  return `o:${orgId}:credential:${key}`;
}

async function ownedCredentialRowCount() {
  let total = 0;
  for (const key of ownedCredentialKeys) {
    const rows = await getDbExec().execute({
      sql: "SELECT COUNT(*) AS count FROM settings WHERE key = ?",
      args: [scopedCredentialKey(key)],
    });
    const count = rows.rows[0]?.count;
    if (
      rows.rows.length !== 1 ||
      !["number", "string", "bigint"].includes(typeof count) ||
      !/^\d+$/.test(String(count))
    )
      throw new Error("Credential cleanup aggregate is unavailable.");
    const value = Number(count);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Credential cleanup aggregate is invalid.");
    total += value;
    if (!Number.isSafeInteger(total))
      throw new Error("Credential cleanup total is invalid.");
  }
  return total;
}

// Runs even when an assertion fails earlier in a test. Owned rows are deleted
// first, then the scoped vault readback proves both the connection and every
// credential it created are gone. Only counts and connection ids are reported.
async function cleanupOwnedConnections() {
  const failures: string[] = [];
  for (const id of [...ownedConnections]) {
    try {
      const connection = await asActor(() => getWorkspaceConnection(id));
      if (connection) {
        for (const key of connectionCredentialKeys(connection))
          ownedCredentialKeys.add(key);
        await asActor(() => deleteDataConnection({ id }));
      }
      if ((await asActor(() => getWorkspaceConnection(id))) !== null)
        failures.push(`connection ${id} survived cleanup`);
    } catch {
      failures.push(`connection ${id} cleanup rejected`);
    }
  }
  try {
    if ((await ownedCredentialRowCount()) !== 0)
      failures.push("owned credential rows survived cleanup");
  } catch {
    failures.push("credential cleanup readback failed");
  }
  if (failures.length)
    throw new Error(
      `Owned dbt contract cleanup failed: ${failures.join("; ")}`,
    );
}

const values = (mode: "current" | "legacy") => ({
  name: `QA dbt contract ${mode}`,
  projectId: fixture.providerProject,
  serviceAccount: fixture.serviceAccountMarker,
  includeForAI: true,
  queryAccessGroupIds: ["workspace"],
  hasDbtMetadata: true,
  dbtVersion: mode,
  dbtCloudHostname: "cloud.getdbt.com",
  dbtToken: fixture.dbtMarker,
  dbtEnvironmentId: fixture.environmentId,
  ...(mode === "legacy" ? { dbtAccountId: "42", dbtProjectId: "77" } : {}),
});

beforeEach(() => {
  state.mode = "current";
  state.override = null;
  state.queryTransform = null;
  state.requests = [];
});

afterEach(async () => {
  await cleanupOwnedConnections();
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_dbt_contract_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA dbt contract workspace",
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
  try {
    await cleanupOwnedConnections();
  } finally {
    await closeDbExec();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousSecret;
    const owned = resolve(round);
    if (!owned.startsWith(resolve(tmpdir()) + "/dbt-contract-"))
      throw new Error("Refused own runtime cleanup");
    rmSync(owned, { recursive: true });
  }
});

async function connect(mode: "current" | "legacy") {
  state.mode = mode;
  state.requests = [];
  const saved = await asActor(() =>
    saveConnection.run(
      {
        requestId: randomUUID(),
        type: "bigquery",
        draft: false,
        values: values(mode),
      },
      actionContext,
    ),
  );
  await trackOwnedConnection(saved.id);
  return saved;
}

async function metadata(connectionId: string, identifier: string) {
  return asActor(() =>
    getDbtMetadata.run(
      { connectionId, tableId: tableIdentity(identifier) },
      actionContext,
    ),
  );
}

it("sends the recorded current Discovery validation request and returns no token in the form or save readback", async () => {
  const requestId = randomUUID();
  const saved = await asActor(() =>
    saveConnection.run(
      { requestId, type: "bigquery", draft: false, values: values("current") },
      actionContext,
    ),
  );
  await trackOwnedConnection(saved.id);
  expect(state.requests).toHaveLength(1);
  const [validation] = state.requests;
  expect(validation).toMatchObject({
    method: "POST",
    url: fixture.current.validateEnvironment.url,
    operation: "ValidateEnvironment",
    variables: { environmentId: fixture.environmentId },
    authorization: `Token ${fixture.dbtMarker}`,
  });
  expect(canonicalGraphql(validation?.query ?? null)).toBe(
    canonicalGraphql(fixture.current.validateEnvironment.query ?? null),
  );

  const readback = await asActor(() =>
    getSaveResult.run({ requestId }, actionContext),
  );
  const form = await asActor(() =>
    getConnectionForm.run({ id: saved.id }, actionContext),
  );
  expect(form.configuredCredentialFields).toEqual([
    "serviceAccount",
    "dbtToken",
  ]);
  for (const payload of [readback, form]) {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(fixture.dbtMarker);
    expect(serialized).not.toContain(fixture.serviceAccountMarker);
  }
  await asActor(() => deleteDataConnection({ id: saved.id }));
});

it("reads a model with the recorded TableMetadata variables and matches the recorded expected metadata", async () => {
  const saved = await connect("current");
  const result = await metadata(saved.id, "orders");
  const queries = state.requests.filter(
    (request) => request.operation === "TableMetadata",
  );
  expect(queries).toHaveLength(1);
  expect(queries[0]).toMatchObject({
    method: "POST",
    variables: {
      environmentId: fixture.environmentId,
      database: fixture.providerProject,
      schema: fixture.datasetId,
      identifier: "orders",
      after: null,
    },
    authorization: `Token ${fixture.dbtMarker}`,
  });
  expect(canonicalGraphql(queries[0]?.query ?? null)).toBe(
    canonicalGraphql(
      fixture.current.tableCalls[`models:${model}`]?.query ?? null,
    ),
  );
  // No unrecorded dbt request was attempted (validation + one model query).
  expect(state.requests).toHaveLength(2);
  expect(result.metadata).toMatchObject(fixture.expected.orders);
  await asActor(() => deleteDataConnection({ id: saved.id }));
});

it("reads a source with recorded freshness, and never invents docs or freshness when the fixture omits them", async () => {
  const saved = await connect("current");
  const result = await metadata(saved.id, "raw_orders");
  const sourceQueries = state.requests.filter(
    (request) => request.operation === "TableMetadata",
  );
  // Model lookup misses, then the source lookup matches.
  expect(sourceQueries.map((request) => request.variables?.identifier)).toEqual(
    ["raw_orders", "raw_orders"],
  );
  expect(result.metadata).toMatchObject(fixture.expected.raw_orders);
  expect(result.metadata?.freshness).toBe("warn");
  expect(result.metadata?.lastRefreshed).toBe(
    fixture.expected.raw_orders.lastRefreshed,
  );

  // Contract drift probe: recorded node without catalog/docs inputs must not
  // produce a docs URL, a freshness status or an invented description.
  state.requests = [];
  state.override = (request) => {
    if (request.operation !== "TableMetadata") return undefined;
    const variables = request.variables ?? {};
    const node = {
      uniqueId: source,
      name: "raw_orders",
      description: null,
      database: fixture.providerProject,
      schema: fixture.datasetId,
      identifier: "raw_orders",
      accountId: "42",
      projectId: "77",
      tests: [],
    };
    const applied =
      variables.identifier === "raw_orders"
        ? {
            models: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            sources: {
              edges: [{ node }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          }
        : {
            models: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            sources: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          };
    return { data: { environment: { applied } } };
  };
  const bare = await metadata(saved.id, "raw_orders");
  expect(bare.metadata).toMatchObject({
    description: null,
    lastRefreshed: null,
    freshness: null,
    docsUrl: null,
  });
  await asActor(() => deleteDataConnection({ id: saved.id }));
});

it("sends the recorded legacy jobs REST request and JobTableMetadata queries, and matches the recorded legacy output", async () => {
  const saved = await connect("legacy");
  const jobs = state.requests.filter((request) => request.method === "GET");
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    url: fixture.legacy.listJobs.url,
    operation: null,
    variables: null,
    authorization: `Token ${fixture.dbtMarker}`,
  });
  const validations = state.requests.filter(
    (request) => request.operation === "ValidateJob",
  );
  expect(validations).toHaveLength(1);
  expect(validations[0]?.variables).toEqual(
    fixture.legacy.validateJob.variables,
  );
  expect(canonicalGraphql(validations[0]?.query ?? null)).toBe(
    canonicalGraphql(fixture.legacy.validateJob.query ?? null),
  );

  state.requests = [];
  const result = await metadata(saved.id, "orders");
  const tables = state.requests.filter(
    (request) => request.operation === "JobTableMetadata",
  );
  expect(tables).toHaveLength(1);
  expect(tables[0]?.variables).toMatchObject({
    jobId: "5",
    database: fixture.providerProject,
    schema: fixture.datasetId,
    identifier: "orders",
  });
  expect(canonicalGraphql(tables[0]?.query ?? null)).toBe(
    canonicalGraphql(
      fixture.legacy.tableCalls[`models:${model}`]?.query ?? null,
    ),
  );
  expect(result.metadata).toMatchObject({
    uniqueId: model,
    resourceType: "model",
    description: fixture.expected.orders.description,
    columns: fixture.expected.orders.columns,
    tests: fixture.expected.orders.tests,
    lastRefreshed: "2026-11-06T20:32:34.344477Z",
    docsUrl:
      "https://cloud.getdbt.com/accounts/42/runs/9001/docs/#!/model/model.jaffle_shop.orders",
  });
  await asActor(() => deleteDataConnection({ id: saved.id }));
});

it("fails loudly when the shipped request shape drifts from the recorded contract", async () => {
  const saved = await connect("current");
  state.requests = [];
  const result = await metadata(saved.id, "orders");
  const [first] = state.requests.filter(
    (request) => request.operation === "TableMetadata",
  );
  if (!first) throw new Error("The model request was not recorded.");
  // Any drift in the filter variables, endpoint, auth header or GraphQL
  // document fails here; extra request fields fail the exact object compare.
  expect({ ...first, query: canonicalGraphql(first.query) }).toEqual({
    method: "POST",
    url: "https://metadata.cloud.getdbt.com/graphql",
    operation: "TableMetadata",
    kind: "models",
    variables: {
      environmentId: fixture.environmentId,
      database: fixture.providerProject,
      schema: fixture.datasetId,
      identifier: "orders",
      after: null,
    },
    authorization: `Token ${fixture.dbtMarker}`,
    query: canonicalGraphql(
      fixture.current.tableCalls[`models:${model}`]?.query ?? null,
    ),
  });
  expect(result.metadata?.docsUrl).toContain(
    `/accounts/42/runs/9001/docs/#!/model/${model}`,
  );
  const rows = await getDbExec().execute({
    sql: "SELECT COUNT(*) AS count FROM settings WHERE key LIKE ?",
    args: ["%credential:%"],
  });
  expect(Number(rows.rows[0]?.count)).toBeGreaterThan(0);
  await asActor(() => deleteDataConnection({ id: saved.id }));
  expect(await asActor(() => getWorkspaceConnection(saved.id))).toBeNull();
});

it("reads a legacy source through the recorded JobTableMetadata model-miss/source-hit calls with recorded freshness and docs link", async () => {
  const saved = await connect("legacy");
  state.requests = [];
  const result = await metadata(saved.id, "raw_orders");
  const tables = state.requests.filter(
    (request) => request.operation === "JobTableMetadata",
  );
  // Model lookup misses, then the source lookup matches; both use the same
  // recorded job variables, so the source response is never reused for models.
  expect(tables.map((request) => request.kind)).toEqual(["models", "sources"]);
  for (const request of tables)
    expect(request).toMatchObject({
      method: "POST",
      url: "https://metadata.cloud.getdbt.com/graphql",
      operation: "JobTableMetadata",
      variables: {
        jobId: "5",
        database: fixture.providerProject,
        schema: fixture.datasetId,
        identifier: "raw_orders",
        after: null,
      },
      authorization: `Token ${fixture.dbtMarker}`,
    });
  for (const request of tables)
    expect(canonicalGraphql(request.query)).toBe(
      canonicalGraphql(
        fixture.legacy.tableCalls[`${request.kind}:${source}`]
          ?.queryWithFreshnessCriteria ??
          fixture.legacy.tableCalls[`${request.kind}:${source}`]?.query ??
          null,
      ),
    );
  expect(result.metadata).toMatchObject(fixture.expected.raw_orders);
  expect(result.metadata).toMatchObject({
    resourceType: "source",
    freshness: "warn",
    lastRefreshed: "2018-04-09T00:00:00+00:00",
    docsUrl:
      "https://cloud.getdbt.com/accounts/42/runs/9001/docs/#!/source/source.jaffle_shop.jaffle_raw.raw_orders",
  });
  expect(JSON.stringify(result)).not.toContain(fixture.dbtMarker);
  await asActor(() => deleteDataConnection({ id: saved.id }));
});

it("matches the full recorded GraphQL document and rejects a filter or metadata-field removal supplied only by the test seam", async () => {
  const recorded = fixture.current.tableCalls[`models:${model}`];
  if (!recorded || typeof recorded.query !== "string")
    throw new Error("The recorded model request is missing.");
  const query = recorded.query;
  const descriptionCount = (query: string | null) =>
    (query?.match(/\bdescription\b/g) ?? []).length;
  const request: WireRequest = {
    method: "POST",
    url: recorded.url,
    operation: "TableMetadata",
    kind: "models",
    variables: recorded.variables ?? null,
    query: recorded.query ?? null,
    authorization: `Token ${fixture.dbtMarker}`,
  };
  expect(recordedCall(request, "current")).toBe(recorded);

  // Whitespace and comma changes are the same request; removing the applied
  // filter or a selected metadata field is a different one.
  const reformatted = query.replace(/[\s,]+/g, "\n\t");
  expect(recordedCall({ ...request, query: reformatted }, "current")).toBe(
    recorded,
  );
  const withoutFilter = query.replace(/\s*filter:\s*\{[^}]*\}/, "");
  expect(withoutFilter).not.toBe(request.query);
  expect(
    recordedCall({ ...request, query: withoutFilter }, "current"),
  ).toBeUndefined();
  const withoutDescription = query.replace(/\bdescription\b/, "");
  expect(withoutDescription).not.toBe(request.query);
  expect(
    recordedCall({ ...request, query: withoutDescription }, "current"),
  ).toBeUndefined();

  const saved = await connect("current");
  const recordedDescriptionCount = descriptionCount(recorded.query ?? null);

  state.requests = [];
  state.queryTransform = (query) => query.replace(/\s*filter:\s*\{[^}]*\}/, "");
  await expect(metadata(saved.id, "orders")).rejects.toMatchObject({
    statusCode: 502,
    errorCode: "data_dbt_metadata_failed",
  });
  const noFilter = state.requests.find(
    (request) => request.operation === "TableMetadata",
  );
  expect(noFilter?.query).not.toContain("filter:");

  state.requests = [];
  state.queryTransform = (query) => query.replace(/\bdescription\b/, "");
  await expect(metadata(saved.id, "orders")).rejects.toMatchObject({
    statusCode: 502,
    errorCode: "data_dbt_metadata_failed",
  });
  const noDescription = state.requests.find(
    (request) => request.operation === "TableMetadata",
  );
  expect(descriptionCount(noDescription?.query ?? null)).toBe(
    recordedDescriptionCount - 1,
  );
});

it("rejects unterminated GraphQL literals instead of accepting a closed literal equivalent", () => {
  expect(() => canonicalGraphql('query { field(arg: "value) }')).toThrow(
    "Unterminated GraphQL string",
  );
  expect(() => canonicalGraphql('query { field(arg: """value) }')).toThrow(
    "Unterminated GraphQL string",
  );
});

it.each(["current", "legacy"] as const)(
  "reads configured source thresholds over the %s wire contract",
  async (mode) => {
    const saved = await connect(mode);
    const result = await metadata(saved.id, "raw_orders");
    expect(result.metadata?.freshnessCriteria).toEqual({
      warnAfter: { count: 2, period: "hour" },
      errorAfter: { count: 24, period: "hour" },
    });
  },
);

it("rejects a current source request that drops the freshness thresholds", async () => {
  const saved = await connect("current");
  state.queryTransform = (query) =>
    query.replace(
      "criteria { warnAfter { count period } errorAfter { count period } }",
      "",
    );
  await expect(metadata(saved.id, "raw_orders")).rejects.toMatchObject({
    errorCode: "data_dbt_metadata_failed",
  });
});
