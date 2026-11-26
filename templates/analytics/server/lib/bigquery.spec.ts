import {
  getOrCreateRequestDbPool,
  runWithRequestDbPoolScope,
} from "@agent-native/core/db/request-pool-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BigQueryJobUsage,
  type BigQueryUsageAttribution,
  withBigQueryUsageAttribution,
} from "./bigquery-usage";

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture observation");
  return value;
}

const execute = vi.fn();
const usageWrites = vi.hoisted(() => [] as BigQueryJobUsage[]);
const persistUsage = vi.hoisted(() =>
  vi.fn(async (usage: BigQueryJobUsage) => {
    usageWrites.push(structuredClone(usage));
    return true;
  }),
);
const finalizeUsage = vi.hoisted(() =>
  vi.fn(
    async (
      usage: BigQueryJobUsage,
      _token: string,
      recorded: boolean,
      _signal?: AbortSignal,
    ) => ({
      status: recorded ? ("recorded" as const) : ("unavailable" as const),
      projectId: usage.projectId,
      jobId: usage.jobId,
      usageStatus: usage.usageStatus,
    }),
  ),
);
vi.mock("./bigquery-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bigquery-usage")>()),
  persistBigQueryJobUsage: persistUsage,
  finalizeBigQueryJobUsage: finalizeUsage,
}));
const resolveCredential = vi.fn();
const getBigQueryAccessToken = vi.fn();
const getCredentialContext = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getCredentialContext,
  getRequestRunContext: () => undefined,
  platformWaitUntil: () => undefined,
}));

vi.mock("../db/index", async () => ({
  schema: await import("../db/schema"),
  getDb: () => {
    throw new Error("Unexpected app database access in the provider fixture");
  },
}));
vi.mock("./credentials", () => ({ resolveCredential }));

vi.mock("./scoped-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scoped-settings")>()),
  getScopedSettingRecord: async () => ({
    sink: "bigquery",
    table: "test-project.analytics.events",
  }),
}));
vi.mock("./first-party-analytics-health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./first-party-analytics-health")>()),
  recordFirstPartyAnalyticsQueryPressure: async () => {},
}));

vi.mock("./gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gcloud")>()),
  getBigQueryAccessToken,
}));

const {
  BigQueryBackendError,
  BigQueryDryRunPreparationError,
  BigQueryJobNotClaimedError,
  BigQueryMaximumBytesBilledError,
  BigQueryQueryTimeoutError,
  dryRunQuery,
  dryRunQuerySchema,
  newBigQueryQueryTrace,
  renderCurrentDateLiterals,
  runQuery,
} = await import("./bigquery");

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function mockQueryJobs(...results: Response[]) {
  const pendingResults = [...results];
  return vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/jobs")) {
        const request = JSON.parse(String(init?.body)) as {
          jobReference: { jobId: string; projectId: string };
        };
        return jsonResponse({ jobReference: request.jobReference });
      }
      const result = pendingResults.shift();
      if (!result)
        throw new Error(`No BigQuery poll response configured for ${url}`);
      return result;
    });
}

function useCacheDatabase(): Map<
  string,
  {
    result: string;
    generation: number;
    fenceToken: string | null;
    refreshInProgress: boolean;
    refreshForced: boolean;
    refreshStartedAt: string | null;
    expiresAt: string;
    createdAt: string;
  }
> {
  const cache = new Map<
    string,
    {
      result: string;
      generation: number;
      fenceToken: string | null;
      refreshInProgress: boolean;
      refreshForced: boolean;
      refreshStartedAt: string | null;
      expiresAt: string;
      createdAt: string;
    }
  >();
  execute.mockImplementation(async ({ sql, args }) => {
    if (sql.startsWith("DELETE FROM bigquery_cache")) {
      const expiresBefore = String(args[0]);
      const staleBefore = String(args[1]);
      for (const [key, entry] of cache) {
        const expiredIdleResult =
          !entry.refreshInProgress && entry.expiresAt <= expiresBefore;
        const abandonedRefresh =
          entry.refreshInProgress &&
          entry.refreshStartedAt !== null &&
          entry.refreshStartedAt < staleBefore;
        if (expiredIdleResult || abandonedRefresh) cache.delete(key);
      }
      return { rows: [] };
    }
    const key = String(args[0]);
    const entry = cache.get(key);
    if (sql.startsWith("SELECT generation, fence_token")) {
      return {
        rows: entry
          ? [
              {
                generation: entry.generation,
                fence_token: entry.fenceToken,
                refresh_in_progress: entry.refreshInProgress,
                refresh_forced: entry.refreshForced,
                refresh_started_at: entry.refreshStartedAt,
              },
            ]
          : [],
      };
    }
    if (sql.startsWith("SELECT result")) {
      return {
        rows:
          entry && entry.expiresAt > String(args[1])
            ? [{ result: entry.result, created_at: entry.createdAt }]
            : [],
      };
    }
    if (sql.includes("VALUES ($1, $2, '{}', 0, $3, $3, 1")) {
      const staleBefore = String(args[3]);
      if (entry?.refreshInProgress && entry.refreshStartedAt! >= staleBefore) {
        return { rows: [] };
      }
      const next = {
        result: entry?.result ?? "{}",
        generation: (entry?.generation ?? 0) + 1,
        fenceToken: String(args[4]),
        refreshInProgress: true,
        refreshForced: Boolean(args[5]),
        refreshStartedAt: String(args[2]),
        expiresAt: entry?.expiresAt ?? String(args[2]),
        createdAt: entry?.createdAt ?? String(args[2]),
      };
      cache.set(key, next);
      return {
        rows: [{ generation: next.generation, fence_token: next.fenceToken }],
      };
    }
    if (sql.startsWith("INSERT INTO bigquery_cache")) {
      const generation = Number(args[6]);
      const expectedGeneration = Number(args[8]);
      const expectedToken = (args[9] as string | null) ?? null;
      const next = {
        result: String(args[2]),
        generation,
        fenceToken: String(args[7]),
        refreshInProgress: false,
        refreshForced: false,
        refreshStartedAt: null,
        expiresAt: String(args[5]),
        createdAt: String(args[4]),
      };
      if (!entry) {
        cache.set(key, next);
        return {
          rows: [{ generation: next.generation, fence_token: next.fenceToken }],
        };
      }
      if (
        entry.generation === expectedGeneration &&
        entry.fenceToken === expectedToken &&
        !entry.refreshInProgress
      ) {
        cache.set(key, next);
        return {
          rows: [{ generation: next.generation, fence_token: next.fenceToken }],
        };
      }
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE bigquery_cache SET sql")) {
      const generation = Number(args[6]);
      const fenceToken = String(args[7]);
      if (
        entry?.generation === generation &&
        entry.fenceToken === fenceToken &&
        entry.refreshInProgress
      ) {
        const next = {
          result: String(args[2]),
          generation: generation + 1,
          fenceToken,
          refreshInProgress: false,
          refreshForced: false,
          refreshStartedAt: null,
          expiresAt: String(args[5]),
          createdAt: String(args[4]),
        };
        cache.set(key, next);
        return {
          rows: [{ generation: next.generation, fence_token: next.fenceToken }],
        };
      }
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE bigquery_cache SET refresh_in_progress")) {
      if (sql.includes("refresh_started_at = $3")) {
        const staleFenceToken = (args[4] as string | null) ?? null;
        if (
          entry?.generation === Number(args[1]) &&
          entry.fenceToken === staleFenceToken &&
          entry.refreshInProgress &&
          entry.refreshStartedAt === String(args[2])
        ) {
          cache.set(key, {
            ...entry,
            refreshInProgress: false,
            refreshForced: false,
            refreshStartedAt: null,
          });
          return { rows: [{ key }] };
        }
        return { rows: [] };
      }
      const generation = Number(args[1]);
      const fenceToken = String(args[2]);
      if (
        entry?.generation === generation &&
        entry.fenceToken === fenceToken &&
        entry.refreshInProgress
      ) {
        cache.set(key, {
          ...entry,
          refreshInProgress: false,
          refreshForced: false,
          refreshStartedAt: null,
        });
        return { rows: [{ key }] };
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
  return cache;
}

function pauseNextL2Read(): { started: Promise<void>; release: () => void } {
  const original = execute.getMockImplementation();
  if (!original) throw new Error("Cache database mock is not configured");

  let signalStarted!: () => void;
  let releaseRead!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const readBlocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let shouldPause = true;

  execute.mockImplementation(
    async (input: { sql: string; args: unknown[] }) => {
      if (shouldPause && input.sql.startsWith("SELECT result")) {
        shouldPause = false;
        const snapshot = await original(input);
        signalStarted();
        await readBlocked;
        return snapshot;
      }
      return original(input);
    },
  );

  return { started, release: releaseRead };
}

describe("runQuery cancellation", () => {
  beforeEach(() => {
    usageWrites.length = 0;
    persistUsage.mockClear();
    finalizeUsage.mockClear();
    execute.mockReset();
    useCacheDatabase();
    getCredentialContext.mockReset();
    getCredentialContext.mockReturnValue({
      userEmail: "test@example.com",
      orgId: null,
    });
    resolveCredential.mockReset();
    resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID" ? "test-project" : null,
    );
    getBigQueryAccessToken.mockReset();
    getBigQueryAccessToken.mockResolvedValue("test-access-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not start warehouse work when its request scope is already closed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lateQuery!: Promise<unknown>;
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await runWithRequestDbPoolScope(true, undefined, () => {
      lateQuery = gate.then(() => runQuery("SELECT 1 AS closed_request"));
    });
    release();
    await expect(lateQuery).rejects.toThrow("already closed");
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(getBigQueryAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(persistUsage).not.toHaveBeenCalled();
  });

  it("retains query pools when a panel stops awaiting the warehouse job", async () => {
    let releaseToken!: (token: string) => void;
    let tokenStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      tokenStarted = resolve;
    });
    getBigQueryAccessToken.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseToken = resolve;
          tokenStarted();
        }),
    );
    const ended = vi.fn(async () => {});
    let query!: ReturnType<typeof runQuery>;
    await runWithRequestDbPoolScope(true, undefined, async () => {
      getOrCreateRequestDbPool("outliving-query", () => ({ end: ended }));
      query = runQuery("SELECT 1 AS outliving_request");
      await started;
      // Model a panel timeout returning while its uncancelled query still runs.
    });
    expect(ended).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      mockQueryJobs(
        jsonResponse({ jobComplete: true, schema: { fields: [] }, rows: [] }),
      ),
    );
    finalizeUsage.mockImplementationOnce(async (usage) => {
      getOrCreateRequestDbPool("outliving-query", () => {
        throw new Error("Pool lost before finalization");
      });
      return {
        projectId: usage.projectId,
        jobId: usage.jobId,
        status: "recorded",
        usageStatus: usage.usageStatus,
      };
    });
    releaseToken("test-token");
    await expect(query).resolves.toMatchObject({
      usageAccounting: { status: "recorded" },
    });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("preserves the original job receipt in real cache reads without resubmission", async () => {
    const fetchMock = mockQueryJobs(
      jsonResponse({ jobComplete: true, schema: { fields: [] }, rows: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await runQuery("SELECT 1 AS cached_usage_receipt");
    const cached = await runQuery("SELECT 1 AS cached_usage_receipt");
    expect(cached).toMatchObject({
      cached: true,
      usageAccounting: {
        jobId: first.usageAccounting?.jobId,
        status: "pending",
      },
    });
    expect(persistUsage).toHaveBeenCalledTimes(1);
    expect(finalizeUsage).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("labels only server-attributed alert submissions across concurrent contexts", async () => {
    const submissions: Array<{
      jobReference: { projectId: string; jobId: string };
      configuration: {
        labels?: Record<string, string>;
        query: {
          query: string;
          maximumBytesBilled: string;
          useLegacySql: boolean;
          useQueryCache: boolean;
        };
      };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (String(input).endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body));
          submissions.push(request);
          return jsonResponse({ jobReference: request.jobReference });
        }
        return jsonResponse({
          jobComplete: true,
          schema: { fields: [] },
          rows: [],
        });
      }),
    );
    const cases: Array<{
      sql: string;
      context?: BigQueryUsageAttribution;
      labels?: Record<string, string>;
      workload: string;
    }> = [
      {
        sql: "SELECT 1 AS labelled_alert",
        context: { workload: "alert" },
        labels: { agent_native_workload: "alert" },
        workload: "alert",
      },
      {
        sql: "SELECT 1 AS dashboard_control",
        context: {
          workload: "dashboard-panel",
          dashboardId: "private-dashboard",
          panelId: "private-panel",
        },
        workload: "dashboard-panel",
      },
      {
        sql: "SELECT 1 AS concurrent_alert",
        context: { workload: "alert", dashboardId: "not-a-provider-label" },
        labels: { agent_native_workload: "alert" },
        workload: "alert",
      },
      {
        sql: "SELECT 'analytics_alert_page' AS sql_marker_control",
        workload: "unattributed",
      },
    ];
    await Promise.all(
      cases.map(({ sql, context }) => {
        const run = () =>
          runQuery(sql, { forceRefresh: true, maxBytesBilled: 123456789 });
        return context ? withBigQueryUsageAttribution(context, run) : run();
      }),
    );
    expect(submissions).toHaveLength(cases.length);
    for (const fixture of cases) {
      const request = present(
        submissions.find(
          ({ configuration }) => configuration.query.query === fixture.sql,
        ),
      );
      expect(request.configuration.labels).toEqual(fixture.labels);
      expect(request.configuration.query).toEqual({
        query: fixture.sql,
        useLegacySql: false,
        maximumBytesBilled: "123456789",
        useQueryCache: false,
      });
      expect(
        usageWrites.find(({ jobId }) => jobId === request.jobReference.jobId),
      ).toMatchObject({
        projectId: "test-project",
        ownerEmail: "test@example.com",
        workload: fixture.workload,
      });
    }
  });

  it("carries the real batch evaluator's attribution into its provider submission", async () => {
    const { evaluateBigQueryAnalyticsAlertBatch } =
      await import("./analytics-alerts");
    const now = new Date("2026-11-20T18:00:00.000Z");
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        totalRows: "1",
        schema: {
          fields: [
            { name: "count_0", type: "INTEGER" },
            { name: "samples_0", type: "STRING" },
          ],
        },
        rows: [{ f: [{ v: "0" }, { v: "[]" }] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const results = await evaluateBigQueryAnalyticsAlertBatch(
      [
        {
          id: "label-entry-point",
          name: "Synthetic alert",
          description: "",
          eventName: "synthetic_label_probe",
          filters: [],
          thresholdMode: "event_count",
          distinctBy: null,
          threshold: 1,
          windowMinutes: 10,
          cooldownMinutes: 30,
          severity: "warning",
          channels: ["inbox"],
          emailRecipients: [],
          slackWebhookUrl: null,
          webhookUrl: null,
          enabled: true,
          lastEvaluatedAt: null,
          lastTriggeredAt: null,
          lastStatus: null,
          lastError: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          ownerEmail: "test@example.com",
          orgId: null,
        },
      ],
      now,
    );
    expect(results.get("label-entry-point")).toMatchObject({
      evaluation: { observedValue: 0 },
    });
    const submissions = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/jobs"),
    );
    expect(submissions).toHaveLength(1);
    const request = JSON.parse(String(present(submissions[0])[1]?.body));
    expect(request.configuration.labels).toEqual({
      agent_native_workload: "alert",
    });
    expect(request.configuration.query.maximumBytesBilled).toBe("50000000000");
    expect(usageWrites).toHaveLength(1);
    expect(present(usageWrites[0])).toMatchObject({
      workload: "alert",
      jobId: request.jobReference.jobId,
    });
  });

  it("stops an incomplete job's poll wait immediately when the agent run aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (url.endsWith("/cancel")) return jsonResponse({});
        return jsonResponse({ jobComplete: false });
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1", { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/projects/test-project/queries/agent_native_"),
      expect.objectContaining({ signal: controller.signal }),
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/projects/test-project/jobs/agent_native_"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/cancel");
    expect(usageWrites).toHaveLength(1);
    expect(present(finalizeUsage.mock.calls[0])[0]).toMatchObject({
      submissionState: "accepted",
      outcome: null,
      bytesBilled: null,
    });
    expect(finalizeUsage).toHaveBeenCalledOnce();
  });

  it("stops waiting when the configured event table credential lookup stalls", async () => {
    let resolveTable!: (value: string | null) => void;
    let signalTableLookupStarted!: () => void;
    const tableLookupStarted = new Promise<void>((resolve) => {
      signalTableLookupStarted = resolve;
    });
    resolveCredential.mockImplementation(async (key: string) => {
      if (key === "BIGQUERY_PROJECT_ID") return "test-project";
      if (key === "ANALYTICS_BIGQUERY_EVENTS_TABLE") {
        const pending = new Promise<string | null>((resolve) => {
          resolveTable = resolve;
        });
        signalTableLookupStarted();
        return pending;
      }
      return null;
    });
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const pending = runQuery("SELECT 1 AS table_credential_deadline_test", {
      signal: controller.signal,
    });
    await tableLookupStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveTable("analytics.events_partitioned");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a delayed poll failure classified as a backend error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
          ) as { jobReference: { jobId: string; projectId: string } };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (url.includes("/queries/agent_native_")) {
          await vi.advanceTimersByTimeAsync(10_001);
          return {
            ok: false,
            status: 403,
            text: async () => JSON.stringify({ error: { message: "denied" } }),
          } as Response;
        }
        return jsonResponse({});
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT 1 AS delayed_poll_failure"),
    ).rejects.toMatchObject({
      name: "BigQueryBackendError",
      operation: "poll",
      backendStatus: 403,
    });
  });

  it("applies the caller's BigQuery billed-byte cap", async () => {
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runQuery("SELECT 1 AS bounded_query", {
      maxBytesBilled: 10_000_000_000,
    });

    const submission = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(submission.configuration.query.maximumBytesBilled).toBe(
      "10000000000",
    );
  });

  it("returns a typed error when BigQuery rejects the billed-byte cap", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            message:
              "Query exceeded limit for bytes billed: 10000000000. 12000000000 or higher required.",
          },
        }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT 1 AS billed_bytes_limit_test", {
        maxBytesBilled: 10_000_000_000,
      }),
    ).rejects.toBeInstanceOf(BigQueryMaximumBytesBilledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usageWrites).toHaveLength(1);
    expect(present(finalizeUsage.mock.calls[0])[0]).toMatchObject({
      submissionState: "rejected",
      outcome: null,
      bytesBilled: null,
    });
    expect(present(usageWrites[0]).jobId).toBe(
      present(finalizeUsage.mock.calls[0])[0].jobId,
    );
  });

  it.each([
    [400, "invalid"],
    [400, "invalidQuery"],
    [403, "accessDenied"],
    [403, "billingNotEnabled"],
  ] as const)(
    "records definite submission rejection %s/%s without job probes",
    async (status, reason) => {
      const fetchMock = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            JSON.stringify({ error: { code: status, errors: [{ reason }] } }),
            { status },
          ),
      );
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        runQuery("SELECT 1 AS definite_rejection_" + reason),
      ).rejects.toBeInstanceOf(BigQueryBackendError);
      expect(present(finalizeUsage.mock.calls[0])[0]).toMatchObject({
        submissionState: "rejected",
        bytesBilled: null,
        outcome: null,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { status: 409, reasons: ["duplicate"] },
    { status: 503, reasons: ["backendError"] },
    { status: 503, reasons: ["accessDenied"] },
    { status: 400, reasons: ["jobBackendError"] },
    { status: 400, reasons: ["jobRateLimitExceeded"] },
    { status: 429, reasons: ["rateLimitExceeded"] },
    { status: 403, reasons: ["unrecognized"] },
    { status: 400, reasons: [] },
    { status: 400, reasons: [], malformed: true },
    { status: 400, reasons: ["invalid", "jobBackendError"] },
  ])(
    "keeps HTTP $status/$reasons submission failures unknown without resubmitting the query",
    async (fixture) => {
      const { status, reasons } = fixture;
      const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/jobs"))
          return new Response(
            "malformed" in fixture
              ? "invalid provider JSON"
              : JSON.stringify({
                  error: {
                    message: "Ambiguous submission",
                    errors: reasons.map((reason) => ({ reason })),
                  },
                }),
            { status },
          );
        if (url.includes("/jobs?"))
          return jsonResponse({ kind: "bigquery#jobList", jobs: [] });
        if (url.includes("/cancel")) return jsonResponse({});
        throw new Error("Unexpected request: " + url);
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        runQuery("SELECT 1 AS ambiguous_submission_" + status),
      ).rejects.toBeInstanceOf(BigQueryBackendError);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).endsWith("/jobs"),
        ),
      ).toHaveLength(1);
      expect(usageWrites).toHaveLength(1);
      expect(finalizeUsage).toHaveBeenCalledOnce();
      expect(present(finalizeUsage.mock.calls[0])[0]).toMatchObject({
        submissionState: "unknown",
        bytesBilled: null,
        outcome: null,
      });
    },
  );

  it("keeps the submit deadline active while reading the response body", async () => {
    vi.useFakeTimers();
    let jobId = "";
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string };
          };
          jobId = request.jobReference.jobId;
          const signal = init?.signal;
          return {
            ok: true,
            status: 200,
            json: () =>
              new Promise((_resolve, reject) => {
                const abort = () => reject(signal?.reason);
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
              }),
          } as Response;
        }
        if (url.includes("/jobs?")) {
          return jsonResponse({
            kind: "bigquery#jobList",
            jobs: [{ jobReference: { jobId, location: "US" } }],
          });
        }
        return jsonResponse({});
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1 AS submit_body_timeout_test");
    const timeoutAssertion = expect(pending).rejects.toBeInstanceOf(
      BigQueryQueryTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_001);

    await timeoutAssertion;
  });

  it("preserves a submit backend error when response parsing finishes after the deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          return {
            ok: false,
            status: 403,
            text: async () => {
              await vi.advanceTimersByTimeAsync(10_001);
              return JSON.stringify({
                error: {
                  errors: [
                    {
                      reason: "accessDenied",
                      message: "Warehouse access denied",
                    },
                  ],
                },
              });
            },
          } as Response;
        }
        if (url.includes("/jobs?"))
          return jsonResponse({ kind: "bigquery#jobList", jobs: [] });
        return jsonResponse({});
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT 1 AS delayed_submit_backend_error_test"),
    ).rejects.toMatchObject({
      name: "BigQueryBackendError",
      operation: "submit",
      backendStatus: 403,
      backendReason: "access_denied",
      providerDetail: "Warehouse access denied",
    });
  });

  it("recognizes the billed-byte cap marker in a non-JSON response", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        "Query exceeded limit for bytes billed: 10000000000. 12000000000 or higher required.",
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT 1 AS billed_bytes_limit_text_test", {
        maxBytesBilled: 10_000_000_000,
      }),
    ).rejects.toBeInstanceOf(BigQueryMaximumBytesBilledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recognizes a billed-byte rejection returned by the completed query job", async () => {
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        errors: [
          {
            message:
              "Query exceeded limit for bytes billed: 10000000000. 12000000000 or higher required.",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT 1 AS completed_job_billed_limit_test", {
        maxBytesBilled: 10_000_000_000,
      }),
    ).rejects.toBeInstanceOf(BigQueryMaximumBytesBilledError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps successful rows when a completed query reports a warning", async () => {
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "value", type: "STRING" }] },
        rows: [{ f: [{ v: "kept" }] }],
        totalRows: "1",
        totalBytesProcessed: "8",
        errors: [{ reason: "other", message: "A nonfatal query warning" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runQuery("SELECT 'kept' AS value")).resolves.toMatchObject({
      rows: [{ value: "kept" }],
      totalRows: 1,
      partial: true,
      warnings: [{ reason: "other", message: "A nonfatal query warning" }],
    });
  });

  it.each([
    ["a page token", { pageToken: "page-2", totalRows: "1" }],
    ["fewer rows than its total row count", { totalRows: "2" }],
    ["no total row count", {}],
  ])(
    "marks BigQuery rows incomplete when the response has %s",
    async (_case, extra) => {
      const fetchMock = mockQueryJobs(
        jsonResponse({
          jobComplete: true,
          schema: { fields: [{ name: "value", type: "STRING" }] },
          rows: [{ f: [{ v: "first" }] }],
          totalBytesProcessed: "8",
          ...extra,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runQuery(`SELECT 'incomplete_${_case.replace(/ /g, "_")}' AS value`),
      ).resolves.toMatchObject({
        rows: [{ value: "first" }],
        truncated: true,
      });
    },
  );

  it("does not cache partial results so a retry can fetch complete rows", async () => {
    useCacheDatabase();
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "value", type: "STRING" }] },
        rows: [{ f: [{ v: "partial" }] }],
        totalRows: "2",
        totalBytesProcessed: "8",
        errors: [{ reason: "other", message: "A nonfatal query warning" }],
      }),
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "value", type: "STRING" }] },
        rows: [{ f: [{ v: "complete" }] }, { f: [{ v: "second" }] }],
        totalRows: "2",
        totalBytesProcessed: "8",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT value FROM partial_cache_retry_test";

    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ value: "partial" }],
      totalRows: 2,
      partial: true,
    });

    const retry = await runQuery(sql);
    expect(retry).toMatchObject({
      rows: [{ value: "complete" }, { value: "second" }],
      totalRows: 2,
    });
    expect(retry).not.toHaveProperty("partial");
    expect(retry).toHaveProperty("cached", false);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ value: "complete" }, { value: "second" }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps fatal completed-job details for schema recovery", async () => {
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        errors: [
          {
            reason: "invalidQuery",
            message: "Unrecognized name: private_field at [1:8]",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runQuery("SELECT private_field FROM t")).rejects.toMatchObject(
      {
        name: "BigQueryBackendError",
        operation: "job",
        backendReason: "invalid_query",
        providerDetail: "Unrecognized name: private_field at [1:8]",
      },
    );
  });

  it("returns only an allowlisted reason for backend query errors", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            errors: [
              {
                reason: "invalidQuery",
                message: "Invalid query contains private customer SQL",
              },
            ],
          },
        }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    let failure: unknown;
    try {
      await runQuery("SELECT 1 AS safe_query");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(BigQueryBackendError);
    expect(failure).toMatchObject({
      operation: "submit",
      backendStatus: 400,
      backendReason: "invalid_query",
      providerDetail: "Invalid query contains private customer SQL",
    });
    expect((failure as Error).message).not.toContain("private customer SQL");
    expect(Object.keys(failure as object)).not.toContain("providerDetail");
  });

  it("cancels a submitted job when the caller aborts before the response arrives", async () => {
    const controller = new AbortController();
    let jobId = "";
    let resolveSubmission!: (response: Response) => void;
    let signalSubmissionStarted!: () => void;
    const submissionStarted = new Promise<void>((resolve) => {
      signalSubmissionStarted = resolve;
    });
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          jobId = request.jobReference.jobId;
          signalSubmissionStarted();
          return new Promise<Response>((resolve) => {
            resolveSubmission = resolve;
          });
        }
        return jsonResponse({});
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1", { signal: controller.signal });
    await submissionStarted;
    controller.abort();
    resolveSubmission(
      jsonResponse({
        jobReference: { jobId, projectId: "test-project", location: "US" },
      }),
    );

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toHaveProperty(
      "signal",
      expect.any(AbortSignal),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(controller.signal);
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(
      true,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `https://bigquery.googleapis.com/bigquery/v2/projects/test-project/jobs/${jobId}/cancel?location=US`,
    );
  });

  it("bounds a stalled job submission and cancels a possibly accepted job", async () => {
    vi.useFakeTimers();
    const cache = useCacheDatabase();
    const cancellationTimeoutController = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => {
        if (milliseconds === 5_000) return cancellationTimeoutController.signal;
        throw new Error(`Unexpected timeout: ${milliseconds}`);
      });
    let signalSubmissionStarted!: () => void;
    const submissionStarted = new Promise<void>((resolve) => {
      signalSubmissionStarted = resolve;
    });
    let jobId = "";
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string };
          };
          jobId = request.jobReference.jobId;
          signalSubmissionStarted();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("job submission timed out");
              error.name = "AbortError";
              reject(error);
            });
          });
        }
        if (url.includes("/jobs?")) {
          return jsonResponse({
            kind: "bigquery#jobList",
            jobs: [{ jobReference: { jobId, location: "us-central1" } }],
          });
        }
        return jsonResponse({});
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1 AS stalled_job_submission_test");
    await submissionStarted;
    const timeoutAssertion = expect(pending).rejects.toBeInstanceOf(
      BigQueryQueryTimeoutError,
    );
    const submissionSignal = fetchMock.mock.calls[0]?.[1]
      ?.signal as AbortSignal;
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/jobs"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(submissionSignal.aborted).toBe(false);
    expect([...cache.values()][0]?.refreshInProgress).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(submissionSignal.aborted).toBe(true);
    await timeoutAssertion;

    const cancellationRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/cancel"),
    );
    expect(cancellationRequest?.[1]).toMatchObject({
      signal: cancellationTimeoutController.signal,
      method: "POST",
    });
    expect(String(cancellationRequest?.[0])).toMatch(
      /\/projects\/test-project\/jobs\/agent_native_[a-f0-9]+\/cancel\?location=us-central1$/,
    );
    expect([...cache.values()][0]?.refreshInProgress).toBe(false);
    expect(timeout).toHaveBeenCalledWith(5_000);
  });

  it("cancels an incomplete job after the polling limit is reached", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        return url.endsWith("/cancel")
          ? jsonResponse({})
          : jsonResponse({ jobComplete: false });
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1");
    const rejection = expect(pending).rejects.toThrow(
      "BigQuery query timed out",
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^https:\/\/bigquery\.googleapis\.com\/bigquery\/v2\/projects\/test-project\/jobs\/agent_native_[a-f0-9]+\/cancel$/,
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves the timeout error when job cancellation fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (url.endsWith("/cancel")) {
          throw new Error("cancel unavailable");
        }
        return jsonResponse({ jobComplete: false });
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 2");
    const rejection = expect(pending).rejects.toThrow(
      "BigQuery query timed out",
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^https:\/\/bigquery\.googleapis\.com\/bigquery\/v2\/projects\/test-project\/jobs\/agent_native_[a-f0-9]+\/cancel$/,
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards the signal to completed-job polling requests", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: false,
      }),
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: "42" }] }],
        totalBytesProcessed: "12",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = runQuery("SELECT 1", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toMatchObject({
      rows: [{ signups: 42 }],
      bytesProcessed: 12,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^https:\/\/bigquery\.googleapis\.com\/bigquery\/v2\/projects\/test-project\/queries\/agent_native_[a-f0-9]+$/,
      ),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("returns the dry-run result schema and byte estimate and keeps dryRunQuery a plain pass", async () => {
    const dryRunJob = {
      statistics: {
        totalBytesProcessed: "1048576",
        query: {
          schema: {
            fields: [
              { name: "week", type: "DATE", mode: "NULLABLE" },
              { name: "signups", type: "INT64" },
            ],
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async (_input, init) => {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            configuration: { dryRun: true },
          });
          return jsonResponse(dryRunJob);
        }),
    );

    await expect(dryRunQuerySchema("SELECT 1")).resolves.toEqual({
      error: null,
      schema: [
        { name: "week", type: "DATE" },
        { name: "signups", type: "INT64" },
      ],
      totalBytesProcessed: 1_048_576,
      exactBytesProcessed: 1_048_576,
    });
    await expect(dryRunQuery("SELECT 1")).resolves.toBeNull();
  });

  it("leaves the dry-run schema and byte estimate absent when the response has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({})),
    );

    const result = await dryRunQuerySchema("SELECT 1");

    expect(result).toEqual({ error: null });
  });

  it("optionally classifies credential lookup failures as dry-run preparation errors", async () => {
    const privateDetail = new Error("private credential resolution detail");
    resolveCredential.mockRejectedValueOnce(privateDetail);

    await expect(dryRunQuerySchema("SELECT 1")).rejects.toBe(privateDetail);

    resolveCredential.mockRejectedValueOnce(
      new Error("private credential detail"),
    );
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dryRunQuerySchema("SELECT 1", { wrapPreparationErrors: true }),
    ).rejects.toBeInstanceOf(BigQueryDryRunPreparationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies token setup failures before starting the dry-run request", async () => {
    const privateDetail = new Error("private token setup detail");
    getBigQueryAccessToken.mockRejectedValueOnce(privateDetail);
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    let failure: unknown;
    try {
      await dryRunQuerySchema("SELECT 1", { wrapPreparationErrors: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(BigQueryDryRunPreparationError);
    expect((failure as Error).message).not.toContain(privateDetail.message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failure).toMatchObject({ notConfigured: false });
  });

  it("marks missing credentials as not configured", async () => {
    getBigQueryAccessToken.mockRejectedValueOnce(
      new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured"),
    );
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>());

    await expect(
      dryRunQuerySchema("SELECT 1", { wrapPreparationErrors: true }),
    ).rejects.toMatchObject({ notConfigured: true });
  });

  it("forwards abort signals to token setup without wrapping aborts", async () => {
    const controller = new AbortController();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    let receivedSignal: AbortSignal | undefined;
    getBigQueryAccessToken.mockImplementationOnce(
      async (options?: { signal?: AbortSignal }) => {
        receivedSignal = options?.signal;
        throw abortError;
      },
    );

    await expect(
      dryRunQuerySchema("SELECT 1", {
        signal: controller.signal,
        wrapPreparationErrors: true,
      }),
    ).rejects.toBe(abortError);

    expect(receivedSignal).toBe(controller.signal);
  });

  it("flags a timed-out dry run as timed out rather than as invalid SQL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockImplementation((_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      }),
    );

    const pending = dryRunQuerySchema("SELECT 1");
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toMatchObject({
      error: "BigQuery validation timed out after 10 seconds",
      timedOut: true,
    });
  });

  it("bounds dry-run validation and aborts the warehouse request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = dryRunQuery("SELECT 1");
    const outcome = expect(pending).rejects.toThrow(
      "BigQuery validation timed out after 10 seconds",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await outcome;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/test-project/jobs"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns BigQuery's rejection of the SQL and throws when it reached no verdict", async () => {
    const failedResponse = (status: number, message: string) =>
      ({
        ok: false,
        status,
        text: async () => JSON.stringify({ error: { message } }),
      }) as Response;
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(failedResponse(400, "Syntax error"))
      .mockResolvedValueOnce(failedResponse(503, "Backend error"))
      .mockResolvedValueOnce(failedResponse(429, "Rate limit exceeded"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(dryRunQuery("SELECT")).resolves.toBe("Syntax error");
    await expect(dryRunQuery("SELECT 1")).rejects.toThrow("Backend error");
    await expect(dryRunQuery("SELECT 1")).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  describe("source generations", () => {
    const tableId = "example-project.dbt_mart.fact_events";
    const generationAt = (modifiedAt: string) => ({
      status: "ok" as const,
      sources: [
        {
          tableId,
          status: "ok" as const,
          generation: String(Date.parse(modifiedAt)),
          modifiedAt,
          checkedAt: "2026-10-16T12:00:00.000Z",
        },
      ],
      generation: `${tableId}@${Date.parse(modifiedAt)}`,
      oldestModifiedAt: modifiedAt,
      ageMs: 0,
      stale: false,
      checkedAt: "2026-10-16T12:00:00.000Z",
    });
    const unknownGeneration = {
      status: "unavailable" as const,
      sources: [
        {
          tableId,
          status: "unavailable" as const,
          reason: "lookup_failed" as const,
          checkedAt: "2026-10-16T12:00:00.000Z",
        },
      ],
      reason: "lookup_failed" as const,
      checkedAt: "2026-10-16T12:00:00.000Z",
    };
    const response = (count: string) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "events", type: "INT64" }] },
        rows: [{ f: [{ v: count }] }],
        totalBytesProcessed: "10",
      });
    const sql =
      "SELECT COUNT(*) AS events FROM `example-project.dbt_mart.fact_events`";

    it("keys cached rows by generation and keeps the generation they were read at", async () => {
      useCacheDatabase();
      const first = generationAt("2026-10-16T11:00:00.000Z");
      const second = generationAt("2026-10-16T12:00:00.000Z");
      const fetchMock = mockQueryJobs(response("10"), response("12"));
      vi.stubGlobal("fetch", fetchMock);

      const original = await runQuery(sql, { sourceGeneration: first });
      const repeat = await runQuery(sql, { sourceGeneration: first });
      const rebuilt = await runQuery(sql, { sourceGeneration: second });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(original.sourceGeneration).toEqual(first);
      expect(repeat).toMatchObject({
        cached: true,
        rows: [{ events: 10 }],
        sourceGeneration: first,
        fetchedAt: original.fetchedAt,
      });
      expect(rebuilt).toMatchObject({
        rows: [{ events: 12 }],
        sourceGeneration: second,
      });
      expect(rebuilt.cached).not.toBe(true);
    });

    it("reuses a result read at an unknown generation for one hour only", async () => {
      useCacheDatabase();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
      const fetchMock = mockQueryJobs(response("10"), response("11"));
      vi.stubGlobal("fetch", fetchMock);

      await runQuery(sql, { sourceGeneration: unknownGeneration });
      vi.setSystemTime(new Date("2026-10-16T12:59:00Z"));
      const withinHour = await runQuery(sql, {
        sourceGeneration: unknownGeneration,
      });
      vi.setSystemTime(new Date("2026-10-16T13:01:00Z"));
      const afterHour = await runQuery(sql, {
        sourceGeneration: unknownGeneration,
      });

      expect(withinHour).toMatchObject({
        cached: true,
        rows: [{ events: 10 }],
      });
      expect(afterHour).toMatchObject({
        rows: [{ events: 11 }],
        sourceGeneration: unknownGeneration,
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  it("refreshes cached current-date queries at UTC midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runQuery("SELECT CURRENT_DATE() AS day");
    vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
    await runQuery("SELECT CURRENT_DATE() AS day");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const submitted = (call: number) =>
      JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)).configuration
        .query.query;
    expect(submitted(0)).toBe("SELECT DATE '2026-09-08' AS day");
    expect(submitted(2)).toBe("SELECT DATE '2026-09-09' AS day");
  });

  it("serves a repeated current-date query from the app cache within the day", async () => {
    useCacheDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runQuery("SELECT CURRENT_DATE() AS day");
    vi.setSystemTime(new Date("2026-09-08T18:00:00Z"));
    const second = await runQuery("SELECT CURRENT_DATE() AS day");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.cached).toBe(true);
  });

  it.each([
    [
      "CONCAT('U', 'TC')",
      "2026-09-08T23:59:00Z",
      "2026-09-09T00:01:00Z",
      "2026-09-08",
      "2026-09-09",
    ],
    [
      "CONCAT('America/', 'Los_Angeles')",
      "2026-10-17T06:59:00Z",
      "2026-10-17T07:01:00Z",
      "2026-10-16",
      "2026-10-17",
    ],
  ])(
    "does not reuse an unresolved current-date query across midnight in %s",
    async (zone, before, after, firstDay, secondDay) => {
      const cache = useCacheDatabase();
      vi.useFakeTimers();
      vi.setSystemTime(new Date(before));
      const response = (day: string) =>
        jsonResponse({
          jobComplete: true,
          schema: { fields: [{ name: "day", type: "DATE" }] },
          rows: [{ f: [{ v: day }] }],
          totalBytesProcessed: "0",
        });
      const fetchMock = mockQueryJobs(response(firstDay), response(secondDay));
      vi.stubGlobal("fetch", fetchMock);
      const sql = `SELECT CURRENT_DATE(${zone}) AS day`;

      await expect(runQuery(sql)).resolves.toMatchObject({
        rows: [{ day: firstDay }],
        cached: false,
      });
      vi.setSystemTime(new Date(after));
      await expect(runQuery(sql)).resolves.toMatchObject({
        rows: [{ day: secondDay }],
        cached: false,
      });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const call of [0, 2]) {
        expect(
          JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body))
            .configuration.query.query,
        ).toBe(sql);
      }
      expect(execute).not.toHaveBeenCalled();
      expect(cache.size).toBe(0);
    },
  );

  it("caches current-date text in strings, comments and qualified identifiers", async () => {
    useCacheDatabase();
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql =
      "SELECT 'CURRENT_DATE(zone)' AS label, t.current_date FROM t -- CURRENT_DATE(zone)";

    await runQuery(sql);
    await expect(runQuery(sql)).resolves.toMatchObject({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "falls back to provider date evaluation when credentials cross midnight (forceRefresh=%s)",
    async (forceRefresh) => {
      const cache = useCacheDatabase();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
      getBigQueryAccessToken.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
        return "test-access-token";
      });
      const fetchMock = mockQueryJobs(
        jsonResponse({
          jobComplete: true,
          schema: { fields: [{ name: "day", type: "DATE" }] },
          rows: [{ f: [{ v: "2026-09-09" }] }],
          totalBytesProcessed: "0",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const sql = "SELECT CURRENT_DATE() AS day";

      await expect(runQuery(sql, { forceRefresh })).resolves.toMatchObject({
        rows: [{ day: "2026-09-09" }],
        cached: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const query = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
        .configuration.query;
      expect(query.query).toBe(sql);
      expect(getBigQueryAccessToken).toHaveBeenCalledTimes(2);
      if (forceRefresh) expect(query.useQueryCache).toBe(false);
      for (const entry of cache.values()) {
        expect(entry.refreshInProgress).toBe(false);
        expect(entry.result).toBe("{}");
      }
    },
  );

  it("does not retry an aborted query when credentials cross midnight", async () => {
    const cache = useCacheDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
    const controller = new AbortController();
    const reason = new Error("Caller stopped the query");
    getBigQueryAccessToken.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
      controller.abort(reason);
      return "test-access-token";
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT CURRENT_DATE() AS day", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getBigQueryAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const entry of cache.values())
      expect(entry.refreshInProgress).toBe(false);
  });

  it.each(["L1", "L2"])(
    "does not return a previous-day %s hit when cache coordination crosses midnight",
    async (level) => {
      const cache = useCacheDatabase();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
      const response = (day: string) =>
        jsonResponse({
          jobComplete: true,
          schema: { fields: [{ name: "day", type: "DATE" }] },
          rows: [{ f: [{ v: day }] }],
          totalBytesProcessed: "0",
        });
      const fetchMock = mockQueryJobs(
        response("2026-09-08"),
        response("2026-09-09"),
      );
      vi.stubGlobal("fetch", fetchMock);
      const sql = "SELECT CURRENT_DATE() AS day";
      await runQuery(sql);
      if (level === "L2")
        for (const entry of cache.values()) entry.generation++;
      const originalExecute = execute.getMockImplementation()!;
      execute.mockClear();
      execute.mockImplementation(async (input) => {
        const result = await originalExecute(input);
        if (
          input.sql.startsWith(
            level === "L1" ? "SELECT generation, fence_token" : "SELECT result",
          )
        ) {
          vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
        }
        return result;
      });

      await expect(runQuery(sql)).resolves.toMatchObject({
        rows: [{ day: "2026-09-09" }],
        cached: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(
        JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).configuration
          .query.query,
      ).toBe(sql);
      expect(
        execute.mock.calls.every(([input]) => input.sql.startsWith("SELECT")),
      ).toBe(true);
      for (const entry of cache.values())
        expect(JSON.parse(entry.result).rows).toEqual([{ day: "2026-09-08" }]);
    },
  );

  it.each([
    [
      "SELECT CURRENT_DATE() AS current_date",
      "SELECT DATE '2026-09-08' AS current_date",
    ],
    [
      "WITH current_date AS (SELECT CURRENT_DATE() AS day) SELECT day FROM current_date",
      "WITH current_date AS (SELECT DATE '2026-09-08' AS day) SELECT day FROM current_date",
    ],
  ])(
    "reuses the same-day app cache for identifiers in %s",
    async (sql, submittedSql) => {
      useCacheDatabase();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
      const fetchMock = mockQueryJobs(
        jsonResponse({
          jobComplete: true,
          schema: { fields: [] },
          rows: [],
          totalBytesProcessed: "0",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await runQuery(sql);
      vi.setSystemTime(new Date("2026-09-08T18:00:00Z"));
      await expect(runQuery(sql)).resolves.toMatchObject({ cached: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).configuration
          .query.query,
      ).toBe(submittedSql);
    },
  );

  it("reuses bare CURRENT_DATE within a UTC day and refreshes its app cache at midnight", async () => {
    const cache = useCacheDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T23:58:00Z"));
    const response = (day: string) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "day", type: "DATE" }] },
        rows: [{ f: [{ v: day }] }],
        totalBytesProcessed: "0",
      });
    const fetchMock = mockQueryJobs(
      response("2026-09-08"),
      response("2026-09-09"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT CURRENT_DATE AS day";

    await runQuery(sql);
    vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ day: "2026-09-08" }],
      cached: true,
    });
    vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ day: "2026-09-09" }],
      cached: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of [0, 2])
      expect(
        JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)).configuration
          .query.query,
      ).toBe(sql);
    expect(cache.size).toBe(2);
  });

  it("bypasses the app cache after a delayed bare-date UTC rollover", async () => {
    const cache = useCacheDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
    getBigQueryAccessToken.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
      return "test-access-token";
    });
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT CURRENT_DATE AS day";

    await expect(runQuery(sql)).resolves.toMatchObject({ cached: false });
    expect(getBigQueryAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).configuration.query
        .query,
    ).toBe(sql);
    for (const entry of cache.values()) {
      expect(entry.refreshInProgress).toBe(false);
      expect(entry.result).toBe("{}");
    }
  });

  describe("renderCurrentDateLiterals", () => {
    const now = new Date("2026-10-17T02:30:00Z");

    it("renders explicit current-date calls and preserves bare names", () => {
      expect(
        renderCurrentDateLiterals(
          "SELECT * FROM t WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND event_date <= current_date",
          now,
        ),
      ).toBe(
        "SELECT * FROM t WHERE event_date >= DATE_SUB(DATE '2026-10-17', INTERVAL 7 DAY) AND event_date <= current_date",
      );
    });

    it.each([
      [
        "SELECT CURRENT_DATE() AS current_date",
        "SELECT DATE '2026-10-17' AS current_date",
      ],
      [
        "WITH current_date AS (SELECT CURRENT_DATE() AS day) SELECT day FROM current_date",
        "WITH current_date AS (SELECT DATE '2026-10-17' AS day) SELECT day FROM current_date",
      ],
    ])("preserves aliases and CTE names in %s", (sql, expected) => {
      expect(renderCurrentDateLiterals(sql, now)).toBe(expected);
    });

    it("evaluates a literal time zone argument", () => {
      expect(
        renderCurrentDateLiterals(
          "SELECT CURRENT_DATE('America/Los_Angeles') AS pt, CURRENT_DATE(\"UTC\") AS utc",
          now,
        ),
      ).toBe("SELECT DATE '2026-10-16' AS pt, DATE '2026-10-17' AS utc");
    });

    it("leaves strings, comments, qualified columns and dynamic zones alone", () => {
      const sql = [
        "SELECT 'CURRENT_DATE()' AS label, t.current_date,",
        "CURRENT_DATE(zone_column), CURRENT_DATE('Not/AZone')",
        "-- CURRENT_DATE()",
        "FROM t",
      ].join("\n");
      expect(renderCurrentDateLiterals(sql, now)).toBe(sql);
    });
  });

  it("bypasses result caches on forced refresh and replaces the cached result", async () => {
    useCacheDatabase();
    const response = (signups: string) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: signups }] }],
        totalBytesProcessed: "12",
      });
    const fetchMock = mockQueryJobs(response("3918"), response("4200"));
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS manual_dashboard_refresh_test";

    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 3918 }],
    });
    await expect(runQuery(sql, { forceRefresh: true })).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
    });
    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
      cached: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).configuration
        .query,
    ).not.toHaveProperty("useQueryCache");
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).configuration
        .query,
    ).toHaveProperty("useQueryCache", false);
    const fenceRead = execute.mock.calls.find(([input]) =>
      input.sql.startsWith("SELECT generation, fence_token"),
    );
    expect(fenceRead?.[0].args[0]).toMatch(/^v3:/);
  });

  it("reports when the app received the result and whether the provider cache answered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const completed = (cacheHit?: boolean) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: "7" }] }],
        totalBytesProcessed: "4096",
        ...(cacheHit === undefined ? {} : { cacheHit }),
      });
    const fetchMock = mockQueryJobs(
      completed(true),
      completed(false),
      completed(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hit = await runQuery("SELECT 1 AS provider_cache_hit");
    vi.setSystemTime(new Date("2026-10-14T12:05:00Z"));
    const miss = await runQuery("SELECT 2 AS provider_cache_miss");
    vi.setSystemTime(new Date("2026-10-14T12:10:00Z"));
    const unreported = await runQuery("SELECT 3 AS provider_cache_unreported");

    expect(hit).toMatchObject({
      bytesProcessed: 4096,
      fetchedAt: "2026-10-14T12:00:00.000Z",
      providerCacheHit: true,
    });
    expect(miss).toMatchObject({
      bytesProcessed: 4096,
      fetchedAt: "2026-10-14T12:05:00.000Z",
      providerCacheHit: false,
    });
    expect(unreported.fetchedAt).toBe("2026-10-14T12:10:00.000Z");
    expect(unreported).not.toHaveProperty("providerCacheHit");
    // Every one of these reached BigQuery, so none was served by the app cache.
    for (const fresh of [hit, miss, unreported]) {
      expect(fresh).toMatchObject({ cached: false });
    }
    // Metadata comes from the existing getQueryResults response: one submit and
    // one poll per query, with an unchanged job configuration.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).configuration
        .query,
    ).toEqual({
      query: "SELECT 1 AS provider_cache_hit",
      useLegacySql: false,
      maximumBytesBilled: "750000000000",
    });
  });

  it.each([
    { name: "omitted", raw: undefined, expected: undefined },
    { name: "null", raw: null, expected: undefined },
    { name: "empty", raw: "", expected: undefined },
    { name: "malformed", raw: "12bytes", expected: undefined },
    { name: "negative", raw: "-1", expected: undefined },
    { name: "fractional", raw: "1.5", expected: undefined },
    { name: "unsafe", raw: "9007199254740992", expected: undefined },
    { name: "zero", raw: "0", expected: 0 },
    { name: "actual", raw: "4096", expected: 4096 },
  ])(
    "preserves $name processed-byte metadata through both cache layers",
    async ({ name, raw, expected }) => {
      const cache = useCacheDatabase();
      const fetchMock = mockQueryJobs(
        jsonResponse({
          jobComplete: true,
          schema: { fields: [] },
          rows: [],
          totalBytesProcessed: raw,
          cacheHit: false,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const sql = `SELECT 1 AS byte_metadata_${name}`;

      const fresh = await runQuery(sql, { forceRefresh: true });
      const l1 = await runQuery(sql);
      for (const entry of cache.values()) entry.generation++;
      const l2 = await runQuery(sql);

      expect(fresh.cached).toBe(false);
      for (const result of [fresh, l1, l2]) {
        expect(result.bytesProcessed).toBe(expected);
        expect(result.providerCacheHit).toBe(false);
      }
      expect(l1.cached).toBe(true);
      expect(l2.cached).toBe(true);
      const write = execute.mock.calls.find(([query]) =>
        query.sql.startsWith("UPDATE bigquery_cache SET sql"),
      );
      expect(write?.[0].args[3]).toBe(expected ?? -1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the original fetch time and provider cache state on app cache hits", async () => {
    const cache = useCacheDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: "7" }] }],
        totalBytesProcessed: "4096",
        cacheHit: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS app_cache_metadata";

    await runQuery(sql);
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const l1Hit = await runQuery(sql);
    // A newer generation drops the in-process copy, so the next read comes
    // from the shared database row.
    for (const entry of cache.values()) entry.generation++;
    const l2Hit = await runQuery(sql);

    for (const hit of [l1Hit, l2Hit]) {
      expect(hit).toMatchObject({
        cached: true,
        fetchedAt: "2026-10-14T12:00:00.000Z",
        providerCacheHit: true,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("flags a fresh scan as an app-cache miss without persisting the flag", async () => {
    const cache = useCacheDatabase();
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "4096",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS app_cache_miss_flag";

    const miss = await runQuery(sql);
    const hit = await runQuery(sql);

    expect(miss).toMatchObject({ cached: false, bytesProcessed: 4096 });
    expect(hit).toMatchObject({ cached: true, bytesProcessed: 4096 });
    for (const entry of cache.values()) {
      expect(JSON.parse(entry.result)).not.toHaveProperty("cached");
    }
    // The second read was served by the app cache, not a second BigQuery job.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks claimJob only on a cache miss and starts no job when it declines", async () => {
    const cache = useCacheDatabase();
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "4096",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const declined = vi.fn(async () => false);
    const granted = vi.fn(async () => true);

    await expect(
      runQuery("SELECT 1 AS declined_job_claim", { claimJob: declined }),
    ).rejects.toBeInstanceOf(BigQueryJobNotClaimedError);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const entry of cache.values()) {
      expect(entry.refreshInProgress).toBe(false);
    }

    const sql = "SELECT 1 AS granted_job_claim";
    await runQuery(sql, { claimJob: granted });
    const hit = await runQuery(sql, { claimJob: granted });

    expect(hit).toMatchObject({ cached: true });
    expect(declined).toHaveBeenCalledTimes(1);
    expect(granted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tells onUncachedResult only about fresh results the cache did not keep", async () => {
    useCacheDatabase();
    const cacheDatabase = execute.getMockImplementation();
    const complete = () =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalRows: "0",
        totalBytesProcessed: "4096",
      });
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalRows: "0",
        totalBytesProcessed: "4096",
        errors: [{ reason: "other", message: "A nonfatal query warning" }],
      }),
      complete(),
      complete(),
    );
    vi.stubGlobal("fetch", fetchMock);
    const uncached = vi.fn();

    await runQuery("SELECT 1 AS warned_result", { onUncachedResult: uncached });
    expect(uncached).toHaveBeenCalledTimes(1);

    const kept = "SELECT 1 AS kept_result";
    await runQuery(kept, { onUncachedResult: uncached });
    await expect(
      runQuery(kept, { onUncachedResult: uncached }),
    ).resolves.toMatchObject({ cached: true });
    expect(uncached).toHaveBeenCalledTimes(1);

    execute.mockImplementation(async (query) =>
      String(query.sql).startsWith("UPDATE bigquery_cache SET sql")
        ? { rows: [] }
        : cacheDatabase?.(query),
    );
    await runQuery("SELECT 1 AS unsaved_result", {
      onUncachedResult: uncached,
    });
    expect(uncached).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("falls back to the cache row's created_at for results cached before fetchedAt existed", async () => {
    const cache = useCacheDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "4096",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS legacy_cache_row";
    await runQuery(sql);

    for (const entry of cache.values()) {
      const { fetchedAt: _written, ...legacy } = JSON.parse(entry.result);
      entry.result = JSON.stringify(legacy);
      entry.createdAt = "2026-10-13T08:30:00.000Z";
      entry.generation++;
    }
    vi.setSystemTime(new Date("2026-10-14T18:00:00Z"));

    await expect(runQuery(sql)).resolves.toMatchObject({
      cached: true,
      bytesProcessed: 4096,
      fetchedAt: "2026-10-13T08:30:00.000Z",
    });

    for (const entry of cache.values()) {
      entry.createdAt = "not a timestamp";
      entry.generation++;
    }
    const unreadable = await runQuery(sql);
    expect(unreadable).toMatchObject({ cached: true });
    expect(unreadable).not.toHaveProperty("fetchedAt");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stamps a forced refresh with its own fetch time while still bypassing the provider cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const response = (cacheHit: boolean) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "4096",
        cacheHit,
      });
    const fetchMock = mockQueryJobs(response(true), response(false));
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS forced_refresh_metadata";

    await runQuery(sql);
    vi.setSystemTime(new Date("2026-10-14T12:30:00Z"));
    const refreshed = await runQuery(sql, { forceRefresh: true });
    const cachedAfter = await runQuery(sql);

    expect(refreshed).toMatchObject({
      fetchedAt: "2026-10-14T12:30:00.000Z",
      providerCacheHit: false,
    });
    expect(refreshed).toMatchObject({ cached: false });
    expect(cachedAfter).toMatchObject({
      cached: true,
      fetchedAt: "2026-10-14T12:30:00.000Z",
      providerCacheHit: false,
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).configuration
        .query,
    ).toHaveProperty("useQueryCache", false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("runs the query without caching when cache coordination is unavailable", async () => {
    const originalExecute = execute.getMockImplementation();
    if (!originalExecute)
      throw new Error("Cache database mock is not configured");
    execute.mockImplementation(
      async (input: { sql: string; args: unknown[] }) => {
        if (input.sql.startsWith("SELECT generation, fence_token")) {
          throw new Error("cache database unavailable");
        }
        return originalExecute(input);
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runQuery("SELECT 1 AS cache_unavailable_test");
    expect(result).toMatchObject({
      rows: [],
      totalRows: 0,
    });
    expect(result).toMatchObject({ cached: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[bigquery] Cache coordination failed; running query without cache:",
      expect.any(Error),
    );
  });

  it("bounds job cancellation so a stalled request releases its cache fence", async () => {
    const cache = useCacheDatabase();
    const submissionTimeoutController = new AbortController();
    const cancellationTimeoutController = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => {
        if (milliseconds === 10_000) return submissionTimeoutController.signal;
        if (milliseconds === 5_000) return cancellationTimeoutController.signal;
        throw new Error(`Unexpected timeout: ${milliseconds}`);
      });
    let signalCancellationStarted!: () => void;
    const cancellationStarted = new Promise<void>((resolve) => {
      signalCancellationStarted = resolve;
    });
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (url.endsWith("/cancel")) {
          signalCancellationStarted();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("cancel request timed out");
              error.name = "AbortError";
              reject(error);
            });
          });
        }
        return {
          ok: false,
          status: 503,
          text: async () => "BigQuery poll unavailable",
        } as Response;
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1 AS cache_cancel_timeout_test");
    await cancellationStarted;
    expect([...cache.values()][0]?.refreshInProgress).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/cancel"),
      expect.objectContaining({
        signal: cancellationTimeoutController.signal,
        method: "POST",
      }),
    );

    cancellationTimeoutController.abort();
    await expect(pending).rejects.toMatchObject({
      name: "BigQueryBackendError",
      operation: "poll",
      backendStatus: 503,
      backendReason: "other",
    });
    expect([...cache.values()][0]?.refreshInProgress).toBe(false);
    expect(timeout).toHaveBeenCalledWith(5_000);
  });

  it("rechecks the fence when a forced refresh wins during an ordinary cache miss", async () => {
    useCacheDatabase();
    const read = pauseNextL2Read();
    const response = jsonResponse({
      jobComplete: true,
      schema: { fields: [{ name: "signups", type: "INT64" }] },
      rows: [{ f: [{ v: "4200" }] }],
      totalBytesProcessed: "12",
    });
    const fetchMock = mockQueryJobs(response);
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS refresh_wins_cache_miss_race_test";

    const ordinary = runQuery(sql);
    await read.started;
    await expect(runQuery(sql, { forceRefresh: true })).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
    });
    read.release();

    await expect(ordinary).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prevents an older query from overwriting a forced refresh", async () => {
    vi.useFakeTimers();
    useCacheDatabase();
    const response = (signups: string) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: signups }] }],
        totalBytesProcessed: "12",
      });
    let resolveOlder!: (response: Response) => void;
    let signalOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => {
      signalOlderStarted = resolve;
    });
    let insertedJobs = 0;
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          insertedJobs++;
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (insertedJobs === 1) {
          signalOlderStarted();
          return new Promise<Response>((resolve) => {
            resolveOlder = resolve;
          });
        }
        return response("4200");
      });
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS concurrent_dashboard_refresh_test";

    const olderQuery = runQuery(sql);
    await olderStarted;
    const forcedQuery = runQuery(sql, { forceRefresh: true });
    await vi.advanceTimersByTimeAsync(0);
    resolveOlder(response("3918"));
    await expect(olderQuery).resolves.toMatchObject({
      rows: [{ signups: 3918 }],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(forcedQuery).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
    });

    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not reuse a deleted row's generation fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
    const cache = useCacheDatabase();
    const response = (signups: string) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: signups }] }],
        totalBytesProcessed: "12",
      });
    let resolveOlder!: (response: Response) => void;
    let signalOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => {
      signalOlderStarted = resolve;
    });
    let insertedJobs = 0;
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          insertedJobs++;
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (insertedJobs === 1) return response("3918");
        if (insertedJobs === 2) {
          signalOlderStarted();
          return new Promise<Response>((resolve) => {
            resolveOlder = resolve;
          });
        }
        return response("4200");
      });
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS cache_cleanup_fence_test";

    await runQuery(sql);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    const olderQuery = runQuery(sql);
    await olderStarted;
    cache.clear();

    await expect(runQuery(sql, { forceRefresh: true })).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
    });
    resolveOlder(response("3918"));
    await olderQuery;

    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("reclaims stale refresh rows while preserving active cache fences", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    const cache = useCacheDatabase();
    const now = Date.now();
    const expiredAt = new Date(now - 1_000).toISOString();
    cache.set("stale-refresh", {
      result: "{}",
      generation: 1,
      fenceToken: "stale-token",
      refreshInProgress: true,
      refreshForced: true,
      refreshStartedAt: new Date(now - 6 * 60 * 1000).toISOString(),
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(now).toISOString(),
    });
    cache.set("active-refresh", {
      result: "{}",
      generation: 1,
      fenceToken: "active-token",
      refreshInProgress: true,
      refreshForced: false,
      refreshStartedAt: new Date(now - 60 * 1000).toISOString(),
      expiresAt: expiredAt,
      createdAt: new Date(now).toISOString(),
    });
    cache.set("expired-result", {
      result: "{}",
      generation: 1,
      fenceToken: null,
      refreshInProgress: false,
      refreshForced: false,
      refreshStartedAt: null,
      expiresAt: expiredAt,
      createdAt: new Date(now).toISOString(),
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        schema: [],
        rows: [],
        totalBytesProcessed: "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runQuery("SELECT 1 AS stale_cache_cleanup_test");

    expect(cache.has("stale-refresh")).toBe(false);
    expect(cache.has("expired-result")).toBe(false);
    expect(cache.has("active-refresh")).toBe(true);
  });

  it("keeps the prior cached result usable when a forced refresh fails", async () => {
    useCacheDatabase();
    const response = jsonResponse({
      jobComplete: true,
      schema: { fields: [{ name: "signups", type: "INT64" }] },
      rows: [{ f: [{ v: "3918" }] }],
      totalBytesProcessed: "12",
    });
    let insertedJobs = 0;
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          insertedJobs++;
          if (insertedJobs === 2) throw new Error("warehouse unavailable");
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (url.endsWith("/cancel")) return jsonResponse({});
        return response;
      });
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS failed_refresh_keeps_cache_test";

    await runQuery(sql);
    await expect(runQuery(sql, { forceRefresh: true })).rejects.toThrow(
      "warehouse unavailable",
    );
    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 3918 }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/jobs?")),
    ).toBe(true);
  });

  it("serves the last cached result to ordinary reads during a forced refresh", async () => {
    useCacheDatabase();
    const response = (signups: string) =>
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "signups", type: "INT64" }] },
        rows: [{ f: [{ v: signups }] }],
        totalBytesProcessed: "12",
      });
    let resolveRefresh!: (response: Response) => void;
    let signalRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      signalRefreshStarted = resolve;
    });
    let insertedJobs = 0;
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          insertedJobs++;
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        if (insertedJobs === 1) return response("3918");
        signalRefreshStarted();
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      });
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS concurrent_refresh_stale_read_test";

    await runQuery(sql);
    const refreshing = runQuery(sql, { forceRefresh: true });
    await refreshStarted;
    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 3918 }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    resolveRefresh(response("4200"));
    await refreshing;
    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("coalesces concurrent forced refreshes into one BigQuery job", async () => {
    vi.useFakeTimers();
    useCacheDatabase();
    const response = jsonResponse({
      jobComplete: true,
      schema: { fields: [{ name: "signups", type: "INT64" }] },
      rows: [{ f: [{ v: "4200" }] }],
      totalBytesProcessed: "12",
    });
    let resolveRefresh!: (response: Response) => void;
    let signalRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      signalRefreshStarted = resolve;
    });
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/jobs")) {
          const request = JSON.parse(String(init?.body)) as {
            jobReference: { jobId: string; projectId: string };
          };
          return jsonResponse({ jobReference: request.jobReference });
        }
        signalRefreshStarted();
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      });
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS concurrent_forced_refresh_coalesce_test";

    const first = runQuery(sql, { forceRefresh: true });
    await refreshStarted;
    const second = runQuery(sql, { forceRefresh: true });
    await vi.advanceTimersByTimeAsync(0);
    resolveRefresh(response);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { rows: [{ signups: 4200 }] },
      { rows: [{ signups: 4200 }] },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects mutating SQL before resolving credentials or contacting BigQuery", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("WITH rows AS (SELECT 1) DELETE FROM target"),
    ).rejects.toThrow("Source SQL must be read-only.");

    expect(resolveCredential).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isolates default and org credential scopes while sharing org results", async () => {
    useCacheDatabase();
    const queryResult = jsonResponse({
      jobComplete: true,
      schema: { fields: [] },
      rows: [],
      totalBytesProcessed: "0",
    });
    const fetchMock = mockQueryJobs(
      queryResult,
      queryResult,
      queryResult,
      queryResult,
    );
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 9743 AS credential_scope_cache_test";

    await runQuery(sql);
    getCredentialContext.mockReturnValue({
      userEmail: "other@example.com",
      orgId: "customer-org",
    });
    await runQuery(sql);
    getCredentialContext.mockReturnValue({
      userEmail: "scope-switch@example.com",
      orgId: "customer-org",
    });
    await runQuery(sql);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    getCredentialContext.mockReturnValue({
      userEmail: "scope-switch@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });
    await runQuery(sql);
    expect(fetchMock).toHaveBeenCalledTimes(8);

    getCredentialContext.mockReturnValue({
      userEmail: "admin-a@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });
    await runQuery(sql);
    getCredentialContext.mockReturnValue({
      userEmail: "admin-b@example.com",
      orgId: "customer-org",
      credentialScope: "org",
    });
    await runQuery(sql);

    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("records one job across polling and no new job on an app cache read", async () => {
    persistUsage.mockClear();
    finalizeUsage.mockClear();
    useCacheDatabase();
    const fetchMock = mockQueryJobs(
      jsonResponse({ jobComplete: false }),
      jsonResponse({
        jobComplete: true,
        totalRows: "0",
        totalBytesProcessed: "123",
        cacheHit: false,
        schema: { fields: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await runQuery("SELECT 987654 AS ledger_cache_test");
    const records = usageWrites;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      projectId: "test-project",
      submissionState: "attempted",
      usageStatus: "pending",
    });
    expect(persistUsage.mock.invocationCallOrder[0]).toBeLessThan(
      present(fetchMock.mock.invocationCallOrder[0]),
    );
    expect(present(records[0]).jobId).toBe(
      present(finalizeUsage.mock.calls[0])[0].jobId,
    );
    expect(present(finalizeUsage.mock.calls[0])[0]).toMatchObject({
      bytesProcessed: "123",
      providerCacheHit: false,
      ownerEmail: expect.any(String),
    });
    expect(records[0]).not.toHaveProperty("query");
    persistUsage.mockClear();
    finalizeUsage.mockClear();
    expect((await runQuery("SELECT 987654 AS ledger_cache_test")).cached).toBe(
      true,
    );
    expect(persistUsage).not.toHaveBeenCalled();
    expect(finalizeUsage).not.toHaveBeenCalled();
  });
  it("returns unavailable accounting without retrying a successful warehouse query", async () => {
    persistUsage.mockResolvedValueOnce(false);
    const fetchMock = mockQueryJobs(
      jsonResponse({
        jobComplete: true,
        totalRows: "1",
        schema: { fields: [{ name: "value", type: "INT64" }] },
        rows: [{ f: [{ v: "1" }] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await runQuery("SELECT 876543 AS accounting_failure_test");
    expect(result.rows).toEqual([{ value: 1 }]);
    expect(result.usageAccounting).toMatchObject({
      status: "unavailable",
      projectId: "test-project",
      jobId: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(finalizeUsage).toHaveBeenCalledWith(
      expect.any(Object),
      "test-access-token",
      false,
      undefined,
    );
  });

  describe("resumable jobs", () => {
    const sql = "SELECT 7 AS resumable_job_test";
    const submissions = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls
        .filter(
          ([input, init]) =>
            String(input).endsWith("/jobs") &&
            (init as RequestInit | undefined)?.method === "POST",
        )
        .map(
          ([, init]) =>
            JSON.parse(String((init as RequestInit).body)).jobReference
              .jobId as string,
        );
    const cancellations = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/cancel"),
      );
    const jobTimeouts = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls
        .filter(
          ([input, init]) =>
            String(input).endsWith("/jobs") &&
            (init as RequestInit | undefined)?.method === "POST",
        )
        .map(
          ([, init]) =>
            JSON.parse(String((init as RequestInit).body)).configuration
              .jobTimeoutMs as string | undefined,
        );
    const failedJob = {
      status: { state: "DONE", errorResult: { reason: "stopped" } },
    };

    /** Remembers created jobs and refuses a repeated job ID, as BigQuery does. */
    function fakeBigQuery(
      options: {
        complete?: () => boolean;
        /** Overrides fields of a jobs.get answer, or answers with a status. */
        lookup?: (job: { jobId: string; query: string }) => object | number;
      } = {},
    ) {
      const jobs = new Map<string, { query: string; createdAt: number }>();
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/jobs") && init?.method === "POST") {
            const request = JSON.parse(String(init.body)) as {
              jobReference: { jobId: string; projectId: string };
              configuration: { query: { query: string } };
            };
            const { jobId } = request.jobReference;
            if (jobs.has(jobId)) {
              const message = `Already Exists: Job test-project:US.${jobId}`;
              const body = JSON.stringify({
                error: {
                  code: 409,
                  message,
                  errors: [{ reason: "duplicate", message }],
                },
              });
              return {
                ok: false,
                status: 409,
                text: async () => body,
              } as Response;
            }
            jobs.set(jobId, {
              query: request.configuration.query.query,
              createdAt: Date.now(),
            });
            return jsonResponse({
              jobReference: { ...request.jobReference, location: "US" },
            });
          }
          if (url.includes("/cancel")) return jsonResponse({});
          const lookup = /\/jobs\/([^/?]+)\?/.exec(url);
          if (lookup?.[1]) {
            const jobId = lookup[1];
            const job = jobs.get(jobId);
            const answer = options.lookup?.({ jobId, query: job?.query ?? "" });
            if (typeof answer === "number") {
              const body = JSON.stringify({
                error: { code: answer, errors: [{ reason: "backendError" }] },
              });
              return {
                ok: false,
                status: answer,
                text: async () => body,
              } as Response;
            }
            return jsonResponse({
              jobReference: {
                projectId: "test-project",
                jobId,
                location: "US",
              },
              configuration: { query: { query: job?.query ?? "" } },
              status: { state: "RUNNING" },
              statistics: { creationTime: String(job?.createdAt ?? 0) },
              ...answer,
            });
          }
          return (options.complete?.() ?? true)
            ? jsonResponse({
                jobComplete: true,
                totalRows: "1",
                schema: { fields: [{ name: "value", type: "INT64" }] },
                rows: [{ f: [{ v: "7" }] }],
              })
            : jsonResponse({ jobComplete: false });
        });
      return { fetchMock, jobs };
    }

    /** Lets the query reach its first poll wait, then stops it. */
    async function stopWhilePolling(
      stop: AbortController,
      pending: Promise<unknown>,
    ) {
      const rejection = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      stop.abort();
      await rejection;
      await vi.advanceTimersByTimeAsync(0);
    }

    /** One call its deadline stops while the job runs. */
    async function callUntilDeadline(
      trace?: ReturnType<typeof newBigQueryQueryTrace>,
    ) {
      const deadline = new AbortController();
      await stopWhilePolling(
        deadline,
        runQuery(sql, {
          signal: deadline.signal,
          resumeAfter: deadline.signal,
          ...(trace ? { trace } : {}),
        }),
      );
    }

    it("leaves a job its deadline stopped running, and the same query's next call collects it", async () => {
      vi.useFakeTimers();
      let complete = false;
      const { fetchMock, jobs } = fakeBigQuery({ complete: () => complete });
      vi.stubGlobal("fetch", fetchMock);

      await callUntilDeadline();

      expect(cancellations(fetchMock)).toHaveLength(0);
      const [jobId] = submissions(fetchMock);
      expect(jobId).toMatch(/^agent_native_r_[a-f0-9]{64}$/);
      // BigQuery stops it once it is too old to collect.
      expect(jobTimeouts(fetchMock)).toEqual(["3600000"]);

      complete = true;
      const collected = await runQuery(sql, {
        resumeAfter: new AbortController().signal,
      });

      expect(collected.rows).toEqual([{ value: 7 }]);
      expect(collected.usageAccounting?.jobId).toBe(jobId);
      expect(submissions(fetchMock)).toEqual([jobId, jobId]);
      expect(jobs.size).toBe(1);
      expect(fetchMock).toHaveBeenLastCalledWith(
        `https://bigquery.googleapis.com/bigquery/v2/projects/test-project/queries/${jobId}?location=US`,
        expect.anything(),
      );
      expect(present(finalizeUsage.mock.calls[1])[0]).toMatchObject({
        jobId,
        submissionState: "accepted",
        location: "US",
      });
    });

    it("cancels a resumable job that something other than its deadline stopped", async () => {
      vi.useFakeTimers();
      const { fetchMock } = fakeBigQuery({ complete: () => false });
      vi.stubGlobal("fetch", fetchMock);
      const caller = new AbortController();
      const deadline = new AbortController();

      await stopWhilePolling(
        caller,
        runQuery(sql, {
          signal: AbortSignal.any([caller.signal, deadline.signal]),
          resumeAfter: deadline.signal,
        }),
      );

      const [jobId] = submissions(fetchMock);
      expect(cancellations(fetchMock).map(([input]) => String(input))).toEqual([
        `https://bigquery.googleapis.com/bigquery/v2/projects/test-project/jobs/${jobId}/cancel?location=US`,
      ]);
    });

    it("leaves a job it attached to running when its own caller stops it, for another call to collect", async () => {
      vi.useFakeTimers();
      let complete = false;
      const { fetchMock, jobs } = fakeBigQuery({ complete: () => complete });
      vi.stubGlobal("fetch", fetchMock);
      await callUntilDeadline();

      const caller = new AbortController();
      const deadline = new AbortController();
      await stopWhilePolling(
        caller,
        runQuery(sql, {
          signal: AbortSignal.any([caller.signal, deadline.signal]),
          resumeAfter: deadline.signal,
        }),
      );
      expect(cancellations(fetchMock)).toHaveLength(0);

      complete = true;
      const collected = await runQuery(sql, {
        resumeAfter: new AbortController().signal,
      });
      const [jobId] = submissions(fetchMock);
      expect(submissions(fetchMock)).toEqual([jobId, jobId, jobId]);
      expect(collected.usageAccounting?.jobId).toBe(jobId);
      expect(jobs.size).toBe(1);
    });

    it.each([
      { name: "failed", lookup: () => failedJob },
      {
        name: "ran other SQL",
        lookup: () => ({
          configuration: { query: { query: "SELECT 'planted'" } },
          status: { state: "DONE" },
        }),
      },
    ])(
      "runs the query again under the next resumable ID when the existing job $name",
      async ({ lookup }) => {
        vi.useFakeTimers();
        let complete = false;
        const { fetchMock } = fakeBigQuery({
          complete: () => complete,
          lookup,
        });
        vi.stubGlobal("fetch", fetchMock);
        await callUntilDeadline();

        complete = true;
        const rerun = await runQuery(sql, {
          resumeAfter: new AbortController().signal,
        });

        const [resumableId, repeated, next] = submissions(fetchMock);
        expect(repeated).toBe(resumableId);
        expect(next).toMatch(/^agent_native_r_[a-f0-9]{64}$/);
        expect(next).not.toBe(resumableId);
        expect(rerun.rows).toEqual([{ value: 7 }]);
        expect(rerun.usageAccounting?.jobId).toBe(next);
        expect(finalizeUsage.mock.calls.map(([usage]) => usage.jobId)).toEqual([
          resumableId,
          resumableId,
          next,
        ]);
        // The abandoned job's usage is read where it ran.
        expect(present(finalizeUsage.mock.calls[1])[0]).toMatchObject({
          jobId: resumableId,
          location: "US",
        });
      },
    );

    it.each([
      { code: "resourcesExceeded", reason: "resources_exceeded" },
      { code: "invalidQuery", reason: "invalid_query" },
    ])(
      "reports an existing job's $code failure instead of running the same SQL again",
      async ({ code, reason }) => {
        vi.useFakeTimers();
        const { fetchMock } = fakeBigQuery({
          complete: () => false,
          lookup: () => ({
            status: { state: "DONE", errorResult: { reason: code } },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);
        await callUntilDeadline();

        const trace = newBigQueryQueryTrace();
        const failure = await runQuery(sql, {
          resumeAfter: new AbortController().signal,
          trace,
        }).catch((error: unknown) => error);

        const [resumableId] = submissions(fetchMock);
        expect(submissions(fetchMock)).toEqual([resumableId, resumableId]);
        expect(failure).toBeInstanceOf(BigQueryBackendError);
        expect(failure).toMatchObject({
          operation: "job",
          backendStatus: null,
          backendReason: reason,
        });
        expect(trace.jobs).toEqual([
          {
            job: "existing",
            slot: 1,
            collectable: false,
            state: "DONE",
            ageSeconds: 0,
            sameQuery: true,
            failureReason: reason,
            failureCode: code,
          },
        ]);
        expect(cancellations(fetchMock)).toHaveLength(0);
      },
    );

    it("leaves a replacement job its deadline stopped running for the next call", async () => {
      vi.useFakeTimers();
      let complete = false;
      let first: string | undefined;
      const { fetchMock, jobs } = fakeBigQuery({
        complete: () => complete,
        lookup: ({ jobId }) => (jobId === first ? failedJob : {}),
      });
      vi.stubGlobal("fetch", fetchMock);
      await callUntilDeadline();
      [first] = submissions(fetchMock);

      await callUntilDeadline();
      complete = true;
      const collected = await runQuery(sql, {
        resumeAfter: new AbortController().signal,
      });

      const replacement = submissions(fetchMock)[2];
      expect(submissions(fetchMock)).toEqual([
        first,
        first,
        replacement,
        first,
        replacement,
      ]);
      expect(jobs.size).toBe(2);
      expect(cancellations(fetchMock)).toHaveLength(0);
      expect(collected.usageAccounting?.jobId).toBe(replacement);
    });

    it("runs under a random ID, cancelled as usual, once every resumable ID is used", async () => {
      vi.useFakeTimers();
      const { fetchMock } = fakeBigQuery({
        complete: () => false,
        lookup: () => failedJob,
      });
      vi.stubGlobal("fetch", fetchMock);

      for (let call = 0; call < 4; call++) await callUntilDeadline();

      const ids = submissions(fetchMock);
      const last = ids[ids.length - 1];
      const resumableIds = [...new Set(ids.slice(0, -1))];
      expect(resumableIds).toHaveLength(3);
      expect(
        resumableIds.every((id) => /^agent_native_r_[a-f0-9]{64}$/.test(id)),
      ).toBe(true);
      expect(last).toMatch(/^agent_native_[a-f0-9]{32}$/);
      expect(cancellations(fetchMock).map(([input]) => String(input))).toEqual([
        expect.stringContaining(`/jobs/${last}/cancel`),
      ]);
    });

    it("fails without starting another job or cancelling the existing one when that job can't be read", async () => {
      vi.useFakeTimers();
      let lookupStatus: number | undefined;
      const { fetchMock } = fakeBigQuery({
        complete: () => false,
        lookup: () => lookupStatus ?? {},
      });
      vi.stubGlobal("fetch", fetchMock);
      await callUntilDeadline();

      lookupStatus = 503;
      const trace = newBigQueryQueryTrace();
      await expect(
        runQuery(sql, { resumeAfter: new AbortController().signal, trace }),
      ).rejects.toMatchObject({
        name: "BigQueryBackendError",
        operation: "job",
        backendStatus: 503,
      });
      expect(trace).toMatchObject({
        stage: "checking_existing_job",
        jobs: [{ job: "existing", slot: 1, unreadable: true }],
      });

      const [jobId, ...rest] = submissions(fetchMock);
      expect(rest).toEqual([jobId]);
      expect(cancellations(fetchMock)).toHaveLength(0);
      expect(present(finalizeUsage.mock.calls[1])[0]).toMatchObject({
        jobId,
        location: "US",
      });
    });

    it("collects a job across the clock hour, but not one that started over an hour ago", async () => {
      vi.useFakeTimers({ now: new Date("2026-11-16T10:59:58.000Z") });
      const { fetchMock } = fakeBigQuery({ complete: () => false });
      vi.stubGlobal("fetch", fetchMock);
      await callUntilDeadline();

      vi.setSystemTime(new Date("2026-11-16T11:00:01.000Z"));
      await callUntilDeadline();
      const [first, second] = submissions(fetchMock);
      expect(second).toBe(first);

      vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
      await callUntilDeadline();
      const [, , third, fourth] = submissions(fetchMock);
      expect(third).toBe(first);
      expect(fourth).toMatch(/^agent_native_r_[a-f0-9]{64}$/);
      expect(fourth).not.toBe(first);
      expect(cancellations(fetchMock)).toHaveLength(0);
    });

    it("does not name or leave a job on a forced refresh", async () => {
      vi.useFakeTimers();
      const { fetchMock } = fakeBigQuery({ complete: () => false });
      vi.stubGlobal("fetch", fetchMock);
      const deadline = new AbortController();

      await stopWhilePolling(
        deadline,
        runQuery(sql, {
          forceRefresh: true,
          signal: deadline.signal,
          resumeAfter: deadline.signal,
        }),
      );

      const [jobId] = submissions(fetchMock);
      expect(jobId).toMatch(/^agent_native_[a-f0-9]{32}$/);
      expect(jobTimeouts(fetchMock)).toEqual([undefined]);
      expect(cancellations(fetchMock)).toHaveLength(1);
    });

    describe("trace", () => {
      it.each([
        {
          name: "failed",
          lookup: () => ({
            status: { state: "DONE", errorResult: { reason: "backendError" } },
          }),
          attempt: {
            state: "DONE",
            sameQuery: true,
            failureReason: "backend_error",
            failureCode: "backendError",
          },
        },
        {
          name: "was cancelled",
          lookup: () => ({
            status: { state: "DONE", errorResult: { reason: "stopped" } },
          }),
          attempt: {
            state: "DONE",
            sameQuery: true,
            failureReason: "other",
            failureCode: "stopped",
          },
        },
        {
          name: "failed with a reason that isn't a plain code",
          lookup: () => ({
            status: {
              state: "DONE",
              errorResult: { reason: "Not found: table a.b" },
            },
          }),
          attempt: {
            state: "DONE",
            sameQuery: true,
            failureReason: "other",
            failureCode: null,
          },
        },
        {
          name: "ran other SQL",
          lookup: () => ({
            configuration: { query: { query: "SELECT 'planted'" } },
            status: { state: "DONE" },
          }),
          attempt: {
            state: "DONE",
            sameQuery: false,
            queryDifference: {
              at: "SELECT ".length,
              existingLength: "SELECT 'planted'".length,
              submittedLength: sql.length,
            },
            failureReason: null,
          },
        },
      ])(
        "records why an existing job that $name couldn't be collected, and the job started instead",
        async ({ lookup, attempt }) => {
          vi.useFakeTimers();
          let complete = false;
          const { fetchMock } = fakeBigQuery({
            complete: () => complete,
            lookup,
          });
          vi.stubGlobal("fetch", fetchMock);
          const stopped = newBigQueryQueryTrace();
          await callUntilDeadline(stopped);
          expect(stopped).toMatchObject({
            stage: "polling",
            jobs: [{ job: "new", slot: 1 }],
          });
          expect(stopped.polls).toBeGreaterThan(0);

          complete = true;
          const trace = newBigQueryQueryTrace();
          await runQuery(sql, {
            resumeAfter: new AbortController().signal,
            trace,
          });

          expect(trace.stage).toBe("finished");
          expect(trace.jobs).toEqual([
            {
              job: "existing",
              slot: 1,
              collectable: false,
              ageSeconds: 0,
              ...attempt,
            },
            { job: "new", slot: 2 },
          ]);
        },
      );

      it("records an existing job too old to collect", async () => {
        vi.useFakeTimers({ now: new Date("2026-11-16T10:00:00.000Z") });
        const { fetchMock } = fakeBigQuery({ complete: () => false });
        vi.stubGlobal("fetch", fetchMock);
        await callUntilDeadline();

        vi.setSystemTime(new Date("2026-11-16T11:01:00.000Z"));
        const trace = newBigQueryQueryTrace();
        await callUntilDeadline(trace);

        expect(trace.stage).toBe("polling");
        expect(trace.jobs).toEqual([
          {
            job: "existing",
            slot: 1,
            collectable: false,
            state: "RUNNING",
            ageSeconds: 3_660,
            sameQuery: true,
            failureReason: null,
            tooOld: true,
          },
          { job: "new", slot: 2 },
        ]);
      });

      it("records an existing job without a verdict when the call stops while reading it", async () => {
        vi.useFakeTimers();
        const { fetchMock } = fakeBigQuery({ complete: () => false });
        vi.stubGlobal("fetch", fetchMock);
        await callUntilDeadline();

        let lookupStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          lookupStarted = resolve;
        });
        vi.stubGlobal(
          "fetch",
          vi.fn<typeof globalThis.fetch>().mockImplementation((input, init) => {
            if (!/\/jobs\/[^/?]+\?/.test(String(input))) {
              return fetchMock(input, init);
            }
            lookupStarted();
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true },
              );
            });
          }),
        );
        const deadline = new AbortController();
        const trace = newBigQueryQueryTrace();
        const stopped = runQuery(sql, {
          signal: deadline.signal,
          resumeAfter: deadline.signal,
          trace,
        });
        await started;
        deadline.abort();
        await expect(stopped).rejects.toMatchObject({ name: "AbortError" });

        expect(trace.stage).toBe("checking_existing_job");
        expect(trace.jobs).toEqual([{ job: "existing", slot: 1 }]);
      });

      it("records the time spent waiting while another call ran the same query", async () => {
        vi.useFakeTimers();
        const { fetchMock } = fakeBigQuery({ complete: () => false });
        vi.stubGlobal("fetch", fetchMock);
        const holder = new AbortController();
        const holding = runQuery(sql, { signal: holder.signal });
        await vi.advanceTimersByTimeAsync(0);

        const waiter = new AbortController();
        const trace = newBigQueryQueryTrace();
        const waiting = runQuery(sql, { signal: waiter.signal, trace });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(trace.stage).toBe("waiting_for_lock");
        expect(trace.lockWaitStartedAt).not.toBeNull();

        waiter.abort();
        await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(0);
        expect(trace).toMatchObject({
          stage: "waiting_for_lock",
          lockWaitMs: 3_000,
          lockWaitStartedAt: null,
          staleLockCleared: false,
          jobs: [],
        });

        holder.abort();
        await expect(holding).rejects.toMatchObject({ name: "AbortError" });
      });

      it("records a call stopped while getting its BigQuery credentials as authenticating", async () => {
        vi.useFakeTimers();
        const { fetchMock } = fakeBigQuery({ complete: () => false });
        vi.stubGlobal("fetch", fetchMock);
        let tokenRequested!: () => void;
        const requested = new Promise<void>((resolve) => {
          tokenRequested = resolve;
        });
        getBigQueryAccessToken.mockImplementationOnce(
          (options?: { signal?: AbortSignal }) =>
            new Promise<string>((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(options.signal?.reason),
                { once: true },
              );
              tokenRequested();
            }),
        );
        const deadline = new AbortController();
        const trace = newBigQueryQueryTrace();
        const stopped = runQuery(sql, {
          signal: deadline.signal,
          resumeAfter: deadline.signal,
          trace,
        });
        await requested;
        deadline.abort();
        await expect(stopped).rejects.toMatchObject({ name: "AbortError" });

        expect(trace.stage).toBe("authenticating");
        expect(trace.jobs).toEqual([]);
        expect(submissions(fetchMock)).toEqual([]);
      });
    });
  });
});
