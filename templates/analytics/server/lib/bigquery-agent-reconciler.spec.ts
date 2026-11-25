import { afterEach, describe, expect, it, vi } from "vitest";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async () => {
      throw new Error("no database in this spec");
    },
  }),
}));
vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => undefined,
  getRequestRunContext: () => undefined,
  platformWaitUntil: () => undefined,
}));
vi.mock("./credentials", () => ({ resolveCredential: async () => null }));

const { createBigQueryAgentReconciler, runBoundedBigQueryJob } =
  await import("./bigquery");

const PRINCIPAL =
  "sa:runner@builder-3b0a2.iam.gserviceaccount.com#0a1b2c3d4e5f6a7b";
const TARGET = "agent_native_target";
const job = {
  requestId: "request-1",
  projectId: "builder-3b0a2",
  jobId: TARGET,
  location: null,
  credentialScope: "o:org-1:default",
  credentialFingerprint: PRINCIPAL,
  createdAt: "2026-11-17T12:00:00.000Z",
  submissionState: "unknown",
};
const reconciler = createBigQueryAgentReconciler("test-token", {
  credentialScope: job.credentialScope,
  credentialFingerprint: PRINCIPAL,
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

const listing = (jobs: unknown[], extra: Record<string, unknown> = {}) =>
  json({ kind: "bigquery#jobList", etag: "e", jobs, ...extra });
const other = { jobReference: { jobId: "agent_native_other", location: "US" } };

function stubBigQuery(
  pages: Array<() => Response>,
  located: string | null = null,
) {
  const listed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/jobs")) {
        listed.push(url.searchParams.get("pageToken") ?? "");
        return must(pages[listed.length - 1], "Listed past the last page")();
      }
      if (url.pathname.endsWith(`/jobs/${TARGET}`)) {
        if (located && url.searchParams.get("location") === located) {
          return json({
            jobReference: {
              projectId: job.projectId,
              jobId: TARGET,
              location: located,
            },
            status: { state: "DONE" },
            statistics: {
              query: {
                totalBytesBilled: "10485760",
                cacheHit: false,
                statementType: "SELECT",
              },
            },
          });
        }
        return json({ error: { code: 404 } }, 404);
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );
  return listed;
}

const observe = (mayConfirmAbsence: boolean) =>
  reconciler.observe(job, AbortSignal.timeout(5_000), { mayConfirmAbsence });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confirming an outside agent's job with BigQuery", () => {
  it("proves a job absent only from a complete, well-formed listing by the principal that sent it", async () => {
    stubBigQuery([() => listing([other])]);
    expect(await observe(true)).toEqual({ kind: "absent" });
    stubBigQuery([() => listing([other])]);
    expect(await observe(false)).toEqual({ kind: "not_found" });
  });

  it("keeps a job the listing shows without a location, rather than calling it absent", async () => {
    stubBigQuery([() => listing([other, { jobReference: { jobId: TARGET } }])]);
    expect(await observe(true)).toEqual({ kind: "unreadable" });
  });

  it("reads the billing of a job the listing locates", async () => {
    stubBigQuery(
      [
        () =>
          listing([
            other,
            { jobReference: { jobId: TARGET, location: "asia-northeast1" } },
          ]),
      ],
      "asia-northeast1",
    );
    expect(await observe(true)).toMatchObject({
      kind: "found",
      state: "DONE",
      billedBytes: 10_485_760,
      statementType: "SELECT",
      location: "asia-northeast1",
    });
  });

  it.each([
    ["an empty object", () => json({})],
    ["a job list without its kind", () => json({ jobs: [] })],
    ["text that is not JSON", () => new Response("<html>oops</html>")],
    [
      "jobs that are not a list",
      () => json({ kind: "bigquery#jobList", jobs: {} }),
    ],
    [
      "a job without a readable ID",
      () => listing([other, { jobReference: {} }]),
    ],
    [
      "a job that is not an object",
      () => listing([other, "agent_native_target"]),
    ],
    [
      "skipped unreachable locations",
      () => listing([other], { unreachable: ["asia-east1"] }),
    ],
    ["an unreadable next page token", () => listing([], { nextPageToken: 5 })],
    ["an HTTP error", () => json({ error: { code: 500 } }, 500)],
  ])(
    "never calls a job absent from a listing page with %s",
    async (_label, page) => {
      stubBigQuery([page]);
      expect(await observe(true)).toEqual({ kind: "unreadable" });
    },
  );

  it("reads every page before calling a job absent", async () => {
    const listed = stubBigQuery([
      () => listing([other], { nextPageToken: "page-2" }),
      () => listing([]),
    ]);
    expect(await observe(true)).toEqual({ kind: "absent" });
    expect(listed).toEqual(["", "page-2"]);
  });

  it("finds a job on a later page", async () => {
    stubBigQuery(
      [
        () => listing([other], { nextPageToken: "page-2" }),
        () => listing([{ jobReference: { jobId: TARGET, location: "EU" } }]),
      ],
      "EU",
    );
    expect(await observe(true)).toMatchObject({ kind: "found" });
  });

  it("keeps the job when a later page cannot be read", async () => {
    stubBigQuery([
      () => listing([other], { nextPageToken: "page-2" }),
      () => json({ error: { code: 503 } }, 503),
    ]);
    expect(await observe(true)).toEqual({ kind: "unreadable" });
  });
});

describe("a bounded job's one resend", () => {
  const accepted = () =>
    json({ jobReference: { projectId: job.projectId, jobId: TARGET } });
  const refusals: Array<[string, () => Response]> = [
    [
      "access denied",
      () =>
        json(
          {
            error: {
              code: 403,
              errors: [{ reason: "accessDenied", message: "Access Denied" }],
            },
          },
          403,
        ),
    ],
    [
      "over its bytes billed",
      () =>
        json(
          {
            error: {
              code: 400,
              message: "Query exceeded limit for bytes billed: 10485760.",
              errors: [{ reason: "bytesBilledLimitExceeded" }],
            },
          },
          400,
        ),
    ],
  ];

  function stubAmbiguousSubmit(
    resend: () => Response = accepted,
    onFirstSend: () => void = () => undefined,
  ) {
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === "POST" && url.pathname.endsWith("/jobs")) {
          sent.push(JSON.parse(String(init.body)).jobReference.jobId);
          if (sent.length === 1) {
            onFirstSend();
            throw new TypeError("fetch failed");
          }
          return resend();
        }
        if (url.pathname.endsWith(`/jobs/${TARGET}`)) {
          return json({ error: { code: 404 } }, 404);
        }
        if (url.pathname.includes("/queries/")) {
          return json({
            jobComplete: true,
            schema: { fields: [{ name: "n", type: "INT64" }] },
            totalRows: "1",
            rows: [{ f: [{ v: "1" }] }],
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    return sent;
  }

  const run = (
    submitBy: number,
    admittedOnUtcDay = new Date().toISOString().slice(0, 10),
  ) =>
    runBoundedBigQueryJob({
      projectId: job.projectId,
      jobId: TARGET,
      sql: "SELECT 1 AS n",
      maximumBytesBilled: 10_485_760,
      token: "test-token",
      signal: AbortSignal.timeout(5_000),
      maxRows: 10,
      maxResultBytes: 10_000,
      submitBy,
      admittedOnUtcDay,
    });

  it("resends under the same ID while its admission is live", async () => {
    const sent = stubAmbiguousSubmit();
    expect(await run(Date.now() + 60_000)).toMatchObject({
      status: "completed",
    });
    expect(sent).toEqual([TARGET, TARGET]);
  });

  it("does not resend once its admission has lapsed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const sent = stubAmbiguousSubmit(accepted, () =>
        vi.setSystemTime(Date.now() + 120_000),
      );
      expect(await run(Date.now() + 60_000)).toMatchObject({
        status: "uncertain",
        reason: "submission_unknown",
      });
      expect(sent).toEqual([TARGET]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the outcome uncertain when the resend hits a quota limit and BigQuery can't find the job, since the first send may still land", async () => {
    const sent = stubAmbiguousSubmit(() =>
      json(
        {
          error: {
            code: 403,
            message: "Quota exceeded",
            errors: [{ reason: "quotaExceeded", message: "Quota exceeded" }],
          },
        },
        403,
      ),
    );
    expect(await run(Date.now() + 60_000)).toMatchObject({
      status: "uncertain",
      reason: "submission_unknown",
    });
    expect(sent).toEqual([TARGET, TARGET]);
  });

  it("does not resend once the UTC day it was admitted on has ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-22T23:59:59.500Z"));
      const sent = stubAmbiguousSubmit(accepted, () =>
        vi.setSystemTime(new Date("2026-11-23T00:00:00.500Z")),
      );
      expect(await run(Date.now() + 60_000, "2026-11-22")).toMatchObject({
        status: "uncertain",
        reason: "submission_unknown",
      });
      expect(sent).toEqual([TARGET]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes no first send once the UTC day it was admitted on has ended", async () => {
    const sent = stubAmbiguousSubmit();
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    expect(await run(Date.now() + 60_000, yesterday)).toEqual({
      status: "not_submitted",
      reason: "day_changed",
    });
    expect(sent).toEqual([]);
  });

  it("makes no first send once its admission has lapsed", async () => {
    const sent = stubAmbiguousSubmit();
    expect(await run(Date.now() - 1)).toEqual({
      status: "not_submitted",
      reason: "admission_lapsed",
    });
    expect(sent).toEqual([]);
  });

  it.each(refusals)(
    "keeps the outcome uncertain when the resend is refused for %s, since the first send may have created the job",
    async (_label, refusal) => {
      const sent = stubAmbiguousSubmit(refusal);
      expect(await run(Date.now() + 60_000)).toMatchObject({
        status: "uncertain",
        reason: "submission_unknown",
      });
      expect(sent).toEqual([TARGET, TARGET]);
    },
  );

  it.each(refusals)(
    "reports a refused first send, %s, as a rejection",
    async (_label, refusal) => {
      const sent: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          sent.push(JSON.parse(String(init?.body)).jobReference.jobId);
          return refusal();
        }),
      );
      expect(await run(Date.now() + 60_000)).toMatchObject({
        status: "rejected",
      });
      expect(sent).toEqual([TARGET]);
    },
  );
});
