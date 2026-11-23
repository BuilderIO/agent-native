import { generateKeyPairSync } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "8.8.8.8", family: 4 }],
}));
const state = vi.hoisted(() => ({
  context: {
    userEmail: "qa@example.invalid",
    orgId: "qa-auth-workspace" as string | undefined,
    orgScope: undefined as "personal" | undefined,
  },
  credentials: new Map<string, string>(),
  rejectToken: false,
  tokenIssuers: [] as string[],
  metadataTokens: [] as string[],
  metadataRequests: [] as {
    url: string;
    method: string | undefined;
    body?: string | undefined;
  }[],
  metadataStatus: 200,
  dryRunStatus: null as number | null,
  dryRunBody: null as Record<string, unknown> | null,
  manager: vi.fn(),
  queryResponses: [] as Record<string, unknown>[],
  resolverOptions: [] as Record<string, unknown>[],
}));
vi.mock(import("@agent-native/core/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRequestContext: () => ({
    userEmail: state.context.userEmail,
    ...(state.context.orgId ? { orgId: state.context.orgId } : {}),
    ...(state.context.orgScope ? { orgScope: state.context.orgScope } : {}),
  }),
}));
vi.mock("./data-connections.js", () => ({
  manager: state.manager,
  resolveSavedBigQueryTestCredentials: async (
    connectionId: string,
    options: { driveAccess?: boolean; resolveServiceAccount: boolean },
  ) => ({
    runtime: options.resolveServiceAccount
      ? await runtimeForConnection(
          connectionId,
          "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          { driveAccess: options.driveAccess },
        )
      : undefined,
  }),
}));
vi.mock(
  import("@agent-native/core/workspace-connections"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    resolveWorkspaceConnectionCredentialForApp: async (options) => {
      state.resolverOptions.push({ ...options });
      const { connectionId, key, provider } = options;
      const value = state.credentials.get(`${connectionId}:${key}`);
      return {
        available: value !== undefined,
        status: value === undefined ? "not_available" : "resolved",
        reason:
          value === undefined ? "No saved credential" : "Credential resolved",
        provider,
        key,
        ...(value === undefined ? {} : { value }),
        provenance: null,
        checked: [],
      };
    },
  }),
);
import testDataConnection from "../../actions/test-data-connection";
import {
  requestMetadata,
  executeQueryPage,
  cancelWarehouseJob,
  runtimeForConnection,
  storageClientForConnection,
  validateSubmittedServiceAccount,
} from "./data-connection-provider";
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
beforeEach(() => {
  state.context = {
    userEmail: "qa@example.invalid",
    orgId: "qa-auth-workspace",
    orgScope: undefined,
  };
  state.credentials.clear();
  state.rejectToken = false;
  state.tokenIssuers = [];
  state.metadataTokens = [];
  state.metadataRequests = [];
  state.metadataStatus = 200;
  state.dryRunStatus = null;
  state.dryRunBody = null;
  state.manager.mockReset();
  state.queryResponses = [];
  state.resolverOptions = [];
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
        state.tokenIssuers.push(payload.iss);
        return new Response(
          JSON.stringify(
            state.rejectToken
              ? { error: "invalid_grant" }
              : { access_token: `QA-TOKEN-${payload.iss}`, expires_in: 3600 },
          ),
          {
            status: state.rejectToken ? 400 : 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.startsWith("https://bigquery.googleapis.com/")) {
        state.metadataTokens.push(
          new Headers(init?.headers).get("authorization") ?? "",
        );
        const isDryRunJob =
          init?.method === "POST" && /\/jobs(?:\?|$)/.test(url);
        if (isDryRunJob && state.dryRunStatus !== null) {
          state.metadataRequests.push({
            url,
            method: init?.method,
            body: typeof init?.body === "string" ? init.body : undefined,
          });
          const body =
            state.dryRunBody ??
            (state.dryRunStatus === 200
              ? {
                  kind: "bigquery#job",
                  configuration: { dryRun: true },
                }
              : {
                  error: {
                    errors: [{ reason: "accessDenied" }],
                    message: "dry run denied",
                  },
                });
          return new Response(JSON.stringify(body), {
            status: state.dryRunStatus,
            headers: { "content-type": "application/json" },
          });
        }
        const response = url.includes("/queries")
          ? state.queryResponses.shift()
          : state.metadataStatus === 200
            ? url.includes("/tables")
              ? { kind: "bigquery#tableList", tables: [] }
              : { kind: "bigquery#datasetList", datasets: [] }
            : {
                error: {
                  errors: [{ reason: "accessDenied" }],
                  message: "details that must not leave the provider",
                },
              };
        if (!response) throw new Error("Missing query response fixture");
        state.metadataRequests.push({
          url,
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response(JSON.stringify(response), {
          status: state.metadataStatus,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(
        "Unexpected network request in isolated authentication fixture",
      );
    },
  );
});

describe("warehouse job cancellation", () => {
  it("requests cancellation of the exact job and reports pending until the provider confirms its terminal reason", async () => {
    const job = { projectId: "qa-project", jobId: "qa-job", location: "EU" };
    const responses = [
      { job: { jobReference: job, status: { state: "RUNNING" } } },
      {
        jobReference: job,
        status: { state: "DONE", errorResult: { reason: "stopped" } },
      },
    ];
    const executeRequest = vi.fn(async (_request: unknown) => ({
      response: {
        ok: true,
        status: 200,
        truncated: false,
        json: responses.shift(),
      },
    }));
    const runtime = { executeRequest } as unknown as Awaited<
      ReturnType<typeof runtimeForConnection>
    >;
    expect(await cancelWarehouseJob(runtime, job, "request")).toBe("pending");
    expect(executeRequest.mock.calls[0]?.[0]).toMatchObject({
      method: "POST",
      path: "/projects/qa-project/jobs/qa-job/cancel",
      query: { location: "EU" },
    });
    expect(await cancelWarehouseJob(runtime, job, "status")).toBe("cancelled");
  });
  it.each([
    [{ state: "DONE" }, "complete"],
    [{ state: "DONE", errorResult: { reason: "invalidQuery" } }, "failed"],
    [{ state: "RUNNING" }, "pending"],
  ] as const)("distinguishes terminal outcome %s", async (status, expected) => {
    const job = { projectId: "qa-project", jobId: "qa-job", location: "EU" };
    const executeRequest = vi.fn(async () => ({
      response: { ok: true, status: 200, json: { jobReference: job, status } },
    }));
    const runtime = { executeRequest } as unknown as Awaited<
      ReturnType<typeof runtimeForConnection>
    >;
    expect(await cancelWarehouseJob(runtime, job, "status")).toBe(expected);
  });
  it("refuses a response for another job", async () => {
    const job = { projectId: "qa-project", jobId: "qa-job", location: "EU" };
    const executeRequest = vi.fn(async () => ({
      response: {
        ok: true,
        status: 200,
        json: {
          jobReference: { ...job, jobId: "other" },
          status: { state: "DONE", errorResult: { reason: "stopped" } },
        },
      },
    }));
    const runtime = { executeRequest } as unknown as Awaited<
      ReturnType<typeof runtimeForConnection>
    >;
    await expect(
      cancelWarehouseJob(runtime, job, "status"),
    ).rejects.toMatchObject({ errorCode: "warehouse_query_job_invalid" });
  });
  it.each([
    [{ projectId: "qa-project", jobId: "qa-job" }, "cancelled"],
    [{ projectId: "qa-project", jobId: "qa-job", location: "US" }, "denied"],
  ] as const)(
    "validates an optional returned job location",
    async (jobReference, expected) => {
      const job = { projectId: "qa-project", jobId: "qa-job", location: "EU" };
      const executeRequest = vi.fn(async () => ({
        response: {
          ok: true,
          status: 200,
          json: {
            jobReference,
            status: { state: "DONE", errorResult: { reason: "stopped" } },
          },
        },
      }));
      const runtime = { executeRequest } as unknown as Awaited<
        ReturnType<typeof runtimeForConnection>
      >;
      const outcome = cancelWarehouseJob(runtime, job, "status");
      if (expected === "denied")
        await expect(outcome).rejects.toMatchObject({
          errorCode: "warehouse_query_job_denied",
        });
      else await expect(outcome).resolves.toBe("cancelled");
    },
  );
});

it.each([
  [
    400,
    { error: { message: "Unrecognized name: missing at [1:8]" } },
    422,
    "Unrecognized name: missing at [1:8]",
  ],
  [
    403,
    { error: { errors: [{ message: "Access Denied: Table qa.test.orders" }] } },
    403,
    "Access Denied: Table qa.test.orders",
  ],
  [
    200,
    { jobComplete: true, errors: [{ message: "Name missing not found" }] },
    422,
    "Name missing not found",
  ],
])(
  "reports the BigQuery reason for query response %i",
  async (status, json, statusCode, message) => {
    const runtime = {
      executeRequest: vi.fn(async () => ({
        response: { ok: status === 200, status, truncated: false, json },
      })),
    } as unknown as Awaited<ReturnType<typeof runtimeForConnection>>;
    await expect(
      executeQueryPage(runtime, "qa-project", { query: "SELECT missing" }),
    ).rejects.toMatchObject({ statusCode, message });
  },
);

it("requests the exact REST offset on the saved query job", async () => {
  const job = { projectId: "qa-project", jobId: "qa-job", location: "EU" };
  const executeRequest = vi.fn(async () => ({
    response: {
      ok: true,
      status: 200,
      truncated: false,
      json: {
        jobComplete: true,
        jobReference: job,
        schema: { fields: [{ name: "n", type: "INTEGER" }] },
        rows: [{ f: [{ v: "19951" }] }],
        totalRows: "19951",
      },
    },
  }));
  const runtime = { executeRequest } as unknown as Awaited<
    ReturnType<typeof runtimeForConnection>
  >;
  const input = { job, first: 50, rowOffset: 19950 };
  expect((await executeQueryPage(runtime, "qa-project", input)).rows).toEqual([
    ["19951"],
  ]);
  expect(executeRequest).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      method: "GET",
      path: "/projects/qa-project/queries/qa-job",
      query: expect.objectContaining({
        startIndex: "19950",
        maxResults: 50,
        location: "EU",
      }),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("testing a BigQuery connection form", () => {
  it("uses the submitted key for a single dataset listing against the selected project", async () => {
    await expect(
      testDataConnection.run(
        {
          projectId: "selected-project",
          serviceAccount: key("probe@example.invalid"),
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ verified: true });
    expect(state.metadataRequests).toEqual([
      {
        method: "GET",
        url: "https://bigquery.googleapis.com/bigquery/v2/projects/selected-project/datasets?maxResults=1",
      },
    ]);
    expect(state.metadataTokens).toEqual([
      "Bearer QA-TOKEN-probe@example.invalid",
    ]);
  });

  it.each([
    ["a byte order mark", "\uFEFF", ""],
    ["no-break spaces", "\u00A0\u00A0", "\u00A0"],
    ["a trailing newline", "", "\r\n"],
  ])("accepts a pasted key wrapped in %s", async (_label, before, after) => {
    await expect(
      testDataConnection.run(
        {
          projectId: "selected-project",
          serviceAccount: `${before}${key("probe@example.invalid")}${after}`,
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ verified: true });
    expect(state.tokenIssuers).toEqual(["probe@example.invalid"]);
  });

  it("stops before contacting Google when connection management is refused", async () => {
    state.manager.mockImplementationOnce(() =>
      fail("Only workspace admins can view or edit this configuration.", {
        errorCode: "data_connection_admin_required",
        statusCode: 403,
      }),
    );
    await expect(
      testDataConnection.run(
        {
          projectId: "selected-project",
          serviceAccount: key("probe@example.invalid"),
        },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({ errorCode: "data_connection_admin_required" });
    expect(state.tokenIssuers).toHaveLength(0);
    expect(state.metadataRequests).toHaveLength(0);
  });

  it.each([
    {
      rejectToken: true,
      metadataStatus: 200,
      errorCode: "bigquery_test_credential_rejected",
      statusCode: 422,
    },
    {
      rejectToken: false,
      metadataStatus: 403,
      errorCode: "bigquery_test_access_denied",
      statusCode: 424,
    },
  ])(
    "returns a sanitized provider rejection for $errorCode",
    async ({ rejectToken, metadataStatus, errorCode, statusCode }) => {
      state.rejectToken = rejectToken;
      state.metadataStatus = metadataStatus;
      await expect(
        testDataConnection.run(
          {
            projectId: "selected-project",
            serviceAccount: key("probe@example.invalid"),
          },
          { caller: "frontend" },
        ),
      ).rejects.toMatchObject({ errorCode, statusCode });
    },
  );

  it("tests an existing saved BigQuery connection via connectionId without re-submitting the service account JSON", async () => {
    state.credentials.set(
      "bq-saved-1:GOOGLE_APPLICATION_CREDENTIALS_JSON",
      key("saved-probe@example.invalid"),
    );
    await expect(
      testDataConnection.run(
        {
          connectionId: "bq-saved-1",
          projectId: "selected-project",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ verified: true });
    expect(state.metadataRequests).toEqual([
      {
        method: "GET",
        url: "https://bigquery.googleapis.com/bigquery/v2/projects/selected-project/datasets?maxResults=1",
      },
    ]);
    expect(state.metadataTokens).toEqual([
      "Bearer QA-TOKEN-saved-probe@example.invalid",
    ]);
  });

  it("verifies configured datasets against the saved BigQuery connection when datasetNames is set", async () => {
    state.credentials.set(
      "bq-saved-1:GOOGLE_APPLICATION_CREDENTIALS_JSON",
      key("saved-datasets@example.invalid"),
    );
    await expect(
      testDataConnection.run(
        {
          connectionId: "bq-saved-1",
          projectId: "selected-project",
          datasetNames: "analytics_dbt",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ verified: true });
    expect(state.metadataRequests).toEqual([
      {
        method: "GET",
        url: "https://bigquery.googleapis.com/bigquery/v2/projects/selected-project/datasets/analytics_dbt/tables?maxResults=1",
      },
    ]);
    expect(state.metadataTokens).toEqual([
      "Bearer QA-TOKEN-saved-datasets@example.invalid",
    ]);
  });

  it("checks project access rather than skipping when datasetNames is the all-datasets sentinel", async () => {
    await expect(
      testDataConnection.run(
        {
          projectId: "selected-project",
          serviceAccount: key("sentinel@example.invalid"),
          datasetNames: "[]",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ verified: true });
    expect(state.metadataRequests).toEqual([
      {
        method: "GET",
        url: "https://bigquery.googleapis.com/bigquery/v2/projects/selected-project/datasets?maxResults=1",
      },
    ]);
  });

  it("rejects a BigQuery test input that omits both serviceAccount and connectionId", async () => {
    await expect(
      testDataConnection.run({ projectId: "selected-project" } as never, {
        caller: "frontend",
      }),
    ).rejects.toThrow();
    expect(state.metadataRequests).toHaveLength(0);
  });

  it("accepts a dataset-scoped service account when project dataset listing returns 403 but dry-run query succeeds", async () => {
    state.metadataStatus = 403;
    state.dryRunStatus = 200;
    const result = await testDataConnection.run(
      {
        projectId: "selected-project",
        serviceAccount: key("qa-least-privilege@example.invalid"),
      },
      { caller: "frontend" },
    );
    expect(result).toEqual({ verified: true });
    expect(state.metadataRequests).toHaveLength(2);
    expect(state.metadataRequests[0]).toMatchObject({
      url: "https://bigquery.googleapis.com/bigquery/v2/projects/selected-project/datasets?maxResults=1",
      method: "GET",
    });
    expect(state.metadataRequests[1]).toMatchObject({
      url: "https://bigquery.googleapis.com/bigquery/v2/projects/selected-project/jobs?alt=json",
      method: "POST",
    });
    expect(JSON.parse(state.metadataRequests[1]?.body ?? "{}")).toEqual({
      configuration: {
        dryRun: true,
        query: {
          query: "SELECT 1 AS ok WHERE FALSE",
          useLegacySql: false,
        },
      },
    });
  });

  it("accepts a saved least-privilege BigQuery connection via connectionId when project dataset listing returns 403 but dry-run succeeds", async () => {
    state.credentials.set(
      "conn-least-privilege:GOOGLE_APPLICATION_CREDENTIALS_JSON",
      key("qa-saved-least-privilege@example.invalid"),
    );
    state.metadataStatus = 403;
    state.dryRunStatus = 200;
    const result = await testDataConnection.run(
      {
        connectionId: "conn-least-privilege",
        projectId: "selected-project",
      },
      { caller: "frontend" },
    );
    expect(result).toEqual({ verified: true });
    expect(state.metadataRequests.map((r) => r.method)).toEqual([
      "GET",
      "POST",
    ]);
  });

  it("does not fall back to dry-run on non-403 dataset errors and rejects dry-run errorResult responses", async () => {
    state.metadataStatus = 404;
    state.dryRunStatus = 200;
    await expect(
      validateSubmittedServiceAccount(
        "missing-project",
        key("qa-not-found@example.invalid"),
      ),
    ).rejects.toMatchObject({
      errorCode: "data_connection_rejected",
      details: { operation: "datasets", providerStatus: 404 },
    });
    expect(state.metadataRequests).toHaveLength(1);

    state.metadataRequests = [];
    state.metadataStatus = 403;
    state.dryRunStatus = 200;
    state.dryRunBody = {
      kind: "bigquery#job",
      status: { errorResult: { reason: "accessDenied" } },
    };
    await expect(
      testDataConnection.run(
        {
          projectId: "selected-project",
          serviceAccount: key("qa-error-result@example.invalid"),
        },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({
      errorCode: "bigquery_test_access_denied",
      statusCode: 424,
    });
  });
});

describe("selected warehouse authentication", () => {
  it("validates each newly submitted key without borrowing a cached token from the previous form", async () => {
    await validateSubmittedServiceAccount(
      "qa-project",
      key("qa-first@example.invalid"),
    );
    await validateSubmittedServiceAccount(
      "qa-project",
      key("qa-second@example.invalid"),
    );
    expect(state.tokenIssuers).toEqual([
      "qa-first@example.invalid",
      "qa-second@example.invalid",
    ]);
    expect(state.metadataTokens).toEqual([
      "Bearer QA-TOKEN-qa-first@example.invalid",
      "Bearer QA-TOKEN-qa-second@example.invalid",
    ]);
  });
  it("keeps two connection credentials and a later rotation separate inside the real provider token cache", async () => {
    state.credentials.set("connection-a:ref", key("qa-a@example.invalid"));
    state.credentials.set("connection-b:ref", key("qa-b@example.invalid"));
    await requestMetadata(
      await runtimeForConnection("connection-a", "ref"),
      "qa-project",
    );
    await requestMetadata(
      await runtimeForConnection("connection-b", "ref"),
      "qa-project",
    );
    state.credentials.set(
      "connection-a:ref",
      key("qa-rotated@example.invalid"),
    );
    await requestMetadata(
      await runtimeForConnection("connection-a", "ref"),
      "qa-project",
    );
    expect(state.metadataTokens).toEqual([
      "Bearer QA-TOKEN-qa-a@example.invalid",
      "Bearer QA-TOKEN-qa-b@example.invalid",
      "Bearer QA-TOKEN-qa-rotated@example.invalid",
    ]);
  });
  it("A2-ASK84-PUBLISHED-SOURCE-UNAVAILABLE reads panel credentials without a usage write that races concurrent profile checks", async () => {
    state.credentials.set("connection-a:ref", key("qa-a@example.invalid"));
    await runtimeForConnection("connection-a", "ref");
    expect(state.resolverOptions).toEqual([
      expect.objectContaining({
        connectionId: "connection-a",
        key: "ref",
        recordUsage: false,
      }),
    ]);
  });
  it("A2-ASK84-PUBLISHED-SOURCE-UNAVAILABLE reads Storage-transport credentials without the same racing usage write", async () => {
    state.credentials.set("connection-a:ref", "not json");
    await expect(
      storageClientForConnection("connection-a", "ref"),
    ).rejects.toMatchObject({ errorCode: "warehouse_query_credentials_invalid" });
    expect(state.resolverOptions).toEqual([
      expect.objectContaining({
        connectionId: "connection-a",
        key: "ref",
        recordUsage: false,
      }),
    ]);
  });
  it("does a fresh token exchange when revalidating the same key and refuses a rejected exchange", async () => {
    const credential = key("qa-revoked@example.invalid");
    await validateSubmittedServiceAccount("qa-project", credential);
    state.rejectToken = true;
    await expect(
      validateSubmittedServiceAccount("qa-project", credential),
    ).rejects.toThrow("Error connecting to data source");
    expect(state.tokenIssuers).toHaveLength(2);
    expect(state.metadataTokens).toHaveLength(1);
  });
  it("returns actual query values and continues pages without declaring a pending job complete", async () => {
    state.credentials.set(
      "connection-query:ref",
      key("qa-query@example.invalid"),
    );
    const runtime = await runtimeForConnection("connection-query", "ref");
    const jobReference = {
      projectId: "qa-project",
      jobId: "qa-job",
      location: "US",
    };
    state.queryResponses = [
      { jobComplete: false, jobReference },
      {
        jobComplete: true,
        jobReference,
        schema: { fields: [{ name: "one", type: "INTEGER" }] },
        rows: [{ f: [{ v: "1" }] }],
        totalRows: "2",
        pageToken: "next-page",
      },
      {
        jobComplete: true,
        jobReference,
        schema: { fields: [{ name: "one", type: "INTEGER" }] },
        rows: [{ f: [{ v: "2" }] }],
        totalRows: "2",
      },
    ];
    const pending = await executeQueryPage(runtime, "qa-project", {
      query: "SELECT 1 AS one",
      requestId: "1ea086ac-7dc6-4d0d-b7bd-a5b8e078cc32",
      first: 1,
    });
    expect(pending.jobComplete).toBe(false);
    expect(pending.status).toBe("running");
    const first = await executeQueryPage(runtime, "qa-project", {
      job: pending.jobReference,
      first: 1,
    });
    expect(first.rows).toEqual([["1"]]);
    expect(first.totalRows).toBe("2");
    expect(first.hasNextPage).toBe(true);
    const last = await executeQueryPage(runtime, "qa-project", {
      job: first.jobReference,
      ...(first.pageToken ? { pageToken: first.pageToken } : {}),
      first: 1,
    });
    expect(last.rows).toEqual([["2"]]);
    expect(last.hasNextPage).toBe(false);
  });
  it.each([
    { projectId: "qa-project", jobId: "other-job", location: "US" },
    { projectId: "qa-project", jobId: "qa-job", location: "EU" },
    { projectId: "other-project", jobId: "qa-job", location: "US" },
  ])(
    "rejects a continuation that switches the job identity: $projectId $jobId $location",
    async (returned) => {
      state.credentials.set(
        "connection-query:ref",
        key("qa-query@example.invalid"),
      );
      const runtime = await runtimeForConnection("connection-query", "ref");
      state.queryResponses = [
        {
          jobComplete: true,
          jobReference: returned,
          schema: { fields: [{ name: "one", type: "INTEGER" }] },
          rows: [{ f: [{ v: "1" }] }],
        },
      ];
      await expect(
        executeQueryPage(runtime, "qa-project", {
          job: { projectId: "qa-project", jobId: "qa-job", location: "US" },
          pageToken: "next-page",
        }),
      ).rejects.toThrow();
    },
  );
  it("retains the saved location when a continuation omits it", async () => {
    state.credentials.set(
      "connection-query:ref",
      key("qa-query@example.invalid"),
    );
    const runtime = await runtimeForConnection("connection-query", "ref");
    state.queryResponses = [
      {
        jobComplete: false,
        jobReference: { projectId: "qa-project", jobId: "qa-job" },
      },
    ];
    const result = await executeQueryPage(runtime, "qa-project", {
      job: { projectId: "qa-project", jobId: "qa-job", location: "US" },
    });
    expect(result.jobReference.location).toBe("US");
  });
  it("report A2-ASK84-PUBLISHED-SOURCE-UNAVAILABLE: resolves runtime for personal scope without enforcing org credential scope", async () => {
    state.context = {
      userEmail: "qa@example.invalid",
      orgId: undefined,
      orgScope: "personal",
    };
    state.credentials.set(
      "connection-personal:ref",
      key("qa-personal@example.invalid"),
    );
    const runtime = await runtimeForConnection("connection-personal", "ref");
    expect(runtime).toBeDefined();
    expect(runtime.authorityRevision).toBeDefined();
  });
});
