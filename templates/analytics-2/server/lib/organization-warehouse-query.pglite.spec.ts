import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineAction } from "@agent-native/core/action";
import type { AgentEngine } from "@agent-native/core/agent/engine";
import { closeDbExec, getDbExec, sql } from "@agent-native/core/db";
import { readAppSecret, writeAppSecret } from "@agent-native/core/secrets";
import {
  actionsToEngineTools,
  createToolSearchEntry,
  loadActionsFromStaticRegistry,
  runAgentLoop,
  runWithRequestContext,
} from "@agent-native/core/server";
import { getSettingsEmitter, putSetting } from "@agent-native/core/settings";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

const fixture = vi.hoisted(() => ({
  orgId: "query-reservation-workspace",
  userEmail: "query-owner@example.test",
  executeRequest: vi.fn(),
  readProjectId: vi.fn(),
}));

vi.mock("../../actions/_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => fixture.orgId,
}));
vi.mock("./org-bigquery-credentials.js", async (original) => ({
  ...(await original<typeof import("./org-bigquery-credentials.js")>()),
  requireOrganizationBigQueryProjectId: fixture.readProjectId,
  withOrganizationBigQueryRequestContext: async (
    _context: unknown,
    run: () => unknown,
  ) => run(),
}));
vi.mock("./provider-api.js", () => ({
  getAnalytics2OrganizationQueryProviderApiRuntime: () => ({
    requestCapabilities: { singleAttemptUnsafeRequests: true },
    executeRequest: fixture.executeRequest,
  }),
}));

import recovery from "../../actions/recover-organization-warehouse-query.js";
import action from "../../actions/run-organization-warehouse-query.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import type { OrganizationWarehouseQueryInput } from "../../shared/organization-warehouse-query-contract.js";
import { executeConnectionQuery } from "../model/data-connections.js";
import { collectDataframePages } from "../model/dataframe-materialization.js";
import { cancelOrganizationWarehouseQuery } from "./organization-warehouse-query.js";

const directory = mkdtempSync(
  join(tmpdir(), "organization-query-reservation-"),
);
const request = <T>(run: () => T) =>
  runWithRequestContext(
    {
      orgId: fixture.orgId,
      userEmail: fixture.userEmail,
    },
    run,
  );

function response(rows: string[], nextPage?: string, totalRows = "2") {
  return {
    response: {
      ok: true,
      truncated: false,
      json: {
        jobComplete: true,
        jobReference: {
          projectId: "query-fixture-project",
          jobId: "fixture-job",
          location: "US",
        },
        schema: { fields: [{ name: "entry", type: "STRING" }] },
        totalRows,
        rows: rows.map((value) => ({ f: [{ v: value }] })),
        ...(nextPage ? { pageToken: nextPage } : {}),
      },
    },
  };
}

async function storedRows() {
  const result = await getDbExec().execute(
    sql`SELECT key, value FROM public.settings ORDER BY key`,
  );
  return result.rows.map((row) => ({
    key: String(row.key),
    value: JSON.parse(String(row.value)) as Record<string, unknown>,
  }));
}

async function startQuery() {
  fixture.executeRequest.mockResolvedValueOnce(
    response(["first"], "provider-page-two"),
  );
  const result = await request(() =>
    action.run(
      {
        operation: "start",
        connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        sql: "SELECT entry FROM fixture_table",
        maxRows: 1,
      },
      { caller: "frontend" },
    ),
  );
  expect(result.queryId).toEqual(expect.any(String));
  if (result.queryId === null)
    throw new Error("Start returned no continuation");
  return { ...result, queryId: result.queryId };
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "database")}`);
  vi.stubEnv(
    "WORKSPACE_SECRETS_ENCRYPTION_KEY",
    "local reservation fixture encryption material",
  );
  vi.stubEnv(
    "SECRETS_ENCRYPTION_KEY",
    "local legacy reservation fixture encryption material",
  );
});

beforeEach(async () => {
  fixture.executeRequest.mockReset();
  fixture.readProjectId.mockReset().mockResolvedValue("query-fixture-project");
  await getDbExec().execute(sql`CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
  )`);
  await getDbExec().execute(sql`DELETE FROM public.settings`);
  await readAppSecret({
    key: "fixture-vault-initialization",
    scope: "org",
    scopeId: fixture.orgId,
  });
  await getDbExec().execute(sql`DELETE FROM app_secrets`);
});

it("discovers organization query tools only with both credentials in the active workspace", async () => {
  const modules = {
    "run-organization-warehouse-query": { default: action },
    "recover-organization-warehouse-query": { default: recovery },
  };
  const names = Object.keys(modules);
  const registry = loadActionsFromStaticRegistry(modules);
  const discovery = createToolSearchEntry(() => registry);
  const search = () =>
    request(() => discovery.run({ names }, { caller: "tool" }));
  const source = { scope: "org" as const, scopeId: fixture.orgId };
  const exactNames = async () =>
    z
      .object({ results: z.array(z.object({ name: z.string() })) })
      .parse(await search())
      .results.map(({ name }) => name)
      .sort();

  expect(await exactNames()).toEqual([]);
  await writeAppSecret({
    ...source,
    key: "BIGQUERY_PROJECT_ID",
    value: "query-fixture-project",
  });
  expect(await exactNames()).toEqual([]);
  await writeAppSecret({
    ...source,
    key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    value: "fixture-service-account",
  });
  expect(await exactNames()).toEqual(names.sort());
});

it("delivers stale organization credentials as a tool error and continues through the saved-warehouse path", async () => {
  const credentials = await vi.importActual<
    typeof import("./org-bigquery-credentials.js")
  >("./org-bigquery-credentials.js");
  fixture.readProjectId.mockImplementation(
    credentials.requireOrganizationBigQueryProjectId,
  );
  const organizationQuery = "run-organization-warehouse-query";
  const connectedSources = "list-data-connections";
  const connectionId = randomUUID();
  const actions = loadActionsFromStaticRegistry({
    [organizationQuery]: { default: action },
    [connectedSources]: {
      default: defineAction({
        description: "Read saved data connections.",
        schema: z.object({}),
        readOnly: true,
        run: async () => ({ connections: [{ id: connectionId }] }),
      }),
    },
  });
  const input: OrganizationWarehouseQueryInput = {
    operation: "start",
    connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
    sql: "SELECT 42",
    maxRows: 1,
  };
  let attempt = 0;
  const engine: AgentEngine = {
    name: "builder",
    label: "Fixture engine",
    defaultModel: "gpt-6-luna",
    supportedModels: ["gpt-6-luna"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream({ messages }) {
      const result = messages.at(-1)?.content[0];
      switch (attempt++) {
        case 0:
          yield {
            type: "tool-call",
            id: "org",
            name: organizationQuery,
            input,
          };
          yield { type: "stop", reason: "tool_use" };
          break;
        case 1:
          expect(result).toMatchObject({
            type: "tool-result",
            toolName: organizationQuery,
            isError: true,
            content: expect.stringContaining(
              '"nextRequiredAction":"add-project-cell"',
            ),
          });
          yield {
            type: "tool-call",
            id: "sources",
            name: connectedSources,
            input: {},
          };
          yield { type: "stop", reason: "tool_use" };
          break;
        default:
          expect(result).toMatchObject({
            type: "tool-result",
            toolName: connectedSources,
            content: expect.stringContaining(connectionId),
          });
          yield { type: "text-delta", text: "Found the saved warehouse." };
          yield { type: "stop", reason: "end_turn" };
      }
    },
  };
  const answer: string[] = [];
  const terminalErrors: string[] = [];
  await request(() =>
    runAgentLoop({
      engine,
      model: engine.defaultModel,
      systemPrompt: "Use the saved warehouse from the question.",
      tools: actionsToEngineTools(actions),
      actions,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `Use warehouse ${connectionId}` }],
        },
      ],
      send(event) {
        if (event.type === "text") answer.push(event.text);
        if (event.type === "error") terminalErrors.push(event.error);
      },
      signal: new AbortController().signal,
      ownerEmail: fixture.userEmail,
      orgId: fixture.orgId,
    }),
  );
  expect(terminalErrors).toEqual([]);
  expect(answer.join("")).toBe("Found the saved warehouse.");
  expect(fixture.executeRequest).not.toHaveBeenCalled();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  const safeDirectory = resolve(directory);
  if (
    !safeDirectory.startsWith(
      `${resolve(tmpdir())}/organization-query-reservation-`,
    )
  ) {
    throw new Error("Unsafe local fixture cleanup path");
  }
  rmSync(safeDirectory, { recursive: true });
});

describe("organization query reservations in a real local settings database", () => {
  it("preserves provider numeric types through the connection into dataframe capture", async () => {
    fixture.executeRequest.mockResolvedValueOnce({
      response: {
        ok: true,
        truncated: false,
        json: {
          jobComplete: true,
          jobReference: {
            projectId: "query-fixture-project",
            jobId: "fixture-job",
            location: "US",
          },
          schema: {
            fields: [
              { name: "rate", type: "FLOAT64" },
              { name: "amount", type: "NUMERIC" },
            ],
          },
          totalRows: "1",
          rows: [{ f: [{ v: "1.25" }, { v: "123456789.123456789" }] }],
        },
      },
    });
    const result = await request(() =>
      executeConnectionQuery(
        {
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          query: "SELECT 1.25 AS rate, 123456789.123456789 AS amount",
          first: 1000,
        },
        {
          userEmail: fixture.userEmail,
          orgId: fixture.orgId,
          caller: "frontend",
        },
      ),
    );
    const table = await collectDataframePages(result, async () => {
      throw new Error("Unexpected continuation");
    });
    expect(table.columns).toEqual([
      { name: "rate", type: "number", sqlType: "float" },
      { name: "amount", type: "number" },
    ]);
    expect(table.rows).toEqual([[1.25, "123456789.123456789"]]);
    expect(JSON.parse(JSON.stringify(result.columns))).toEqual([
      { name: "rate", type: "number" },
      { name: "amount", type: "number" },
    ]);
  });
  it("captures a multi-page organization result with exact mixed types and no provider replay", async () => {
    const schema = {
      fields: [
        { name: "id", type: "INT64" },
        { name: "rate", type: "FLOAT64" },
        { name: "amount", type: "NUMERIC" },
      ],
    };
    const providerPage = (from: number, count: number, nextPage?: string) => ({
      response: {
        ok: true,
        truncated: false,
        json: {
          jobComplete: true,
          jobReference: {
            projectId: "query-fixture-project",
            jobId: "fixture-job",
            location: "US",
          },
          schema,
          totalRows: "2501",
          rows: Array.from({ length: count }, (_, index) => ({
            f: [
              { v: String(from + index) },
              { v: "1.25" },
              { v: "123456789.123456789" },
            ],
          })),
          ...(nextPage ? { pageToken: nextPage } : {}),
        },
      },
    });
    fixture.executeRequest
      .mockResolvedValueOnce(providerPage(0, 1000, "provider-page-two"))
      .mockResolvedValueOnce(providerPage(1000, 1000, "provider-page-three"))
      .mockResolvedValueOnce(providerPage(2000, 501));
    const scope = {
      userEmail: fixture.userEmail,
      orgId: fixture.orgId,
      caller: "frontend",
    };
    const first = await request(() =>
      executeConnectionQuery(
        {
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          query: "SELECT id, rate, amount FROM paged_fixture",
          first: 1000,
        },
        scope,
      ),
    );
    expect(first.hasNextPage).toBe(true);
    const staleJob = first.jobReference;
    if (!staleJob) throw new Error("Missing continuation");
    const table = await collectDataframePages(
      first,
      async (pageToken, previous) => {
        const job = previous.jobReference;
        if (!job) throw new Error("Missing continuation");
        return request(() =>
          executeConnectionQuery(
            {
              connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
              job,
              pageToken,
              first: 1000,
            },
            scope,
          ),
        );
      },
    );
    expect(table.rowCount).toBe(2501);
    expect(table.rows[0]).toEqual([0, 1.25, "123456789.123456789"]);
    expect(table.rows[2500]).toEqual([2500, 1.25, "123456789.123456789"]);
    expect(table.columns).toEqual([
      { name: "id", type: "number" },
      { name: "rate", type: "number", sqlType: "float" },
      { name: "amount", type: "number" },
    ]);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(3);
    await expect(
      request(() =>
        executeConnectionQuery(
          {
            connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            job: staleJob,
            pageToken: staleJob.jobId,
            first: 1000,
          },
          scope,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: expect.any(String) });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(3);
  });
  it("keeps the stable job identity out of the public action result", async () => {
    const result = await startQuery();
    expect(Object.keys(result)).not.toContain("jobIdentity");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("jobIdentity");
    expect(serialized).not.toContain("fixture-job");
  });
  it("rejects unsupported repeated numeric values during dataframe capture", async () => {
    fixture.executeRequest.mockResolvedValueOnce({
      response: {
        ok: true,
        truncated: false,
        json: {
          jobComplete: true,
          jobReference: {
            projectId: "query-fixture-project",
            jobId: "fixture-job",
          },
          schema: {
            fields: [{ name: "rates", type: "FLOAT64", mode: "REPEATED" }],
          },
          totalRows: "1",
          rows: [{ f: [{ v: [{ v: "1.25" }] }] }],
        },
      },
    });
    const result = await request(() =>
      executeConnectionQuery(
        {
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          query: "SELECT rates",
          first: 1000,
        },
        {
          userEmail: fixture.userEmail,
          orgId: fixture.orgId,
          caller: "frontend",
        },
      ),
    );
    await expect(
      collectDataframePages(result, async () => {
        throw new Error("Unexpected continuation");
      }),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_materialization_failed",
    });
  });
  it("keeps provider types private in the public query and rejects rounded decimals", async () => {
    const reply = (value: unknown) => ({
      response: {
        ok: true,
        truncated: false,
        json: {
          jobComplete: true,
          jobReference: {
            projectId: "query-fixture-project",
            jobId: "fixture-job",
          },
          schema: { fields: [{ name: "amount", type: "NUMERIC" }] },
          totalRows: "1",
          rows: [{ f: [{ v: value }] }],
        },
      },
    });
    fixture.executeRequest.mockResolvedValueOnce(reply("123456789.123456789"));
    const result = await request(() =>
      action.run(
        {
          operation: "start",
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          sql: "SELECT amount FROM exact_fixture",
          maxRows: 1,
        },
        { caller: "frontend" },
      ),
    );
    expect(result.columns).toEqual([{ name: "amount", type: "number" }]);
    expect(result.rows).toEqual([{ amount: "123456789.123456789" }]);
    expect(JSON.stringify(result)).not.toContain("NUMERIC");
    fixture.executeRequest.mockResolvedValueOnce(reply(0.1));
    await expect(
      request(() =>
        action.run(
          {
            operation: "start",
            connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            sql: "SELECT amount FROM rounded_fixture",
            maxRows: 1,
          },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_malformed_result",
    });
  });
  it("cancels only the vault-backed job owned by the opaque continuation", async () => {
    const jobReference = {
      projectId: "query-fixture-project",
      jobId: "fixture-job",
      location: "US",
    };
    fixture.executeRequest.mockResolvedValueOnce({
      response: {
        ok: true,
        status: 200,
        truncated: false,
        json: { jobComplete: false, jobReference },
      },
    });
    const started = await request(() =>
      action.run(
        {
          operation: "start",
          connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
          sql: "SELECT entry FROM fixture_table",
          maxRows: 1,
        },
        { caller: "frontend" },
      ),
    );
    if (!started.queryId) throw new Error("Missing query continuation");
    const queryId = started.queryId;
    fixture.executeRequest.mockResolvedValueOnce({
      response: {
        ok: true,
        status: 200,
        truncated: false,
        json: { job: { jobReference, status: { state: "RUNNING" } } },
      },
    });
    expect(
      await request(() => cancelOrganizationWarehouseQuery(queryId, "request")),
    ).toBe("pending");
    expect(fixture.executeRequest.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "POST",
      path: "/projects/query-fixture-project/jobs/fixture-job/cancel",
      query: { location: "US" },
    });
    fixture.executeRequest.mockResolvedValueOnce({
      response: {
        ok: true,
        status: 200,
        truncated: false,
        json: {
          jobReference,
          status: { state: "DONE", errorResult: { reason: "stopped" } },
        },
      },
    });
    expect(
      await request(() => cancelOrganizationWarehouseQuery(queryId, "status")),
    ).toBe("cancelled");
    const calls = fixture.executeRequest.mock.calls.length;
    await expect(
      request(() => cancelOrganizationWarehouseQuery(queryId, "status")),
    ).rejects.toMatchObject({
      errorCode: "organization_query_continuation_stale",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(calls);
  });
  it("reserves identical starts once and does not resubmit an ambiguous timed-out POST", async () => {
    let rejectProvider: (error: Error) => void = () => {
      throw new Error("The initial provider request was not started");
    };
    let markDispatched: () => void = () => {};
    const dispatched = new Promise<void>((done) => {
      markDispatched = done;
    });
    fixture.executeRequest.mockImplementationOnce(() => {
      markDispatched();
      return new Promise((_, reject) => {
        rejectProvider = reject;
      });
    });
    const input = {
      operation: "start" as const,
      connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
      sql: "SELECT entry FROM timeout_fixture",
      maxRows: 1,
    } satisfies OrganizationWarehouseQueryInput;
    const initialCall = request(() =>
      action.run(input, { caller: "frontend" }),
    );
    const initialOutcome = Promise.allSettled([initialCall]);
    await dispatched;
    const reserved = await storedRows();
    expect(reserved).toHaveLength(1);
    expect(reserved[0]?.value).toMatchObject({ state: "reserved" });
    expect(reserved[0]?.value.reservation).toEqual(expect.any(String));
    await expect(
      request(() => action.run(input, { caller: "frontend" })),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
    rejectProvider(new Error("Controlled provider timeout after dispatch"));
    expect(await initialOutcome).toMatchObject([
      {
        status: "rejected",
        reason: { errorCode: "organization_query_request_failed" },
      },
    ]);
    const uncertain = await storedRows();
    expect(uncertain[0]?.value).toMatchObject({
      state: "uncertain",
      reservation: null,
    });
    expect(uncertain[0]?.value.tokenHash).not.toBe(
      reserved[0]?.value.tokenHash,
    );
    await expect(
      request(() => action.run(input, { caller: "frontend" })),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
    expect(await storedRows()).toEqual(uncertain);
  });

  it("dispatches one concurrent continuation and persists consumption before rejecting replay", async () => {
    const first = await startQuery();
    expect(first.rows).toEqual([{ entry: "first" }]);
    expect(first.status).toBe("paging");
    expect(first.queryId).toEqual(expect.any(String));
    const initial = await storedRows();
    expect(initial).toHaveLength(1);
    expect(initial[0]?.value).toMatchObject({
      actor: fixture.userEmail,
      orgId: fixture.orgId,
      source: ORGANIZATION_BIGQUERY_SOURCE_ID,
      state: "paging",
      reservation: null,
      returned: 1,
      continuationRef: initial[0]?.key,
    });
    // The private continuation moved to the vault under the accepted storage-boundary correction.
    expect(initial[0]?.value).not.toHaveProperty("providerPage");
    expect(initial[0]?.value).not.toHaveProperty("jobId");
    expect(initial[0]?.value).not.toHaveProperty("location");
    expect(initial[0]?.value).not.toHaveProperty("token");
    expect(JSON.stringify(initial)).not.toContain("provider-page-two");
    expect(JSON.stringify(initial)).not.toContain("fixture-job");
    const firstRecord = initial[0];
    if (!firstRecord) throw new Error("Start did not persist query state");
    const secretRef = {
      key: firstRecord.key,
      scope: "org" as const,
      scopeId: fixture.orgId,
    };
    const vault = await readAppSecret(secretRef);
    expect(vault).not.toBeNull();
    if (!vault) throw new Error("Start did not persist a private continuation");
    expect(JSON.parse(vault.value)).toMatchObject({
      actor: fixture.userEmail,
      orgId: fixture.orgId,
      source: ORGANIZATION_BIGQUERY_SOURCE_ID,
      providerPage: "provider-page-two",
      jobId: "fixture-job",
      location: "US",
    });
    const storedVault = await getDbExec().execute(
      sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
    );
    expect(storedVault.rows).toHaveLength(1);
    expect(JSON.stringify(storedVault.rows)).not.toContain("provider-page-two");
    expect(JSON.stringify(storedVault.rows)).not.toContain("fixture-job");
    expect(JSON.stringify(first)).not.toContain("provider-page-two");

    let release: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("The provider continuation was not started");
    };
    let markDispatched: () => void = () => {};
    const dispatched = new Promise<void>((done) => {
      markDispatched = done;
    });
    fixture.executeRequest.mockImplementationOnce(() => {
      markDispatched();
      return new Promise<ReturnType<typeof response>>((done) => {
        release = done;
      });
    });

    const continuation = {
      operation: "next-page" as const,
      queryId: first.queryId,
    };
    const firstContinuation = request(() =>
      action.run(continuation, { caller: "frontend" }),
    );
    await dispatched;
    const reserved = await storedRows();
    expect(reserved[0]?.value.reservation).toEqual(expect.any(String));
    const concurrent = await Promise.allSettled([
      request(() => action.run(continuation, { caller: "frontend" })),
    ]);
    expect(concurrent).toHaveLength(1);
    expect(concurrent[0]).toMatchObject({
      status: "rejected",
      reason: { errorCode: "organization_query_in_progress" },
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);

    release(response(["last"]));
    const last = await firstContinuation;
    expect(last.rows).toEqual([{ entry: "last" }]);
    expect(last).toMatchObject({
      status: "complete",
      complete: true,
      hasMore: false,
      queryId: null,
      nextPageToken: null,
      totalRows: "2",
      truncated: false,
    });
    const completed = await storedRows();
    expect(completed[0]?.value).toMatchObject({
      reservation: null,
      state: "complete",
      returned: 2,
      pages: 2,
      continuationRef: null,
      totalRows: "2",
    });
    expect(completed[0]?.value.tokenHash).not.toBe(initial[0]?.value.tokenHash);
    expect(completed[0]?.value).not.toHaveProperty("providerPage");
    expect(await readAppSecret(secretRef)).toBeNull();
    await expect(
      request(() => action.run(continuation, { caller: "frontend" })),
    ).rejects.toMatchObject({
      errorCode: "organization_query_continuation_stale",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
  });

  it("marks a first page that has more rows as a partial preview and clears the note on the final page (SAYA-1117-PREVIEW-INFERENCE)", async () => {
    const first = await startQuery();
    expect(first).toMatchObject({ hasMore: true, complete: false });
    expect(first.warnings).toEqual([
      expect.stringContaining("not a representative sample"),
    ]);
    expect(first.warnings.join(" ")).toMatch(/absence|extremes|grain/);
    fixture.executeRequest.mockImplementationOnce(async () =>
      response(["last"]),
    );
    const last = await request(() =>
      action.run(
        { operation: "next-page", queryId: first.queryId },
        { caller: "frontend" },
      ),
    );
    expect(last).toMatchObject({ hasMore: false, complete: true });
    expect(last.warnings).toEqual([]);
  });

  it("rejects expired durable state before any continuation dispatch", async () => {
    const first = await startQuery();
    const [saved] = await storedRows();
    expect(saved).toBeDefined();
    if (!saved) throw new Error("Start did not persist its query state");
    const expired = { ...saved.value, expiresAt: 1 };
    await getDbExec().execute(
      sql`UPDATE public.settings SET value = ${sql.value(JSON.stringify(expired))} WHERE key = ${sql.value(saved.key)}`,
    );
    await expect(
      request(() =>
        action.run(
          { operation: "next-page", queryId: first.queryId },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_continuation_stale",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
    expect((await storedRows())[0]?.value).toEqual(expired);
  });

  it.each(["write", "delete"] as const)(
    "rolls back a private-continuation %s when durable finalization loses its reservation",
    async (operation) => {
      fixture.executeRequest.mockResolvedValueOnce(
        response(["first"], "provider-page-two", "3"),
      );
      const first = await request(() =>
        action.run(
          {
            operation: "start",
            connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            sql: "SELECT entry FROM rollback_fixture",
            maxRows: 2,
          },
          { caller: "frontend" },
        ),
      );
      expect(first.queryId).toEqual(expect.any(String));
      if (first.queryId === null)
        throw new Error("Start returned no continuation");
      const queryId = first.queryId;
      const [previous] = await storedRows();
      if (!previous) throw new Error("Start did not persist query state");
      const secretRef = {
        key: previous.key,
        scope: "org" as const,
        scopeId: fixture.orgId,
      };
      const previousSecret = await readAppSecret(secretRef);
      expect(previousSecret).not.toBeNull();
      const previousCiphertext = await getDbExec().execute(
        sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
      );
      let competingState: Record<string, unknown> | undefined;
      fixture.executeRequest.mockImplementationOnce(async () => {
        const [reserved] = await storedRows();
        if (!reserved)
          throw new Error("Continuation did not reserve query state");
        competingState = {
          ...reserved.value,
          reservation: "another-operation",
        };
        await getDbExec().execute(
          sql`UPDATE public.settings SET value = ${sql.value(JSON.stringify(competingState))} WHERE key = ${sql.value(previous.key)}`,
        );
        return operation === "write"
          ? response(["middle"], "provider-page-three", "3")
          : response(["middle", "last"], undefined, "3");
      });
      await expect(
        request(() =>
          action.run(
            {
              operation: "next-page",
              queryId,
            },
            { caller: "frontend" },
          ),
        ),
      ).rejects.toMatchObject({
        errorCode: "organization_query_reservation_lost",
      });
      expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
      expect(competingState).toBeDefined();
      expect((await storedRows())[0]?.value).toEqual(competingState);
      expect((await storedRows())[0]?.value).toMatchObject({
        tokenHash: previous.value.tokenHash,
        continuationRef: previous.value.continuationRef,
        returned: 1,
        pages: 1,
        reservation: "another-operation",
      });
      expect(await readAppSecret(secretRef)).toEqual(previousSecret);
      expect(
        (
          await getDbExec().execute(
            sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
          )
        ).rows,
      ).toEqual(previousCiphertext.rows);
    },
  );

  it("keeps corrupt present state distinct from an absent query and does not dispatch", async () => {
    const first = await startQuery();
    const [saved] = await storedRows();
    expect(saved).toBeDefined();
    if (!saved) throw new Error("Start did not persist its query state");
    await getDbExec().execute(
      sql`UPDATE public.settings SET value = ${sql.value("null")} WHERE key = ${sql.value(saved.key)}`,
    );
    await expect(
      request(() =>
        action.run(
          { operation: "next-page", queryId: first.queryId },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_state_unreadable",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
    expect((await storedRows())[0]?.value).toBeNull();
  });

  it("keeps query keys off the real global settings emitter while ordinary writes remain observable", async () => {
    const emitter = getSettingsEmitter();
    const events: string[] = [];
    const listener = (event: unknown) => {
      if (
        typeof event === "object" &&
        event !== null &&
        "key" in event &&
        typeof event.key === "string"
      ) {
        events.push(event.key);
      }
    };
    emitter.on("settings", listener);
    try {
      await putSetting("ordinary-event-witness", { value: "visible" });
      expect(events).toContain("ordinary-event-witness");
      const first = await startQuery();
      expect(first.status).toBe("paging");
      const [state] = (await storedRows()).filter((row) =>
        row.key.startsWith("analytics-2:organization-query:"),
      );
      if (!state) throw new Error("Start did not persist a query reservation");
      expect(
        await readAppSecret({
          key: state.key,
          scope: "org",
          scopeId: fixture.orgId,
        }),
      ).not.toBeNull();
      fixture.executeRequest.mockResolvedValueOnce(response(["last"]));
      const last = await request(() =>
        action.run(
          {
            operation: "next-page",
            queryId: first.queryId,
          },
          { caller: "frontend" },
        ),
      );
      expect(last).toMatchObject({
        status: "complete",
        rows: [{ entry: "last" }],
      });
      expect(
        await readAppSecret({
          key: state.key,
          scope: "org",
          scopeId: fixture.orgId,
        }),
      ).toBeNull();
      expect(
        events.filter((key) =>
          key.startsWith("analytics-2:organization-query:"),
        ),
      ).toEqual([]);
      expect(events).toContain("ordinary-event-witness");
    } finally {
      emitter.off("settings", listener);
    }
  });

  it("rejects an absent valid opaque continuation as invalid without treating it as corrupt stored state", async () => {
    const queryId = `${createHash("sha256").update(randomUUID()).digest("hex")}.${randomUUID()}`;
    const [result] = await Promise.allSettled([
      request(() =>
        action.run({ operation: "next-page", queryId }, { caller: "frontend" }),
      ),
    ]);
    expect(result).toMatchObject({
      status: "rejected",
      reason: { errorCode: "organization_query_continuation_invalid" },
    });
    if (!result || result.status !== "rejected")
      throw new Error("An absent continuation was accepted");
    expect(result.reason.statusCode).toBeGreaterThanOrEqual(400);
    expect(result.reason.statusCode).toBeLessThan(500);
    expect(fixture.executeRequest).not.toHaveBeenCalled();
    expect(await storedRows()).toEqual([]);
  });

  it("starts explicitly after a failed query even when the previous transient vault ciphertext is corrupt", async () => {
    await startQuery();
    const [previous] = await storedRows();
    if (!previous) throw new Error("Start did not persist query state");
    const failed = {
      ...previous.value,
      state: "failed",
      reservation: null,
      continuationRef: null,
    };
    await getDbExec().execute(
      sql`UPDATE public.settings SET value = ${sql.value(JSON.stringify(failed))} WHERE key = ${sql.value(previous.key)}`,
    );
    await getDbExec()
      .execute(sql`UPDATE app_secrets SET encrypted_value = ${sql.value("unreadable fixture ciphertext")}, shared_encrypted_value = ${sql.value("unreadable fixture ciphertext")}
      WHERE scope = ${sql.value("org")} AND scope_id = ${sql.value(fixture.orgId)} AND key = ${sql.value(previous.key)}`);
    const restarted = await startQuery();
    expect(restarted).toMatchObject({
      status: "paging",
      rows: [{ entry: "first" }],
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
    const [saved] = await storedRows();
    expect(saved?.value).toMatchObject({
      state: "paging",
      reservation: null,
      continuationRef: previous.key,
    });
    const replacement = await readAppSecret({
      key: previous.key,
      scope: "org",
      scopeId: fixture.orgId,
    });
    expect(replacement).not.toBeNull();
    if (!replacement)
      throw new Error("Restart did not persist its private continuation");
    expect(JSON.parse(replacement.value)).toMatchObject({
      actor: fixture.userEmail,
      orgId: fixture.orgId,
      providerPage: "provider-page-two",
    });
  });

  it("deletes its private continuation atomically when a provider rejects the next page", async () => {
    const first = await startQuery();
    const [previous] = await storedRows();
    if (!previous) throw new Error("Start did not persist query state");
    const secretRef = {
      key: previous.key,
      scope: "org" as const,
      scopeId: fixture.orgId,
    };
    expect(await readAppSecret(secretRef)).not.toBeNull();
    fixture.executeRequest.mockResolvedValueOnce({
      response: { ok: false, status: 400, truncated: false, json: {} },
    });
    await expect(
      request(() =>
        action.run(
          { operation: "next-page", queryId: first.queryId },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_provider_failed",
    });
    expect((await storedRows())[0]?.value).toMatchObject({
      state: "failed",
      reservation: null,
      continuationRef: null,
    });
    expect(await readAppSecret(secretRef)).toBeNull();
    expect(
      (await getDbExec().execute(sql`SELECT key FROM app_secrets`)).rows,
    ).toEqual([]);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
  });

  it("rolls back failed-continuation vault deletion when cleanup loses the durable reservation", async () => {
    const first = await startQuery();
    const [previous] = await storedRows();
    if (!previous) throw new Error("Start did not persist query state");
    const secretRef = {
      key: previous.key,
      scope: "org" as const,
      scopeId: fixture.orgId,
    };
    const previousSecret = await readAppSecret(secretRef);
    expect(previousSecret).not.toBeNull();
    const previousCiphertext = await getDbExec().execute(
      sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
    );
    expect(previousCiphertext.rows).toHaveLength(1);
    let competingState: Record<string, unknown> | undefined;
    fixture.executeRequest.mockImplementationOnce(async () => {
      const [reserved] = await storedRows();
      if (!reserved)
        throw new Error("Continuation did not reserve query state");
      competingState = {
        ...reserved.value,
        reservation: "another-failure-cleanup",
      };
      await getDbExec().execute(
        sql`UPDATE public.settings SET value = ${sql.value(JSON.stringify(competingState))} WHERE key = ${sql.value(previous.key)}`,
      );
      return {
        response: { ok: false, status: 400, truncated: false, json: {} },
      };
    });
    await expect(
      request(() =>
        action.run(
          { operation: "next-page", queryId: first.queryId },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_reservation_lost",
    });
    expect(competingState).toBeDefined();
    expect((await storedRows())[0]?.value).toEqual(competingState);
    expect((await storedRows())[0]?.value).toMatchObject({
      continuationRef: previous.key,
      tokenHash: previous.value.tokenHash,
      pages: 1,
      returned: 1,
    });
    expect(await readAppSecret(secretRef)).toEqual(previousSecret);
    expect(
      (
        await getDbExec().execute(
          sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
        )
      ).rows,
    ).toEqual(previousCiphertext.rows);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["pending", "paging"] as const)(
    "preserves a %s continuation across a locally tagged quota cooldown and retries the same opaque identity",
    async (phase) => {
      const pendingResponse = {
        response: {
          ok: true,
          status: 200,
          truncated: false,
          json: {
            jobComplete: false,
            jobReference: {
              projectId: "query-fixture-project",
              jobId: "fixture-job",
              location: "US",
            },
          },
        },
      };
      fixture.executeRequest.mockResolvedValueOnce(
        phase === "pending"
          ? pendingResponse
          : response(["first"], "provider-page-two"),
      );
      const first = await request(() =>
        action.run(
          {
            operation: "start",
            connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            sql: "SELECT entry FROM quota_fixture",
            maxRows: phase === "pending" ? 2 : 1,
          },
          { caller: "frontend" },
        ),
      );
      expect(first.status).toBe(phase === "pending" ? "running" : "paging");
      if (first.queryId === null)
        throw new Error("Start returned no continuation");
      const queryId = first.queryId;
      const [previous] = await storedRows();
      if (!previous) throw new Error("Start did not persist query state");
      const secretRef = {
        key: previous.key,
        scope: "org" as const,
        scopeId: fixture.orgId,
      };
      const previousSecret = await readAppSecret(secretRef);
      expect(previousSecret).not.toBeNull();
      const previousCiphertext = await getDbExec().execute(
        sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
      );
      const retryAt = new Date(Date.now()).toISOString();
      fixture.executeRequest.mockResolvedValueOnce({
        response: {
          ok: false,
          status: 429,
          truncated: false,
          headers: {
            "retry-after": "0",
            "x-agent-native-provider-quota": "exhausted",
          },
          json: {
            error: "provider_quota_exhausted",
            provider: "bigquery",
            retryAfterMs: 0,
            retryAt,
            reason: "cooldown",
          },
          quota: {
            exhausted: true,
            providerId: "bigquery",
            retryAfterMs: 0,
            retryAt,
            reason: "cooldown",
          },
        },
      });
      const operation =
        phase === "pending" ? ("poll" as const) : ("next-page" as const);
      await expect(
        request(() =>
          action.run({ operation, queryId }, { caller: "frontend" }),
        ),
      ).rejects.toMatchObject({
        errorCode: "organization_query_quota_cooldown",
        statusCode: 429,
      });
      expect((await storedRows())[0]?.value).toEqual(previous.value);
      expect(await readAppSecret(secretRef)).toEqual(previousSecret);
      expect(
        (
          await getDbExec().execute(
            sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
          )
        ).rows,
      ).toEqual(previousCiphertext.rows);
      fixture.executeRequest.mockResolvedValueOnce(
        response(phase === "pending" ? ["first", "last"] : ["last"]),
      );
      const retried = await request(() =>
        action.run({ operation, queryId }, { caller: "frontend" }),
      );
      expect(retried).toMatchObject({
        status: "complete",
        complete: true,
        hasMore: false,
        truncated: false,
        totalRows: "2",
        rows:
          phase === "pending"
            ? [{ entry: "first" }, { entry: "last" }]
            : [{ entry: "last" }],
      });
      expect(fixture.executeRequest).toHaveBeenCalledTimes(3);
      expect(fixture.executeRequest).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ method: "POST" }),
      );
      expect(fixture.executeRequest).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ method: "GET" }),
      );
      expect(fixture.executeRequest).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ method: "GET" }),
      );
      expect(await readAppSecret(secretRef)).toBeNull();
    },
  );

  it("refuses a quota-release CAS after losing the reservation without changing the competitor continuation", async () => {
    const first = await startQuery();
    const [previous] = await storedRows();
    if (!previous) throw new Error("Start did not persist query state");
    const secretRef = {
      key: previous.key,
      scope: "org" as const,
      scopeId: fixture.orgId,
    };
    const previousSecret = await readAppSecret(secretRef);
    expect(previousSecret).not.toBeNull();
    const previousCiphertext = await getDbExec().execute(
      sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
    );
    let competingState: Record<string, unknown> | undefined;
    fixture.executeRequest.mockImplementationOnce(async () => {
      const [reserved] = await storedRows();
      if (!reserved)
        throw new Error("Continuation did not reserve query state");
      competingState = {
        ...reserved.value,
        reservation: "another-quota-operation",
      };
      await getDbExec().execute(
        sql`UPDATE public.settings SET value = ${sql.value(JSON.stringify(competingState))} WHERE key = ${sql.value(previous.key)}`,
      );
      return {
        response: {
          ok: false,
          status: 429,
          truncated: false,
          headers: {
            "retry-after": "0",
            "x-agent-native-provider-quota": "exhausted",
          },
          json: {
            error: "provider_quota_exhausted",
            provider: "bigquery",
            retryAfterMs: 0,
            reason: "cooldown",
          },
          quota: {
            exhausted: true,
            providerId: "bigquery",
            retryAfterMs: 0,
            reason: "cooldown",
          },
        },
      };
    });
    await expect(
      request(() =>
        action.run(
          { operation: "next-page", queryId: first.queryId },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_reservation_lost",
    });
    expect(competingState).toBeDefined();
    expect((await storedRows())[0]?.value).toEqual(competingState);
    expect((await storedRows())[0]?.value).toMatchObject({
      reservation: "another-quota-operation",
      continuationRef: previous.key,
      tokenHash: previous.value.tokenHash,
      pages: 1,
      returned: 1,
    });
    expect(await readAppSecret(secretRef)).toEqual(previousSecret);
    expect(
      (
        await getDbExec().execute(
          sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
        )
      ).rows,
    ).toEqual(previousCiphertext.rows);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "unavailable", "truncated", "malformed"] as const)(
    "preserves the same opaque page continuation after a transient %s GET failure",
    async (kind) => {
      const first = await startQuery();
      const [previous] = await storedRows();
      if (!previous) throw new Error("Start did not persist query state");
      const secretRef = {
        key: previous.key,
        scope: "org" as const,
        scopeId: fixture.orgId,
      };
      const previousSecret = await readAppSecret(secretRef);
      expect(previousSecret).not.toBeNull();
      const previousCiphertext = await getDbExec().execute(
        sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
      );
      const page = response(["last"]);
      if (kind === "network") {
        fixture.executeRequest.mockRejectedValueOnce(
          new Error("Controlled continuation network failure"),
        );
      } else if (kind === "unavailable") {
        fixture.executeRequest.mockResolvedValueOnce({
          response: { ok: false, status: 503, truncated: false, json: {} },
        });
      } else if (kind === "truncated") {
        fixture.executeRequest.mockResolvedValueOnce({
          response: { ...page.response, status: 200, truncated: true },
        });
      } else {
        fixture.executeRequest.mockResolvedValueOnce({
          response: {
            ...page.response,
            status: 200,
            json: { ...page.response.json, schema: { fields: [] } },
          },
        });
      }
      const errorCode =
        kind === "network"
          ? "organization_query_request_failed"
          : kind === "unavailable"
            ? "organization_query_provider_failed"
            : kind === "truncated"
              ? "organization_query_response_truncated"
              : "organization_query_schema_unreadable";
      await expect(
        request(() =>
          action.run(
            { operation: "next-page", queryId: first.queryId },
            { caller: "frontend" },
          ),
        ),
      ).rejects.toMatchObject({ errorCode });
      expect((await storedRows())[0]?.value).toEqual(previous.value);
      expect(await readAppSecret(secretRef)).toEqual(previousSecret);
      expect(
        (
          await getDbExec().execute(
            sql`SELECT encrypted_value, shared_encrypted_value FROM app_secrets`,
          )
        ).rows,
      ).toEqual(previousCiphertext.rows);
      fixture.executeRequest.mockResolvedValueOnce({
        response: { ...page.response, status: 200 },
      });
      const retried = await request(() =>
        action.run(
          { operation: "next-page", queryId: first.queryId },
          { caller: "frontend" },
        ),
      );
      expect(retried).toMatchObject({
        status: "complete",
        complete: true,
        hasMore: false,
        truncated: false,
        totalRows: "2",
        rows: [{ entry: "last" }],
      });
      expect(fixture.executeRequest).toHaveBeenCalledTimes(3);
      expect(fixture.executeRequest).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ method: "POST" }),
      );
      expect(fixture.executeRequest).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ method: "GET" }),
      );
      expect(fixture.executeRequest).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ method: "GET" }),
      );
      expect(await readAppSecret(secretRef)).toBeNull();
    },
  );
});
