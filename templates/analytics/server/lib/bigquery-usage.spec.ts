import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture observation");
  return value;
}

const execute = vi.hoisted(() => vi.fn());
const getRunContext = vi.hoisted(() =>
  vi.fn<() => { waitUntil: (work: Promise<unknown>) => void } | undefined>(),
);
const platformWaitUntil = vi.hoisted(() =>
  vi.fn<
    (request?: unknown) => ((work: Promise<unknown>) => void) | undefined
  >(),
);
vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: getRunContext,
  platformWaitUntil,
  getSession: async () => ({ email: "caller@example.test", orgId: "org-1" }),
  getCredentialContext: () => null,
  runWithRequestContext: async (
    ctx: { run?: { waitUntil: (work: Promise<unknown>) => void } },
    run: () => Promise<unknown>,
  ) => {
    getRunContext.mockReturnValue(ctx.run);
    try {
      return await run();
    } finally {
      getRunContext.mockReturnValue(undefined);
    }
  },
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => ({ orgId: "org-1" }),
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: vi.fn(),
  resolveCredentialDetailed: vi.fn(),
  assertCredentialCanReachEndpoint: vi.fn(),
  hasCredential: vi.fn(),
  saveCredential: vi.fn(),
  deleteCredential: vi.fn(),
  deleteResolvedCredential: vi.fn(),
}));
vi.mock("h3", () => ({ setResponseStatus: vi.fn() }));
import {
  runWithRequestDbPoolScope,
  getOrCreateRequestDbPool,
} from "@agent-native/core/db/request-pool-context";
import type { H3Event } from "h3";

import { withRequestContextFromEvent } from "./credentials";
beforeEach(() => {
  getRunContext.mockReset();
  platformWaitUntil.mockReset();
});
vi.mock("@agent-native/core/db", () => ({ getDbExec: () => ({ execute }) }));
const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import {
  BIGQUERY_USAGE_MIGRATION_SQL,
  newBigQueryJobUsage,
  observeBigQueryJobUsage,
  finalizeBigQueryJobUsage,
  persistBigQueryJobUsage,
  usageBytes,
  withBigQueryUsageAttribution,
} from "./bigquery-usage";

const ctx = { userEmail: "caller@example.test", orgId: "org-1" };
const makeUsage = () => newBigQueryJobUsage("test-project", "job-1", ctx);
const metadata = (
  query: Record<string, unknown>,
  status: Record<string, unknown> = { state: "DONE" },
) => ({
  jobReference: { projectId: "test-project", jobId: "job-1", location: "EU" },
  status,
  statistics: { query },
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("warehouse job observations", () => {
  it.each(["unknown", "rejected"] as const)(
    "confirms %s submission while keeping exact billed bytes separate from processed bytes and provider cache provenance",
    async (submissionState) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        json(
          metadata({
            totalBytesProcessed: "123",
            totalBytesBilled: "10485760",
            cacheHit: false,
          }),
        ),
      );
      vi.stubGlobal("fetch", fetch);
      const result = await observeBigQueryJobUsage(
        { ...makeUsage(), submissionState, location: "EU" },
        "fake-token",
      );
      expect(result).toMatchObject({
        submissionState: "accepted",
        bytesProcessed: "123",
        bytesBilled: "10485760",
        providerCacheHit: false,
        outcome: "succeeded",
        usageStatus: "complete",
      });
      const url = new URL(String(present(fetch.mock.calls[0])[0]));
      expect(url.pathname).toBe(
        "/bigquery/v2/projects/test-project/jobs/job-1",
      );
      expect(url.searchParams.get("location")).toBe("EU");
      expect(url.searchParams.get("fields")).toContain("totalBytesBilled");
      expect(present(fetch.mock.calls[0])[1]).not.toHaveProperty("body");
    },
  );

  it("preserves a reported provider cache hit and explicit zero billed bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          metadata({
            totalBytesProcessed: "90",
            totalBytesBilled: "0",
            cacheHit: true,
          }),
        ),
      ),
    );
    expect(await observeBigQueryJobUsage(makeUsage(), "fake")).toMatchObject({
      bytesProcessed: "90",
      bytesBilled: "0",
      providerCacheHit: true,
      usageStatus: "complete",
    });
  });

  it.each([undefined, null, -1, 2.5, "-1", "nan", "1e3", "1.5"])(
    "keeps malformed byte value %s unknown",
    (value) => {
      expect(usageBytes(value)).toBeNull();
    },
  );
  it("does not round byte counts larger than JS safe integers", () =>
    expect(usageBytes("9007199254740999")).toBe("9007199254740999"));

  it.each(["missing", "http", "throw", "different-job"])(
    "keeps %s metadata unknown without replacing known processed bytes with zero",
    async (mode) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (mode === "throw") throw new Error("network");
          if (mode === "http") return new Response("", { status: 403 });
          if (mode === "different-job")
            return json({
              ...metadata({ totalBytesBilled: "99" }),
              jobReference: { jobId: "other", projectId: "test-project" },
            });
          return json(metadata({}));
        }),
      );
      const result = await observeBigQueryJobUsage(
        {
          ...makeUsage(),
          submissionState: "unknown",
          bytesProcessed: "123",
          providerCacheHit: false,
        },
        "fake",
      );
      expect(result.submissionState).toBe(
        mode === "missing" ? "accepted" : "unknown",
      );
      expect(result.bytesProcessed).toBe("123");
      expect(result.bytesBilled).toBeNull();
      expect(result.usageStatus).not.toBe("complete");
    },
  );

  it.each([
    ["RUNNING", undefined, null],
    ["DONE", "stopped", "cancelled"],
    ["DONE", "invalidQuery", "failed"],
  ])(
    "observes provider state %s without assuming cancellation is free",
    async (state, reason, outcome) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json(
            metadata(
              {},
              { state, ...(reason ? { errorResult: { reason } } : {}) },
            ),
          ),
        ),
      );
      expect(await observeBigQueryJobUsage(makeUsage(), "fake")).toMatchObject({
        providerState: state,
        outcome,
        bytesBilled: null,
        usageStatus: "partial",
      });
    },
  );

  it("isolates concurrent server-owned dashboard provenance", async () => {
    const records = await Promise.all(
      ["a", "b"].map((dashboardId) =>
        withBigQueryUsageAttribution(
          { workload: "dashboard-report", dashboardId, panelId: "p" },
          async () => {
            await Promise.resolve();
            return makeUsage();
          },
        ),
      ),
    );
    expect(records.map((r) => r.dashboardId)).toEqual(["a", "b"]);
    expect(records[0]).toMatchObject({
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
      workload: "dashboard-report",
      panelId: "p",
    });
    expect(makeUsage()).toMatchObject({
      workload: "unattributed",
      dashboardId: null,
      panelId: null,
    });
  });
});

describe("durable warehouse ledger", () => {
  let client: Awaited<ReturnType<typeof PGlite.create>>;
  beforeEach(async () => {
    client = await PGlite.create("memory://");
    await client.exec(BIGQUERY_USAGE_MIGRATION_SQL);
    execute
      .mockReset()
      .mockImplementation(({ sql, args }) => client.query(sql, args));
  });
  afterEach(async () => {
    await client.close();
  });

  it("upserts observations of one job once, preserves exact bytes and cannot regress complete usage", async () => {
    const usage = makeUsage();
    await persistBigQueryJobUsage(usage);
    const complete = {
      ...usage,
      usageStatus: "complete" as const,
      bytesProcessed: "9007199254740999",
      bytesBilled: "10485760",
      providerCacheHit: false,
    };
    await persistBigQueryJobUsage(complete);
    await persistBigQueryJobUsage(complete);
    await persistBigQueryJobUsage(usage);
    const rows = (await client.query("SELECT * FROM analytics_bigquery_usage"))
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bytes_processed: "9007199254740999",
      bytes_billed: "10485760",
      usage_status: "complete",
      provider_cache_hit: false,
    });
    await persistBigQueryJobUsage({ ...complete, jobId: "retry-new-job" });
    expect(
      (
        await client.query(
          "SELECT COUNT(*)::integer AS n FROM analytics_bigquery_usage",
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it("keeps abandoned and incomplete jobs visible as unknown rather than zero", async () => {
    await persistBigQueryJobUsage(makeUsage());
    expect(
      (await client.query("SELECT * FROM analytics_bigquery_usage")).rows[0],
    ).toMatchObject({
      usage_status: "pending",
      bytes_billed: null,
      bytes_processed: null,
      outcome: null,
    });
    expect(
      await persistBigQueryJobUsage({
        ...makeUsage(),
        usageStatus: "unavailable",
      }),
    ).toBe(true);
  });

  it("reports a persistence failure without throwing a successful query into a retry", async () => {
    execute.mockRejectedValueOnce(new Error("database unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await persistBigQueryJobUsage(makeUsage())).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("usage is unknown"),
      expect.objectContaining({ jobId: "job-1" }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private SQL text");
  });
  it("follows asynchronous cancellation to terminal usage without holding an aborted query response", async () => {
    const usage = makeUsage();
    await persistBigQueryJobUsage(usage);
    const background: Promise<unknown>[] = [];
    getRunContext.mockReturnValue({
      waitUntil: (work) => {
        background.push(work);
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(metadata({}, { state: "RUNNING" })))
      .mockResolvedValueOnce(
        json(
          metadata(
            {
              totalBytesProcessed: "123",
              totalBytesBilled: "10485760",
              cacheHit: false,
            },
            { state: "DONE", errorResult: { reason: "stopped" } },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    expect(
      await finalizeBigQueryJobUsage(usage, "fake", true, controller.signal),
    ).toMatchObject({ status: "pending" });
    expect(background).toHaveLength(1);
    expect(await background[0]).toMatchObject({
      status: "recorded",
      usageStatus: "complete",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      (await client.query("SELECT * FROM analytics_bigquery_usage")).rows[0],
    ).toMatchObject({
      outcome: "cancelled",
      bytes_billed: "10485760",
      usage_status: "complete",
    });
  });

  it.each([
    {
      name: "missing",
      initial: "9007199254740999",
      later: undefined,
      expected: "9007199254740999",
    },
    { name: "malformed", initial: "0", later: "bad", expected: "0" },
    {
      name: "new valid",
      initial: "9007199254740999",
      later: "10485760",
      expected: "10485760",
    },
  ])(
    "keeps the latest valid billed bytes across $name follow-up metadata",
    async ({ initial, later, expected }) => {
      const usage = makeUsage();
      await persistBigQueryJobUsage(usage);
      const background: Promise<unknown>[] = [];
      getRunContext.mockReturnValue({
        waitUntil: (work) => {
          background.push(work);
        },
      });
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          json(
            metadata(
              {
                totalBytesProcessed: "123",
                totalBytesBilled: initial,
                cacheHit: false,
              },
              { state: "RUNNING" },
            ),
          ),
        )
        .mockImplementation(async () =>
          json(
            metadata({
              totalBytesProcessed: "123",
              totalBytesBilled: later,
              cacheHit: false,
            }),
          ),
        );
      vi.stubGlobal("fetch", fetch);
      await finalizeBigQueryJobUsage(usage, "fake", true);
      expect(await background[0]).toMatchObject({
        status: "recorded",
        usageStatus: "complete",
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(
        (
          await client.query(
            "SELECT bytes_billed, usage_status FROM analytics_bigquery_usage",
          )
        ).rows[0],
      ).toMatchObject({ bytes_billed: expected, usage_status: "complete" });
    },
  );

  it("skips metadata for a confirmed rejection and persists it without inferred bytes", async () => {
    const usage = { ...makeUsage(), submissionState: "rejected" as const };
    await persistBigQueryJobUsage(usage);
    const background: Promise<unknown>[] = [];
    getRunContext.mockReturnValue({
      waitUntil: (work) => {
        background.push(work);
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetch);
    await finalizeBigQueryJobUsage(usage, "fake", true);
    expect(await background[0]).toMatchObject({
      status: "recorded",
      usageStatus: "unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await client.query(
          "SELECT submission_state, usage_status, bytes_billed FROM analytics_bigquery_usage",
        )
      ).rows[0],
    ).toMatchObject({
      submission_state: "rejected",
      usage_status: "unavailable",
      bytes_billed: null,
    });
  });

  it("bounds follow-up observations and preserves unresolved usage as unknown", async () => {
    const usage = makeUsage();
    await persistBigQueryJobUsage(usage);
    const background: Promise<unknown>[] = [];
    getRunContext.mockReturnValue({
      waitUntil: (work) => {
        background.push(work);
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(metadata({}, { state: "RUNNING" })),
    );
    vi.stubGlobal("fetch", fetch);
    await finalizeBigQueryJobUsage(usage, "fake", true);
    expect(await background[0]).toMatchObject({
      status: "recorded",
      usageStatus: "partial",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      (await client.query("SELECT * FROM analytics_bigquery_usage")).rows[0],
    ).toMatchObject({
      bytes_billed: null,
      outcome: null,
      usage_status: "partial",
    });
  });

  it.each([false, true])(
    "returns before stalled accounting without a platform hook (aborted=%s)",
    async (aborted) => {
      const usage = makeUsage();
      await persistBigQueryJobUsage(usage);
      let release = (_response: Response) => {};
      const fetch = vi.fn<typeof globalThis.fetch>(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetch);
      let wrote = () => {};
      const finishedWrite = new Promise<void>((resolve) => {
        wrote = resolve;
      });
      execute.mockImplementation(async ({ sql, args }) => {
        const result = await client.query(sql, args);
        wrote();
        return result;
      });
      const controller = new AbortController();
      if (aborted) controller.abort();
      const receipt = await finalizeBigQueryJobUsage(
        usage,
        "fake",
        true,
        controller.signal,
      );
      expect(receipt.status).toBe("pending");
      expect(fetch).toHaveBeenCalledOnce();
      release(
        json(
          metadata({
            totalBytesProcessed: "123",
            totalBytesBilled: "10485760",
            cacheHit: false,
          }),
        ),
      );
      await finishedWrite;
      expect(
        (await client.query("SELECT * FROM analytics_bigquery_usage")).rows[0],
      ).toMatchObject({ usage_status: "complete" });
    },
  );

  it("exposes an unavailable receipt when both bounded writes fail", async () => {
    execute.mockRejectedValue(new Error("database unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const usage = makeUsage();
    const initial = await persistBigQueryJobUsage(usage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          metadata({
            totalBytesProcessed: "123",
            totalBytesBilled: "10485760",
            cacheHit: false,
          }),
        ),
      ),
    );
    expect(
      await finalizeBigQueryJobUsage(usage, "fake", initial),
    ).toMatchObject({ status: "unavailable" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeoutMs: 500, maxAttempts: 1 }),
    );
  });
  it.each(["platform", "fallback", "aborted"] as const)(
    "keeps the real HTTP request pool alive through %s accounting",
    async (mode) => {
      const background: Promise<unknown>[] = [];
      const request: Request & {
        waitUntil?: (work: Promise<unknown>) => void;
      } = new Request("https://fixture.test/api/query");
      if (mode === "platform")
        request.waitUntil = (work) => {
          background.push(work);
        };
      platformWaitUntil.mockImplementation((candidate) =>
        candidate === request ? request.waitUntil?.bind(request) : undefined,
      );
      let release = (_response: Response) => {};
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        ),
      );
      let finishClose = () => {};
      const closed = new Promise<void>((resolve) => {
        finishClose = resolve;
      });
      const pool = {
        end: vi.fn(async () => {
          finishClose();
        }),
      };
      execute.mockImplementation(async ({ sql, args }) => {
        expect(getOrCreateRequestDbPool("usage-http-test", () => pool)).toBe(
          pool,
        );
        return client.query(sql, args);
      });
      const usage = makeUsage();
      const controller = new AbortController();
      if (mode === "aborted") controller.abort();
      const receipt = await runWithRequestDbPoolScope(true, request, () =>
        withRequestContextFromEvent({ req: request } as H3Event, async () => {
          await persistBigQueryJobUsage(usage);
          return finalizeBigQueryJobUsage(
            usage,
            "fake",
            true,
            controller.signal,
          );
        }),
      );
      expect(receipt).toMatchObject({ status: "pending" });
      expect(pool.end).not.toHaveBeenCalled();
      release(
        json(
          metadata({
            totalBytesProcessed: "123",
            totalBytesBilled: "10485760",
            cacheHit: false,
          }),
        ),
      );
      await Promise.all(background);
      await closed;
      expect(pool.end).toHaveBeenCalledOnce();
      expect(
        (
          await client.query(
            "SELECT usage_status FROM analytics_bigquery_usage",
          )
        ).rows[0],
      ).toMatchObject({ usage_status: "complete" });
    },
  );
});
