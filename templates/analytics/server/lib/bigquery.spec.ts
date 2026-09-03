import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const resolveCredential = vi.fn();
const getAccessToken = vi.fn();

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));

vi.mock("./credentials", () => ({ resolveCredential }));

vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: () => ({
    userEmail: "test@example.com",
    orgId: null,
  }),
}));

vi.mock("./gcloud", () => ({ getAccessToken }));

const {
  BigQueryRestrictedSchemaError,
  dryRunQuery,
  enforceBigQueryRestrictedSchemaPolicy,
  findRestrictedBigQueryDataset,
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

describe("restricted BigQuery schema policy", () => {
  it("allows production datasets", () => {
    expect(() =>
      enforceBigQueryRestrictedSchemaPolicy(
        "SELECT * FROM `example-project.dbt_analytics.signups`",
      ),
    ).not.toThrow();
  });

  it.each([
    ["SELECT * FROM `example-project.dbt_dev.signups`", "dbt_dev"],
    ["SELECT * FROM dbt_backup.signups", "dbt_backup"],
    ["SELECT * FROM example_project.dbt_backup.signups", "dbt_backup"],
    ["SELECT * FROM `dbt_backup`.signups", "dbt_backup"],
    ["SELECT * FROM `example-project`.`dbt_dev`.`signups`", "dbt_dev"],
    ["SELECT * FROM dbt_backup /* hidden */ . signups", "dbt_backup"],
  ])("detects restricted table references in %s", (sql, datasetId) => {
    expect(findRestrictedBigQueryDataset(sql)).toBe(datasetId);
    expect(() => enforceBigQueryRestrictedSchemaPolicy(sql)).toThrow(
      BigQueryRestrictedSchemaError,
    );
  });

  it("ignores comments, string literals, and similarly named datasets", () => {
    const sql = `
      -- SELECT * FROM dbt_dev.signups
      /* JOIN \`example-project.dbt_backup.users\` ON TRUE */
      SELECT 'dbt_backup.signups' AS example,
             "dbt_dev.users" AS another_example
      FROM \`example-project.dbt_backup_copy.signups\`
    `;

    expect(findRestrictedBigQueryDataset(sql)).toBeNull();
  });

  it("rejects dynamic SQL unless the direct path has explicit access", () => {
    const sql =
      "EXECUTE IMMEDIATE CONCAT('SELECT * FROM dbt_', 'backup.signups')";

    expect(() => enforceBigQueryRestrictedSchemaPolicy(sql)).toThrow(
      BigQueryRestrictedSchemaError,
    );
    expect(() =>
      enforceBigQueryRestrictedSchemaPolicy(sql, {
        restrictedSchemaAccess: "user-explicit-request",
      }),
    ).not.toThrow();
  });

  it.each(["dbt_dev", "dbt_backup"])(
    "allows %s only with the internal explicit-request marker",
    (datasetId) => {
      expect(() =>
        enforceBigQueryRestrictedSchemaPolicy(
          `SELECT * FROM \`example-project.${datasetId}.signups\``,
          { restrictedSchemaAccess: "user-explicit-request" },
        ),
      ).not.toThrow();
    },
  );
});

describe("runQuery cancellation", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
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

  it("rejects restricted schemas before credentials, cache, or network access", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT * FROM `example-project.dbt_backup.signups`"),
    ).rejects.toMatchObject({
      code: "bigquery_restricted_schema",
      datasetId: "dbt_backup",
    });

    expect(resolveCredential).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows restricted schemas on the explicitly opted-in direct path", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        jobComplete: true,
        schema: { fields: [{ name: "value", type: "INT64" }] },
        rows: [{ f: [{ v: "1" }] }],
        totalBytesProcessed: "1",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuery("SELECT * FROM `example-project.dbt_dev.explicit_test`", {
        restrictedSchemaAccess: "user-explicit-request",
      }),
    ).resolves.toMatchObject({ rows: [{ value: 1 }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rechecks the configured app-events relation after placeholder expansion", async () => {
    resolveCredential.mockImplementation(async (key: string) => {
      if (key === "BIGQUERY_PROJECT_ID") return "test-project";
      if (key === "ANALYTICS_BIGQUERY_EVENTS_TABLE") {
        return "test-project.dbt_backup.events";
      }
      return null;
    });
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runQuery("SELECT * FROM @app_events")).rejects.toMatchObject({
      code: "bigquery_restricted_schema",
      datasetId: "dbt_backup",
    });
    await expect(
      dryRunQuery("SELECT * FROM @app_events"),
    ).rejects.toMatchObject({
      code: "bigquery_restricted_schema",
      datasetId: "dbt_backup",
    });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps dry-run validation blocked for restricted schemas", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dryRunQuery("SELECT * FROM `example-project.dbt_backup.signups`"),
    ).rejects.toMatchObject({
      code: "bigquery_restricted_schema",
      datasetId: "dbt_backup",
    });
    expect(fetchMock).not.toHaveBeenCalled();
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

    // Advance only pending microtasks: the query request has completed and
    // BigQuery polling is now waiting for its first one-second interval.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/test-project/queries"),
      expect.objectContaining({ signal: controller.signal }),
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);

    // Cancellation clears the pending interval, avoids another
    // getQueryResults poll, and best-effort cancels the submitted job.
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
});
