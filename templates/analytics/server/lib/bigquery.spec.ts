import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const resolveCredential = vi.fn();
const getAccessToken = vi.fn();
const getCredentialContext = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext,
  getRequestRunContext: () => undefined,
}));

vi.mock("./credentials", () => ({ resolveCredential }));

vi.mock("./gcloud", () => ({ getAccessToken }));

const { dryRunQuery, runQuery } = await import("./bigquery");

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function useCacheDatabase(): void {
  const cache = new Map<
    string,
    {
      result: string;
      generation: number;
      refreshInProgress: boolean;
      refreshStartedAt: string | null;
      expiresAt: string;
    }
  >();
  execute.mockImplementation(async ({ sql, args }) => {
    const key = String(args[0]);
    const entry = cache.get(key);
    if (sql.startsWith("SELECT generation")) {
      return {
        rows: entry
          ? [
              {
                generation: entry.generation,
                refresh_in_progress: entry.refreshInProgress,
                refresh_started_at: entry.refreshStartedAt,
              },
            ]
          : [],
      };
    }
    if (sql.startsWith("SELECT result")) {
      const generation = Number(args[1]);
      return {
        rows:
          entry &&
          entry.generation === generation &&
          !entry.refreshInProgress &&
          entry.expiresAt > String(args[2])
            ? [{ result: entry.result }]
            : [],
      };
    }
    if (sql.includes("VALUES ($1, $2, '{}', 0, $3, $3, 1, TRUE, $3)")) {
      const generation = (entry?.generation ?? 0) + 1;
      cache.set(key, {
        result: entry?.result ?? "{}",
        generation,
        refreshInProgress: true,
        refreshStartedAt: String(args[2]),
        expiresAt: String(args[2]),
      });
      return { rows: [{ generation }] };
    }
    if (sql.startsWith("INSERT INTO bigquery_cache")) {
      const generation = Number(args[6]);
      if (!entry) {
        cache.set(key, {
          result: String(args[2]),
          generation,
          refreshInProgress: false,
          refreshStartedAt: null,
          expiresAt: String(args[5]),
        });
        return { rows: [{ key }] };
      }
      if (entry.generation === generation && !entry.refreshInProgress) {
        cache.set(key, {
          ...entry,
          result: String(args[2]),
          expiresAt: String(args[5]),
        });
        return { rows: [{ key }] };
      }
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE bigquery_cache SET sql")) {
      const generation = Number(args[6]);
      if (entry?.generation === generation && entry.refreshInProgress) {
        cache.set(key, {
          result: String(args[2]),
          generation,
          refreshInProgress: false,
          refreshStartedAt: null,
          expiresAt: String(args[5]),
        });
        return { rows: [{ key }] };
      }
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE bigquery_cache SET refresh_in_progress")) {
      const generation = Number(args[1]);
      if (entry?.generation === generation && entry.refreshInProgress) {
        cache.set(key, {
          ...entry,
          refreshInProgress: false,
          refreshStartedAt: null,
        });
        return { rows: [{ key }] };
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe("runQuery cancellation", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    getCredentialContext.mockReset();
    getCredentialContext.mockReturnValue({
      userEmail: "test@example.com",
      orgId: null,
    });
    resolveCredential.mockReset();
    resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID" ? "test-project" : null,
    );
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue("test-access-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops an incomplete job's poll wait immediately when the agent run aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        jobComplete: false,
        jobReference: { jobId: "job-1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1", { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/test-project/queries"),
      expect.objectContaining({ signal: controller.signal }),
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/projects/test-project/jobs/job-1/cancel"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cancels an incomplete job after the polling limit is reached", async () => {
    vi.useFakeTimers();
    const incompleteJob = {
      jobComplete: false,
      jobReference: { jobId: "job-timeout" },
    };
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        return url.endsWith("/cancel")
          ? jsonResponse({})
          : jsonResponse(incompleteJob);
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1");
    const rejection = expect(pending).rejects.toThrow(
      "BigQuery query timed out after 60 seconds",
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://bigquery.googleapis.com/bigquery/v2/projects/test-project/jobs/job-timeout/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves the timeout error when job cancellation fails", async () => {
    vi.useFakeTimers();
    const incompleteJob = {
      jobComplete: false,
      jobReference: { jobId: "job-cancel-fails" },
    };
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/cancel")) {
          throw new Error("cancel unavailable");
        }
        return jsonResponse(incompleteJob);
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 2");
    const rejection = expect(pending).rejects.toThrow(
      "BigQuery query timed out after 60 seconds",
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://bigquery.googleapis.com/bigquery/v2/projects/test-project/jobs/job-cancel-fails/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards the signal to completed-job polling requests", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          jobComplete: false,
          jobReference: { jobId: "job-1" },
        }),
      )
      .mockResolvedValueOnce(
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
      expect.stringContaining("/projects/test-project/queries/job-1"),
      expect.objectContaining({ signal: controller.signal }),
    );
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
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBe(
      "BigQuery validation timed out after 10 seconds",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/test-project/jobs"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refreshes cached current-date queries at UTC midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "agent-native-utc-date:2026-09-08",
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "agent-native-utc-date:2026-09-09",
    );
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
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response("3918"))
      .mockResolvedValueOnce(response("4200"));
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).not.toHaveProperty("useQueryCache");
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toHaveProperty("useQueryCache", false);
  });

  it("prevents an older query from overwriting a forced refresh", async () => {
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
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(() => {
        signalOlderStarted();
        return new Promise<Response>((resolve) => {
          resolveOlder = resolve;
        });
      })
      .mockResolvedValueOnce(response("4200"));
    vi.stubGlobal("fetch", fetchMock);
    const sql = "SELECT 1 AS concurrent_dashboard_refresh_test";

    const olderQuery = runQuery(sql);
    await olderStarted;
    await expect(runQuery(sql, { forceRefresh: true })).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
    });
    resolveOlder(response("3918"));
    await expect(olderQuery).resolves.toMatchObject({
      rows: [{ signups: 3918 }],
    });

    await expect(runQuery(sql)).resolves.toMatchObject({
      rows: [{ signups: 4200 }],
      cached: true,
    });
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

  it("isolates cached results by default member and organization-only scope", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [] },
        rows: [],
        totalBytesProcessed: "0",
      }),
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
