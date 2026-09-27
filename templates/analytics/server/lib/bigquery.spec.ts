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
