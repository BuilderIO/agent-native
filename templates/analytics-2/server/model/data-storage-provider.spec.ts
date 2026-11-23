import { ok } from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { LookupOptions } from "node:dns";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";

import {
  Field,
  Int64,
  Schema,
  Table,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWarehouseFaultControl,
  warehouseFaultInput,
  warehouseFixtureProject,
} from "../../e2e/phase1/fixtures/provider-fault";
import { phase1WarehouseFixtureKey } from "../../shared/phase1-warehouse-fixture";

const state = vi.hoisted(() => ({
  credentials: new Map<string, string>(),
  queryResponses: [] as Record<string, unknown>[],
  queryBodies: [] as Record<string, unknown>[],
  queryUrls: [] as string[],
  bigQueryCalls: 0,
  queryStatus: 200,
  wideMetadata: false,
  wideRowsServed: 0,
  reader: null as null | unknown,
  initError: null as Error | null,
}));
vi.mock("@agent-native/core/server", () => ({
  resolveDeployEnvironment: () => "local",
  getRequestContext: () => ({
    userEmail: "qa@example.invalid",
    orgId: "qa-storage-workspace",
  }),
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionCredentialForApp: async ({
    connectionId,
    key,
  }: {
    connectionId: string;
    key: string;
  }) => ({
    available: state.credentials.has(`${connectionId}:${key}`),
    value: state.credentials.get(`${connectionId}:${key}`),
  }),
}));
vi.mock("./data-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./data-storage")>();
  return {
    ...actual,
    createWarehouseStorageClient: async () => {
      if (state.initError) throw state.initError;
      return state.reader;
    },
  };
});

import { bigQueryAdapter, prepareBigQuery } from "../execution/sql-adapter";
import {
  executeStorageQueryPage,
  requestMetadata,
  runtimeForConnection,
  type WarehouseQueryInput,
} from "./data-connection-provider";
import type {
  StorageReadRowsResponse,
  WarehouseStorageReader,
} from "./data-storage";

function key(email: string) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({
    client_email: email,
    private_key: privateKey,
    project_id: "qa-project",
  });
}

const EOS_BYTES = 8;
function arrowResponses(
  sizes: readonly number[],
  offset = 0,
): StorageReadRowsResponse[] {
  const schema = new Schema([new Field("n", new Int64())]);
  const count = sizes.reduce((total, size) => total + size, offset);
  const table = new Table(schema, {
    n: vectorFromArray(
      Array.from({ length: count }, (_, index) => BigInt(index + 1)),
      new Int64(),
    ),
  });
  // Build each row's batch separately so a page can start at a nonzero offset.
  const schemaStream = tableToIPC(new Table(schema), "stream");
  const serializedSchema = schemaStream.subarray(
    0,
    schemaStream.length - EOS_BYTES,
  );
  const responses: StorageReadRowsResponse[] = [
    { arrowSchema: { serializedSchema }, rowCount: 0 },
  ];
  let start = offset;
  for (const size of sizes) {
    const stream = tableToIPC(table.slice(start, start + size), "stream");
    const serializedRecordBatch = stream.subarray(
      serializedSchema.length,
      stream.length - EOS_BYTES,
    );
    responses.push({
      arrowRecordBatch: { serializedRecordBatch, rowCount: size },
      rowCount: size,
    });
    start += size;
  }
  return responses;
}

function reader(
  responses: StorageReadRowsResponse[],
  options: {
    failCode?: number;
    closeThrows?: boolean;
    closeHangs?: boolean;
    closeDelayedMs?: number;
    cancelThrows?: boolean;
    destroyThrows?: boolean;
  } = {},
): WarehouseStorageReader & {
  requests: { readStream: string; offset: string }[];
  destroyed: number;
  closed: number;
} {
  const value = {
    requests: [] as { readStream: string; offset: string }[],
    destroyed: 0,
    closed: 0,
    readRows(request: { readStream: string; offset: string }) {
      value.requests.push(request);
      let index = 0;
      const iterator = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        async next(): Promise<IteratorResult<StorageReadRowsResponse>> {
          if (options.failCode !== undefined)
            throw Object.assign(new Error("storage denied"), {
              code: options.failCode,
            });
          return index < responses.length
            ? { done: false as const, value: responses[index++]! }
            : { done: true as const, value: undefined };
        },
        cancel() {
          if (options.cancelThrows)
            throw new Error("The test stream could not cancel.");
        },
        destroy() {
          value.destroyed += 1;
          if (options.destroyThrows)
            throw new Error("The test stream could not be destroyed.");
        },
      };
      return iterator;
    },
    async close() {
      value.closed += 1;
      if (options.closeDelayedMs !== undefined)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, options.closeDelayedMs),
        );
      if (options.closeHangs) return new Promise<void>(() => {});
      if (options.closeThrows)
        throw new Error("The test client could not be closed.");
    },
  };
  return value;
}

const jobReference = {
  projectId: "qa-project",
  jobId: "qa-job",
  location: "US",
};
const schemaFields = [{ name: "n", type: "INTEGER" }];

beforeEach(() => {
  state.credentials.clear();
  state.queryResponses = [];
  state.queryBodies = [];
  state.queryUrls = [];
  state.bigQueryCalls = 0;
  state.queryStatus = 200;
  state.wideMetadata = false;
  state.wideRowsServed = 0;
  state.reader = null;
  state.initError = null;
  vi.spyOn(dns, "lookup").mockImplementation((async (
    _hostname: string,
    options?: LookupOptions | number,
  ) => {
    const address = { address: "8.8.8.8", family: 4 };
    return typeof options === "object" && options.all ? [address] : address;
  }) as typeof dns.lookup);
  syncBuiltinESMExports();
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const fields = new URLSearchParams(String(init?.body));
        const jwt = fields.get("assertion");
        if (!jwt) throw new Error("Missing assertion");
        const payload = JSON.parse(
          Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
        ) as { iss: string };
        return new Response(
          JSON.stringify({
            access_token: `QA-TOKEN-${payload.iss}`,
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("https://bigquery.googleapis.com/")) {
        state.bigQueryCalls += 1;
        state.queryUrls.push(url);
        if (init?.body) {
          try {
            state.queryBodies.push(
              JSON.parse(String(init.body)) as Record<string, unknown>,
            );
          } catch {
            state.queryBodies.push({});
          }
        }
        const fields = new URL(url).searchParams.get("fields") ?? "";
        if (state.wideMetadata && (!fields || fields.includes("rows"))) {
          state.wideRowsServed += 1;
          return new Response(
            JSON.stringify({
              jobComplete: true,
              jobReference,
              schema: { fields: schemaFields },
              rows: [{ f: [{ v: "x".repeat(17 * 1024 * 1024) }] }],
              totalRows: "1",
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        const response = state.queryResponses.shift();
        if (!response) throw new Error("Missing query response fixture");
        return new Response(JSON.stringify(response), {
          status: state.queryStatus,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("Unexpected network request in storage fixture");
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllGlobals();
});

async function run(input: WarehouseQueryInput) {
  state.credentials.set(
    "connection-storage:ref",
    key("qa-storage@example.invalid"),
  );
  return executeStorageQueryPage(
    await runtimeForConnection("connection-storage", "ref"),
    {
      connectionId: "connection-storage",
      credentialKey: "ref",
      projectId: "qa-project",
      input,
    },
  );
}

async function faultFixture() {
  const connectionId = `wconn1:${"a".repeat(64)}`;
  const { bridge, control } = createWarehouseFaultControl();
  vi.stubGlobal(phase1WarehouseFixtureKey, bridge);
  const operation = (input: object) =>
    control(warehouseFaultInput.parse({ ...input, connectionId }));
  await operation({ operation: "warehouse-fault-open" });
  state.credentials.set(`${connectionId}:ref`, key("qa-fault@example.invalid"));
  return {
    bridge,
    connectionId,
    operation,
    runtime: await runtimeForConnection(connectionId, "ref"),
  };
}

describe("Phase 1 signed-in warehouse faults", () => {
  it("forces one Storage read to recover the same submitted job through REST", async () => {
    const { runtime, connectionId, operation, bridge } = await faultFixture();
    const source = {
      projectId: warehouseFixtureProject,
      location: "US",
      runtime,
      generation: "1",
      validate: (query: string) => query,
      storage: {
        connectionId,
        credentialKey: "ref",
        options: { driveAccess: false },
      },
    };
    const submission = prepareBigQuery(
      source,
      { sql: "SELECT 1 AS n", parameters: [] },
      "fixture-submission",
      "bypass",
    );
    const { job } = submission;
    const adapter = bigQueryAdapter(source, submission);
    const metadata = {
      jobComplete: true,
      jobReference: job,
      schema: { fields: schemaFields },
      totalRows: "1",
    };
    const storage = reader(arrowResponses([1]));
    state.reader = storage;
    state.queryResponses = [
      { jobReference: job, status: { state: "DONE" } },
      metadata,
      { ...metadata, rows: [{ f: [{ v: "1" }] }] },
    ];
    await operation({
      operation: "warehouse-fault-patch",
      patch: { bigqueryStorageFailure: true },
    });
    expect(() =>
      bridge.beforeStorageRead("unrelated", warehouseFixtureProject, job.jobId),
    ).not.toThrow();

    await expect(adapter.start(false)).resolves.toEqual({ state: "DONE" });
    expect(() =>
      bridge.beforeStorageRead(
        connectionId,
        warehouseFixtureProject,
        "unsubmitted-job",
      ),
    ).not.toThrow();
    await expect(adapter.spoolPage("storage", 0, null)).rejects.toMatchObject({
      message: "warehouse_storage_fallback",
      diagnostic: {
        errorCode: "warehouse_query_failed",
        details: { storagePhase: "read_rows", grpcStatus: 14 },
      },
    });
    await expect(adapter.spoolPage("rest", 0, null)).resolves.toMatchObject({
      jobReference: job,
      rows: [["1"]],
    });
    expect(storage.requests).toEqual([]);
    expect(storage.closed).toBe(1);
    expect(state.queryBodies).toHaveLength(1);
    expect(state.queryBodies[0]).toMatchObject({ jobReference: job });
    expect(
      state.queryUrls.map((url) => {
        const { pathname, searchParams } = new URL(url);
        return [pathname, searchParams.has("fields")];
      }),
    ).toEqual([
      [`/bigquery/v2/projects/${warehouseFixtureProject}/jobs`, false],
      [
        `/bigquery/v2/projects/${warehouseFixtureProject}/queries/${job.jobId}`,
        true,
      ],
      [
        `/bigquery/v2/projects/${warehouseFixtureProject}/queries/${job.jobId}`,
        false,
      ],
    ]);
    expect(await operation({ operation: "warehouse-fault-calls" })).toEqual([
      {
        host: "bigquery",
        method: "POST",
        path: `/projects/${warehouseFixtureProject}/jobs`,
        jobId: job.jobId,
      },
      {
        host: "storage",
        method: "GET",
        path: `/projects/${warehouseFixtureProject}/queries/${job.jobId}`,
        jobId: job.jobId,
      },
      {
        host: "bigquery",
        method: "GET",
        path: `/projects/${warehouseFixtureProject}/queries/${job.jobId}`,
      },
    ]);
    expect(() =>
      bridge.beforeStorageRead(
        connectionId,
        warehouseFixtureProject,
        job.jobId,
      ),
    ).not.toThrow();
  });

  it("distinguishes a rejected catalog read from an empty catalog and restores live reads", async () => {
    const { runtime, operation } = await faultFixture();
    const read = () => requestMetadata(runtime, warehouseFixtureProject);
    await operation({
      operation: "warehouse-fault-patch",
      patch: { bigquery: "error" },
    });
    await expect(read()).rejects.toMatchObject({
      errorCode: "data_connection_rejected",
      details: { providerStatus: 503, providerReason: "backendError" },
    });
    await operation({
      operation: "warehouse-fault-patch",
      patch: { bigquery: "empty" },
    });
    await expect(read()).resolves.toMatchObject({ items: [] });
    expect(state.bigQueryCalls).toBe(0);

    await expect(
      operation({ operation: "warehouse-fault-close" }),
    ).resolves.toEqual({ closed: true });
    state.queryResponses = [
      {
        kind: "bigquery#datasetList",
        datasets: [
          {
            datasetReference: {
              projectId: warehouseFixtureProject,
              datasetId: "present",
            },
          },
        ],
      },
    ];
    await expect(read()).resolves.toMatchObject({
      items: [{ name: "present" }],
    });
    expect(state.bigQueryCalls).toBe(1);
  });
});

describe("Storage query transport", () => {
  it("seeks directly to a saved job's row offset", async () => {
    const storage = reader(arrowResponses([3], 5));
    state.reader = storage;
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "8",
      },
    ];
    const input = { job: jobReference, rowOffset: 5, first: 3 };
    await expect(run(input)).resolves.toMatchObject({
      rows: [["6"], ["7"], ["8"]],
      hasNextPage: false,
    });
    expect(storage.requests).toEqual([
      {
        readStream:
          "projects/qa-project/locations/US/jobs/qa-job/streams/_default",
        offset: "5",
      },
    ]);
  });

  it("takes job metadata from jobs.query then reads that exact job location with Storage", async () => {
    const parameters = [
      {
        name: "n",
        parameterType: { type: "STRING" as const },
        parameterValue: { value: "1" },
      },
    ];
    state.reader = reader(arrowResponses([3]));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        rows: [{ f: [{ v: "1" }] }],
        totalRows: "3",
      },
    ];
    const result = await run({
      query: "SELECT @n AS n",
      parameters,
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 2,
    });
    expect(result.status).toBe("complete");
    expect(result.rows).toEqual([["1"], ["2"]]);
    expect(result.totalRows).toBe("3");
    expect(result.hasNextPage).toBe(true);
    expect(result.pageToken).not.toBeNull();
    expect(state.queryBodies[0]).toMatchObject({
      query: "SELECT @n AS n",
      parameterMode: "NAMED",
      queryParameters: parameters,
      maxResults: 1,
      timeoutMs: 10000,
    });
    const storage = state.reader as ReturnType<typeof reader>;
    expect(storage.requests).toEqual([
      {
        readStream:
          "projects/qa-project/locations/US/jobs/qa-job/streams/_default",
        offset: "0",
      },
    ]);
    expect(storage.closed).toBe(1);
  });

  it("reads the completed job through REST when the Storage client cannot initialize", async () => {
    state.initError = new Error("Storage SDK failed to load");
    const job = { ...jobReference, location: "EU" };
    const metadata = {
      jobComplete: true,
      jobReference: job,
      schema: { fields: schemaFields },
      totalRows: "1",
    };
    state.queryResponses = [
      metadata,
      { ...metadata, rows: [{ f: [{ v: "1" }] }] },
    ];

    await expect(run({ query: "SELECT 1 AS n" })).resolves.toMatchObject({
      jobReference: job,
      rows: [["1"]],
      hasNextPage: false,
    });
    expect(state.queryBodies).toHaveLength(1);
    expect(state.queryUrls[1]).toContain(
      "/bigquery/v2/projects/qa-project/queries/qa-job",
    );
    expect(state.queryUrls[1]).toContain("location=EU");
    expect(state.queryUrls[1]).not.toContain("fields=");
  });

  it("continues through REST at the Storage offset when a later ReadRows call fails", async () => {
    const metadata = {
      jobComplete: true,
      jobReference,
      schema: { fields: schemaFields },
      totalRows: "4",
    };
    state.reader = reader(arrowResponses([4]));
    state.queryResponses = [
      metadata,
      metadata,
      { ...metadata, rows: [{ f: [{ v: "3" }] }], pageToken: "rest-page-4" },
      { ...metadata, rows: [{ f: [{ v: "4" }] }] },
    ];
    const first = await run({ query: "SELECT 1 AS n", first: 2 });
    expect(first.rows).toEqual([["1"], ["2"]]);
    ok(first.pageToken);

    const failedReader = reader([], { failCode: 14 });
    state.reader = failedReader;
    const second = await run({
      job: jobReference,
      pageToken: first.pageToken,
      first: 1,
    });
    expect(second.rows).toEqual([["3"]]);
    expect(second.hasNextPage).toBe(true);
    expect(state.queryUrls[2]).toContain("startIndex=2");
    ok(second.pageToken);

    const third = await run({
      job: jobReference,
      pageToken: second.pageToken,
      first: 1,
    });
    expect(third.rows).toEqual([["4"]]);
    expect(third.hasNextPage).toBe(false);
    expect(state.queryUrls[3]).toContain("pageToken=rest-page-4");
    expect(state.queryBodies).toHaveLength(1);
    expect(failedReader.requests).toHaveLength(1);
    expect(failedReader.closed).toBe(1);
  });

  it("continues from the cursor's precise row offset in the same job", async () => {
    state.reader = reader(arrowResponses([3]));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    const first = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 2,
    });
    expect(first.pageToken).toBeTruthy();

    state.reader = reader(arrowResponses([1], 2));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    const second = await run({
      job: jobReference,
      pageToken: first.pageToken!,
      first: 1000,
    });
    expect(second.rows).toEqual([["3"]]);
    expect(second.hasNextPage).toBe(false);
    expect(second.pageToken).toBeNull();
    const storage = state.reader as ReturnType<typeof reader>;
    expect(storage.requests).toEqual([
      {
        readStream:
          "projects/qa-project/locations/US/jobs/qa-job/streams/_default",
        offset: "2",
      },
    ]);
  });

  it("denies a continuation cursor bound to another job before reading Storage", async () => {
    state.reader = reader(arrowResponses([3]));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    const first = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 2,
    });
    state.reader = reader(arrowResponses([1]));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference: { ...jobReference, jobId: "other-job" },
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    await expect(
      run({
        job: { ...jobReference, jobId: "other-job" },
        pageToken: first.pageToken!,
        first: 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_job_denied",
    });
    expect((state.reader as ReturnType<typeof reader>).requests).toEqual([]);
  });

  it("refuses to switch the saved job location during polling", async () => {
    state.reader = reader(arrowResponses([3]));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    const first = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 2,
    });
    state.reader = reader(arrowResponses([1], 2));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference: { ...jobReference, location: "EU" },
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    await expect(
      run({
        job: jobReference,
        pageToken: first.pageToken!,
        first: 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_job_denied",
    });
    expect((state.reader as ReturnType<typeof reader>).requests).toEqual([]);
  });

  it("reports a still-running job without attempting a Storage read", async () => {
    state.reader = reader([]);
    state.queryResponses = [
      {
        jobComplete: false,
        jobReference: { projectId: "qa-project", jobId: "qa-job" },
      },
    ];
    const result = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 2,
    });
    expect(result).toMatchObject({
      jobComplete: false,
      status: "running",
      rows: [],
      pageToken: null,
      hasNextPage: false,
    });
    expect((state.reader as ReturnType<typeof reader>).requests).toEqual([]);
  });

  it("fails a completed job that has no location instead of guessing a stream", async () => {
    state.reader = reader(arrowResponses([1]));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference: { projectId: "qa-project", jobId: "qa-job" },
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_job_invalid",
    });
    expect((state.reader as ReturnType<typeof reader>).requests).toEqual([]);
  });

  it("maps a genuine REST 403 to a denied failure and never falls back to Storage", async () => {
    state.reader = reader(arrowResponses([1]));
    state.queryResponses = [{ kind: "bigquery#queryResponse" }];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://oauth2.googleapis.com/token"))
          return new Response(
            JSON.stringify({ access_token: "QA-TOKEN", expires_in: 3600 }),
            { headers: { "content-type": "application/json" } },
          );
        const fields = new URLSearchParams(String(init?.body));
        const jwt = fields.get("assertion");
        if (jwt) {
          const payload = JSON.parse(
            Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
          ) as { iss: string };
          return new Response(
            JSON.stringify({
              access_token: `QA-TOKEN-${payload.iss}`,
              expires_in: 3600,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        state.bigQueryCalls += 1;
        return new Response(
          JSON.stringify({
            error: { code: 403, message: "Access Denied: Table qa" },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      },
    );
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_denied",
    });
    expect((state.reader as ReturnType<typeof reader>).requests).toEqual([]);
  });

  it("retains Storage failure details when the REST result is also unavailable", async () => {
    state.reader = reader([], { failCode: 14 });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_failed",
      details: {
        storagePhase: "read_rows",
        grpcStatus: 14,
        restErrorCode: "warehouse_query_failed",
      },
    });
    expect(state.bigQueryCalls).toBe(2);
  });

  it("returns a typed bad-query response without opening or retrying Storage", async () => {
    const storage = reader([]);
    state.reader = storage;
    state.queryStatus = 400;
    state.queryResponses = [
      { error: { errors: [{ reason: "invalidQuery" }] } },
    ];

    await expect(run({ query: "SELECT FROM" })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "warehouse_query_failed",
    });
    expect(state.bigQueryCalls).toBe(1);
    expect(storage.requests).toEqual([]);
  });

  it("report A2-BQ-STORAGE-API-502 falls back to REST when Storage PERMISSION_DENIED occurs on a job-user account", async () => {
    state.reader = reader([], { failCode: 7 });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
        rows: [{ f: [{ v: "1" }] }],
      },
    ];
    const result = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 1,
    });
    expect(result.rows).toEqual([["1"]]);
    expect(state.bigQueryCalls).toBe(2);
    expect((state.reader as ReturnType<typeof reader>).closed).toBe(1);
  });

  it("maps Storage PERMISSION_DENIED to 403 when REST fallback also fails", async () => {
    state.reader = reader([], { failCode: 7 });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_denied",
    });
    expect(state.bigQueryCalls).toBe(2);
    expect((state.reader as ReturnType<typeof reader>).closed).toBe(1);
  });

  it("maps Storage ALREADY_EXISTS to 409 without retrying another transport", async () => {
    state.reader = reader([], { failCode: 6 });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "warehouse_query_conflict",
    });
    expect(state.bigQueryCalls).toBe(1);
  });

  it("surfaces a client close failure after an otherwise valid page", async () => {
    state.reader = reader(arrowResponses([1]), { closeThrows: true });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_cleanup_failed",
      details: { unreleasedStorageClient: true },
    });
  });

  it("preserves a Storage denial when the client close also fails", async () => {
    state.reader = reader([], { failCode: 7, closeThrows: true });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_denied",
      details: { unreleasedStorageClient: true },
    });
  });

  it("bounds a non-settling client close after an otherwise valid page", async () => {
    state.reader = reader(arrowResponses([1]), { closeHangs: true });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "warehouse_query_cleanup_failed",
      details: { unreleasedStorageClient: true },
    });
  });

  it("preserves a Storage denial when the client close never settles", async () => {
    state.reader = reader([], { failCode: 7, closeHangs: true });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_denied",
      details: { unreleasedStorageClient: true },
    });
  });

  it("allows a valid client close that takes 75 ms", async () => {
    state.reader = reader(arrowResponses([1]), { closeDelayedMs: 75 });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    const result = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 1,
    });
    expect(result.rows).toEqual([["1"]]);
    expect((state.reader as ReturnType<typeof reader>).closed).toBe(1);
  });

  it("preserves a raw storage denial and its cleanup annotation", async () => {
    state.reader = reader([], {
      failCode: 7,
      cancelThrows: true,
      destroyThrows: true,
    });
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    await expect(
      run({
        query: "SELECT 1 AS n",
        requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
        first: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "warehouse_query_denied",
      details: { unreleasedStorageStream: true },
    });
  });

  it("requests metadata-only fields so a wide result row is never fetched", async () => {
    state.reader = reader(arrowResponses([1]));
    state.wideMetadata = true;
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "1",
      },
    ];
    const result = await run({
      query: "SELECT wide FROM qa",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 1,
    });
    expect(result.rows).toEqual([["1"]]);
    const fields = new URL(state.queryUrls[0]!).searchParams.get("fields");
    expect(fields).toContain("jobComplete");
    expect(fields).toContain("jobReference");
    expect(fields).toContain("schema");
    expect(fields).toContain("totalRows");
    expect(fields).not.toContain("rows");
    expect(state.wideRowsServed).toBe(0);
    expect(state.queryBodies[0]).toMatchObject({ maxResults: 1 });
  });

  it("keeps metadata-only fields on the polling request", async () => {
    state.reader = reader(arrowResponses([3]));
    state.wideMetadata = true;
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    const first = await run({
      query: "SELECT 1 AS n",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 2,
    });
    state.reader = reader(arrowResponses([1], 2));
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "3",
      },
    ];
    await run({
      job: jobReference,
      pageToken: first.pageToken!,
      first: 1000,
    });
    const fields = new URL(state.queryUrls[1]!).searchParams.get("fields");
    expect(fields).toContain("jobComplete");
    expect(fields).not.toContain("rows");
    expect(state.wideRowsServed).toBe(0);
  });

  it("returns an empty completed result only when the job really has zero rows", async () => {
    state.reader = reader([]);
    state.queryResponses = [
      {
        jobComplete: true,
        jobReference,
        schema: { fields: schemaFields },
        totalRows: "0",
      },
    ];
    const result = await run({
      query: "SELECT 1 AS n WHERE FALSE",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 10,
    });
    expect(result).toMatchObject({
      jobComplete: true,
      status: "complete",
      rows: [],
      totalRows: "0",
      pageToken: null,
      hasNextPage: false,
    });
    expect((state.reader as ReturnType<typeof reader>).requests).toEqual([]);
  });
});
