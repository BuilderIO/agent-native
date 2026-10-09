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

const { dryRunQuery, dryRunQuerySchema, runQuery } = await import("./bigquery");

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
            ? [{ result: entry.result }]
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
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue("test-access-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
  });

  it("applies the caller's BigQuery billed-byte cap", async () => {
    const fetchMock = mockQueryJobs(
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
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `https://bigquery.googleapis.com/bigquery/v2/projects/test-project/jobs/${jobId}/cancel?location=US`,
    );
  });

  it("bounds a stalled job submission and cancels a possibly accepted job", async () => {
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
            jobs: [{ jobReference: { jobId, location: "us-central1" } }],
          });
        }
        return jsonResponse({});
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runQuery("SELECT 1 AS stalled_job_submission_test");
    await submissionStarted;
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/jobs"),
      expect.objectContaining({
        signal: submissionTimeoutController.signal,
        method: "POST",
      }),
    );
    expect([...cache.values()][0]?.refreshInProgress).toBe(true);

    submissionTimeoutController.abort();
    await expect(pending).rejects.toThrow("job submission timed out");

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
    expect(timeout).toHaveBeenCalledWith(10_000);
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
      "BigQuery query timed out after 60 seconds",
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
      "BigQuery query timed out after 60 seconds",
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
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "agent-native-utc-date:2026-09-08",
    );
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain(
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
    expect(fenceRead?.[0].args[0]).toMatch(/^v2:/);
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
    expect(result).not.toHaveProperty("cached");

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
    await expect(pending).rejects.toThrow(
      "BigQuery poll error 503: BigQuery poll unavailable",
    );
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
    });
    cache.set("active-refresh", {
      result: "{}",
      generation: 1,
      fenceToken: "active-token",
      refreshInProgress: true,
      refreshForced: false,
      refreshStartedAt: new Date(now - 60 * 1000).toISOString(),
      expiresAt: expiredAt,
    });
    cache.set("expired-result", {
      result: "{}",
      generation: 1,
      fenceToken: null,
      refreshInProgress: false,
      refreshForced: false,
      refreshStartedAt: null,
      expiresAt: expiredAt,
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

  it("isolates cached results by default member and organization-only scope", async () => {
    useCacheDatabase();
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

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
