import { createHash, randomUUID } from "node:crypto";

import { checkActionProperties } from "@agent-native/core/action-properties";
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  org: "org-one",
  actor: "member@example.test",
  project: "query-project",
  ready: true,
  single: true,
  denied: false,
  secrets: new Map<string, string>(),
  states: new Map<string, Record<string, unknown>>(),
  executeRequest: vi.fn(),
}));
vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => {
    if (mocks.denied) {
      const { fail } = await import("@agent-native/core/action");
      fail("Workspace membership required.", {
        errorCode: "workspace_required",
        statusCode: 403,
      });
    }
    return mocks.org;
  },
}));
vi.mock("@agent-native/core/server/request-context", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/request-context")
  >()),
  getRequestUserEmail: () => mocks.actor,
}));
vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryProjectId: vi.fn(async () => {
    if (!mocks.ready) {
      const { fail } = await import("@agent-native/core/action");
      fail("Credentials unavailable.", {
        errorCode: "readiness_denied",
        statusCode: 403,
      });
    }
    return mocks.project;
  }),
  withOrganizationBigQueryRequestContext: vi.fn(
    async (_context: unknown, run: () => unknown) => run(),
  ),
}));
vi.mock("../server/lib/provider-api.js", () => ({
  getAnalytics2OrganizationQueryProviderApiRuntime: () => ({
    requestCapabilities: { singleAttemptUnsafeRequests: mocks.single },
    executeRequest: mocks.executeRequest,
  }),
}));
vi.mock("@agent-native/core/db", () => ({
  withDbExec: async (_transaction: unknown, run: () => unknown) => run(),
  getDbExec: () => ({
    transaction: async (run: (transaction: object) => unknown) => run({}),
  }),
}));
vi.mock("@agent-native/core/secrets", () => ({
  hasAppSecret: async (ref: { key: string; scopeId: string }) =>
    mocks.secrets.has(`${ref.scopeId}:${ref.key}`),
  readAppSecret: async (ref: { key: string; scopeId: string }) => {
    const value = mocks.secrets.get(`${ref.scopeId}:${ref.key}`);
    return value === undefined ? null : { value };
  },
  writeAppSecret: async (ref: {
    key: string;
    scopeId: string;
    value: string;
  }) => {
    mocks.secrets.set(`${ref.scopeId}:${ref.key}`, ref.value);
    return "query-continuation-slot";
  },
  deleteAppSecret: async (ref: { key: string; scopeId: string }) =>
    mocks.secrets.delete(`${ref.scopeId}:${ref.key}`),
}));
vi.mock("@agent-native/core/settings", () => ({
  getSettingEntry: async () => ({ found: false }),
  mutateSetting: vi.fn(
    async (
      key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown>,
      options?: { validateStoredValue?: (value: unknown) => void },
    ) => {
      const old = mocks.states.get(key) ?? null;
      if (old !== null) options?.validateStoredValue?.(old);
      const next = await updater(structuredClone(old));
      mocks.states.set(key, structuredClone(next));
      return structuredClone(next);
    },
  ),
}));
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";
import action from "./run-organization-warehouse-query.js";
const start = {
  operation: "start" as const,
  connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
  sql: "SELECT value FROM dataset.table",
  maxRows: 2,
};
const call = (input: unknown) =>
  action.run(input as Parameters<typeof action.run>[0], { caller: "frontend" });
function response(json: Record<string, unknown>) {
  return { response: { ok: true, status: 200, truncated: false, json } };
}
function page(
  values: string[],
  totalRows = String(values.length),
  pageToken?: string,
) {
  return response({
    jobComplete: true,
    jobReference: {
      jobId: "job-one",
      projectId: mocks.project,
      location: "US",
    },
    schema: { fields: [{ name: "value", type: "STRING" }] },
    rows: values.map((v) => ({ f: [{ v }] })),
    totalRows,
    ...(pageToken === undefined ? {} : { pageToken }),
  });
}
async function pending() {
  mocks.executeRequest.mockResolvedValueOnce(
    response({
      jobComplete: false,
      jobReference: {
        jobId: "job-one",
        projectId: mocks.project,
        location: "US",
      },
    }),
  );
  const result = await call(start);
  expect(result.status).toBe("running");
  expect(result.jobComplete).toBe(false);
  expect(result.complete).toBe(false);
  const persisted = [...mocks.states.values()][0];
  expect(persisted).not.toHaveProperty("jobId");
  expect(persisted).not.toHaveProperty("providerPage");
  expect(persisted).not.toHaveProperty("token");
  expect(persisted?.tokenHash).not.toBe(result.queryId?.split(".")[1]);
  return result.queryId as string;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.states.clear();
  mocks.secrets.clear();
  mocks.org = "org-one";
  mocks.actor = "member@example.test";
  mocks.project = "query-project";
  mocks.ready = true;
  mocks.single = true;
  mocks.denied = false;
});
describe("actual organization warehouse action frontend fixture", () => {
  it("executes the exact sentinel and returns columns and complete rows", async () => {
    mocks.executeRequest.mockResolvedValueOnce(page(["first", "last"]));
    const result = await call(start);
    expect(result).toMatchObject({
      status: "complete",
      complete: true,
      hasMore: false,
      truncated: false,
      semanticDefinitionIds: [],
      rows: [{ value: "first" }, { value: "last" }],
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
    expect(mocks.executeRequest.mock.calls[0]?.[0]).toMatchObject({
      provider: "bigquery",
      method: "POST",
      path: "projects/query-project/queries",
      maxBytes: 4_000_000,
      body: { useLegacySql: false, maximumBytesBilled: "50000000000" },
    });
    expect(mocks.executeRequest.mock.calls[0]?.[0]).not.toHaveProperty(
      "connectionId",
    );
    expect([...mocks.states.keys()][0]).not.toContain("org-one");
  });
  it("polls a pending job without repeating POST and pages to the last row", async () => {
    const queryId = await pending();
    mocks.executeRequest.mockResolvedValueOnce(
      page(["one", "two"], "3", "provider-page"),
    );
    const first = await call({ operation: "poll", queryId });
    expect(first).toMatchObject({
      status: "paging",
      complete: false,
      hasMore: true,
    });
    expect(first.nextPageToken).toBe(first.queryId);
    expect(first.nextPageToken).not.toBe("provider-page");
    mocks.executeRequest.mockResolvedValueOnce(page(["three"], "3"));
    const last = await call({ operation: "next-page", queryId: first.queryId });
    expect(last.rows).toEqual([{ value: "three" }]);
    expect(last.complete).toBe(true);
    expect(last.totalRows).toBe("3");
    expect(
      mocks.executeRequest.mock.calls.map(([input]) => input.method),
    ).toEqual(["POST", "GET", "GET"]);
    expect(mocks.executeRequest.mock.calls[2]?.[0].query.pageToken).toBe(
      "provider-page",
    );
    await expect(
      call({ operation: "next-page", queryId: first.queryId }),
    ).rejects.toMatchObject({
      errorCode: "organization_query_continuation_stale",
    });
    expect(mocks.executeRequest).toHaveBeenCalledTimes(3);
  });
  it.each(["actor", "org", "source", "expired", "token", "project"])(
    "rejects %s continuation before provider dispatch",
    async (kind) => {
      const queryId = await pending();
      const [key, state] = [...mocks.states.entries()][0] as [
        string,
        Record<string, unknown>,
      ];
      if (kind === "actor") mocks.actor = "other@example.test";
      if (kind === "org") mocks.org = "org-other";
      if (kind === "source") state.source = "different-source";
      if (kind === "expired") state.expiresAt = 0;
      if (kind === "token") state.tokenHash = "different-token";
      if (kind === "project") mocks.project = "changed-project";
      mocks.states.set(key, state);
      await expect(call({ operation: "poll", queryId })).rejects.toThrow();
      expect(mocks.executeRequest).toHaveBeenCalledTimes(1);
    },
  );
  it("rechecks readiness before every continuation", async () => {
    const queryId = await pending();
    mocks.ready = false;
    await expect(call({ operation: "poll", queryId })).rejects.toMatchObject({
      errorCode: "readiness_denied",
    });
    expect(mocks.executeRequest).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch without single-attempt transport", async () => {
    mocks.single = false;
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_single_attempt_required",
    });
    expect(mocks.executeRequest).not.toHaveBeenCalled();
    expect(mocks.states.size).toBe(0);
  });
  it("rejects a second in-flight continuation", async () => {
    const queryId = await pending();
    let finish: ((value: unknown) => void) | undefined;
    mocks.executeRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = call({ operation: "poll", queryId });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(call({ operation: "poll", queryId })).rejects.toMatchObject({
      errorCode: "organization_query_in_progress",
    });
    finish?.(page(["last"]));
    await first;
    expect(mocks.executeRequest).toHaveBeenCalledTimes(2);
  });
  it("allows explicit start after a failure without retrying the failed POST", async () => {
    mocks.executeRequest.mockResolvedValueOnce({
      response: { ok: false, status: 400, truncated: false, json: {} },
    });
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_provider_failed",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
    mocks.executeRequest.mockResolvedValueOnce(page(["retry"]));
    expect((await call(start)).rows).toEqual([{ value: "retry" }]);
    expect(mocks.executeRequest).toHaveBeenCalledTimes(2);
  });
  it("never implicitly resubmits a timed-out POST", async () => {
    mocks.executeRequest.mockRejectedValueOnce(
      new DOMException("private upstream SQL", "AbortError"),
    );
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_request_failed",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
    expect([...mocks.states.values()][0]?.state).toBe("uncertain");
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_in_progress",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
  });
  it.each([
    "truncated",
    "missing-truncation",
    "no-total",
    "no-token",
    "partial-pending",
    "malformed-cell",
    "duplicate-columns",
  ])("fails closed for %s provider response", async (kind) => {
    let result: ReturnType<typeof response> = page(["one"], "2", "page-next");
    if (kind === "truncated") result.response.truncated = true;
    if (kind === "missing-truncation")
      delete (result.response as Record<string, unknown>).truncated;
    if (kind === "no-total") delete result.response.json.totalRows;
    if (kind === "no-token") delete result.response.json.pageToken;
    if (kind === "partial-pending") result.response.json.jobComplete = false;
    if (kind === "malformed-cell") result.response.json.rows = [{ f: [{}] }];
    if (kind === "duplicate-columns")
      result.response.json.schema = {
        fields: [
          { name: "x", type: "STRING" },
          { name: "x", type: "STRING" },
        ],
      };
    mocks.executeRequest.mockResolvedValueOnce(result);
    await expect(call(start)).rejects.toThrow();
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
  });
  it("rejects changed schemas and provider page replay", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      page(["one"], "3", "provider-first"),
    );
    const first = await call(start);
    const changed = page(["two"], "3", "provider-second");
    changed.response.json.schema = {
      fields: [{ name: "different", type: "STRING" }],
    };
    mocks.executeRequest.mockResolvedValueOnce(changed);
    await expect(
      call({ operation: "next-page", queryId: first.queryId }),
    ).rejects.toMatchObject({ errorCode: "organization_query_schema_changed" });
  });
  it("reports an exhausted finite row budget as incomplete with more rows, never false completion", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      page(["one"], "50001", "provider-first"),
    );
    const first = await call(start);
    const state = [...mocks.states.values()][0];
    if (!state) throw new Error("Missing fixture state");
    state.returned = 49_999;
    mocks.executeRequest.mockResolvedValueOnce(
      page(["boundary"], "50001", "provider-next"),
    );
    const result = await call({
      operation: "next-page",
      queryId: first.queryId,
    });
    expect(result).toMatchObject({
      status: "budget_exhausted",
      complete: false,
      hasMore: true,
      truncated: true,
      nextPageToken: null,
      queryId: null,
    });
  });
  it("preserves action input/output property checks and authenticated rejection", async () => {
    mocks.denied = true;
    await checkActionProperties(action, {
      context: { caller: "frontend" },
      runs: 20,
      seed: 1107,
      overrides: {
        "/queryId": fc.constant(
          `${createHash("sha256").update(randomUUID()).digest("hex")}.${randomUUID()}`,
        ),
      },
    });
    expect(mocks.executeRequest).not.toHaveBeenCalled();
  });
  it("sanitizes hostile provider errors even with a matching application error code", async () => {
    mocks.executeRequest.mockRejectedValueOnce(
      Object.assign(new Error("private provider content"), {
        errorCode: "organization_query_hostile",
        details: { value: "private provider content" },
      }),
    );
    try {
      await call(start);
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "organization_query_request_failed",
      });
      expect(String(error)).not.toContain("private provider content");
      expect(error).not.toHaveProperty("details.value");
    }
  });
  it.each([
    ["FLOAT64", ""],
    ["FLOAT64", " "],
    ["INT64", "nonsense"],
    ["NUMERIC", "invalid decimal"],
  ])("rejects malformed %s scalar", async (type, value) => {
    const result = page([value]);
    result.response.json.schema = { fields: [{ name: "value", type }] };
    mocks.executeRequest.mockResolvedValueOnce(result);
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_malformed_result",
    });
  });
  it("preserves precise numeric strings, floating specials and repeated nested values", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      response({
        jobComplete: true,
        jobReference: { jobId: "job-one", projectId: mocks.project },
        schema: {
          fields: [
            { name: "integer", type: "INT64" },
            { name: "decimal", type: "NUMERIC" },
            { name: "float", type: "FLOAT64" },
            { name: "special", type: "FLOAT64" },
            {
              name: "nested",
              type: "RECORD",
              mode: "REPEATED",
              fields: [{ name: "flag", type: "BOOLEAN" }],
            },
          ],
        },
        rows: [
          {
            f: [
              { v: "9007199254740993" },
              { v: "0.1234567890123456789" },
              { v: "1.25" },
              { v: "NaN" },
              { v: [{ v: { f: [{ v: "true" }] } }] },
            ],
          },
        ],
        totalRows: "1",
      }),
    );
    expect((await call(start)).rows).toEqual([
      {
        integer: "9007199254740993",
        decimal: "0.1234567890123456789",
        float: 1.25,
        special: "NaN",
        nested: [{ flag: true }],
      },
    ]);
  });
  it("rejects duplicate nested record fields", async () => {
    const result = page(["one"]);
    result.response.json.schema = {
      fields: [
        {
          name: "value",
          type: "RECORD",
          fields: [
            { name: "duplicate", type: "STRING" },
            { name: "duplicate", type: "STRING" },
          ],
        },
      ],
    };
    mocks.executeRequest.mockResolvedValueOnce(result);
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_schema_unreadable",
    });
  });
  it("rejects a provider page token repeated across a longer cycle", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      page(["one"], "4", "page-first"),
    );
    const first = await call(start);
    mocks.executeRequest.mockResolvedValueOnce(
      page(["two"], "4", "page-second"),
    );
    const second = await call({
      operation: "next-page",
      queryId: first.queryId,
    });
    mocks.executeRequest.mockResolvedValueOnce(
      page(["three"], "4", "page-first"),
    );
    await expect(
      call({ operation: "next-page", queryId: second.queryId }),
    ).rejects.toMatchObject({ errorCode: "organization_query_page_repeated" });
  });
  it("rejects a vault payload swapped from another member before provider dispatch", async () => {
    const queryId = await pending();
    const entry = [...mocks.secrets.entries()][0];
    if (!entry) throw new Error("Missing vault fixture");
    const payload = JSON.parse(entry[1]);
    payload.actor = "other@example.test";
    mocks.secrets.set(entry[0], JSON.stringify(payload));
    await expect(call({ operation: "poll", queryId })).rejects.toMatchObject({
      errorCode: "organization_query_continuation_forbidden",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
  });
  it("refuses an altered vault reference before reading provider continuation", async () => {
    const queryId = await pending();
    const state = [...mocks.states.values()][0];
    if (!state) throw new Error("Missing state fixture");
    state.continuationRef = "foreign-query-reference";
    await expect(call({ operation: "poll", queryId })).rejects.toMatchObject({
      errorCode: "organization_query_continuation_forbidden",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
  });
  it("stores provider paging material only in the scoped vault and removes it when complete", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      page(["first"], "2", "provider-page-marker"),
    );
    const first = await call(start);
    const state = [...mocks.states.values()][0];
    expect(JSON.stringify(state)).not.toContain("provider-page-marker");
    expect(JSON.stringify(state)).not.toContain("job-one");
    expect(state).not.toHaveProperty("token");
    expect(
      [...mocks.secrets.values()].some((value) =>
        value.includes("provider-page-marker"),
      ),
    ).toBe(true);
    mocks.executeRequest.mockResolvedValueOnce(page(["last"], "2"));
    await call({ operation: "next-page", queryId: first.queryId });
    expect(mocks.secrets.size).toBe(0);
  });
  it("returns a bounded typed quota failure and permits an explicit retry after HTTP429", async () => {
    mocks.executeRequest.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 429,
        truncated: false,
        headers: { "retry-after": "99999999" },
        json: {
          error: "provider_quota_exhausted",
          retryAt: "private provider target",
          message: "private provider content",
        },
      },
    });
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_quota_cooldown",
      statusCode: 429,
      details: { retryAfterMs: 3_600_000 },
    });
    expect([...mocks.states.values()][0]?.state).toBe("failed");
    mocks.executeRequest.mockResolvedValueOnce(page(["retry"]));
    expect((await call(start)).rows).toEqual([{ value: "retry" }]);
    expect(mocks.executeRequest).toHaveBeenCalledTimes(2);
  });
  it.each([
    [403, "accessDenied"],
    [404, "notFound"],
    [400, "invalidQuery"],
  ])(
    "report SAYA-1117-ADHOC-WAREHOUSE-DIAGNOSTICS: reports a safe reason for HTTP %i",
    async (status, reason) => {
      mocks.executeRequest.mockResolvedValueOnce({
        response: {
          ok: false,
          status,
          truncated: false,
          json: {
            error: {
              errors: [{ reason, message: "private query and credential" }],
            },
          },
        },
      });
      await expect(call(start)).rejects.toMatchObject({
        errorCode: "organization_query_provider_failed",
        details: { providerStatus: status, providerReason: reason },
      });
    },
  );
  it("does not disclose unrecognized provider error content", async () => {
    mocks.executeRequest.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 400,
        truncated: false,
        json: {
          error: {
            errors: [{ reason: "private-secret", message: "private-query" }],
          },
        },
      },
    });
    const error = await call(start).catch((value) => value);
    expect(error).toMatchObject({
      details: { providerStatus: 400, providerReason: null },
    });
    expect(JSON.stringify(error)).not.toContain("private-");
  });
  it("allows an explicit start after a completed provider job reports errors", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      response({
        jobComplete: true,
        errors: [{ reason: "invalidQuery", message: "private query text" }],
      }),
    );
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_provider_failed",
      details: { providerStatus: 200, providerReason: "invalidQuery" },
    });
    expect([...mocks.states.values()][0]?.state).toBe("failed");
    mocks.executeRequest.mockResolvedValueOnce(page(["retry"]));
    expect((await call(start)).rows).toEqual([{ value: "retry" }]);
  });
  it("keeps errors from a still-running job uncertain and does not resubmit it", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      response({
        jobComplete: false,
        errors: [{ message: "provider still processing" }],
      }),
    );
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_provider_failed",
    });
    expect([...mocks.states.values()][0]?.state).toBe("uncertain");
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_in_progress",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
  });
  it("returns a poll reference with no page token while the provider job is running", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      response({
        jobComplete: false,
        jobReference: { jobId: "job-one", projectId: mocks.project },
      }),
    );
    const result = await call(start);
    expect(result.queryId).toEqual(expect.any(String));
    expect(result.status).toBe("running");
    expect(result.nextPageToken).toBeNull();
  });
  it("removes its transient vault payload when a continuation fails", async () => {
    const queryId = await pending();
    expect(mocks.secrets.size).toBe(1);
    mocks.executeRequest.mockResolvedValueOnce({
      response: { ok: false, status: 400, truncated: false, json: {} },
    });
    await expect(call({ operation: "poll", queryId })).rejects.toMatchObject({
      errorCode: "organization_query_provider_failed",
    });
    expect(mocks.secrets.size).toBe(0);
    expect([...mocks.states.values()][0]?.continuationRef).toBeNull();
  });
  it.each([undefined, "not-a-delay", "-5", "12345678901234567890"])(
    "reports unknown quota retry timing as unknown for %s",
    async (header) => {
      mocks.executeRequest.mockResolvedValueOnce({
        response: {
          ok: false,
          status: 429,
          truncated: false,
          headers: header === undefined ? {} : { "retry-after": header },
          json: { message: "private provider detail" },
        },
      });
      await expect(call(start)).rejects.toMatchObject({
        errorCode: "organization_query_quota_cooldown",
        statusCode: 429,
        details: { retryAfterMs: null, retryAt: null },
      });
    },
  );
  it("keeps a trusted completed job terminal even when its returned schema is malformed", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      response({
        jobComplete: true,
        jobReference: { jobId: "job-one", projectId: mocks.project },
        schema: { fields: [] },
        rows: [],
        totalRows: "0",
      }),
    );
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_schema_unreadable",
    });
    expect([...mocks.states.values()][0]?.state).toBe("failed");
    mocks.executeRequest.mockResolvedValueOnce(page(["retry"]));
    expect((await call(start)).rows).toEqual([{ value: "retry" }]);
  });
  it("does not treat completion in an HTTP-truncated response as a trusted terminal job", async () => {
    const result = page(["one"]);
    result.response.truncated = true;
    mocks.executeRequest.mockResolvedValueOnce(result);
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_response_truncated",
    });
    expect([...mocks.states.values()][0]?.state).toBe("uncertain");
    await expect(call(start)).rejects.toMatchObject({
      errorCode: "organization_query_in_progress",
    });
    expect(mocks.executeRequest).toHaveBeenCalledOnce();
  });
  it("retains a pending query and its exact opaque poll reference after quota429", async () => {
    const queryId = await pending();
    const previousState = structuredClone([...mocks.states.values()][0]);
    const previousVault = [...mocks.secrets.entries()];
    mocks.executeRequest.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 429,
        truncated: false,
        headers: { "retry-after": "0" },
        json: {},
      },
    });
    await expect(call({ operation: "poll", queryId })).rejects.toMatchObject({
      errorCode: "organization_query_quota_cooldown",
      statusCode: 429,
    });
    expect([...mocks.states.values()][0]).toEqual(previousState);
    expect([...mocks.secrets.entries()]).toEqual(previousVault);
    mocks.executeRequest.mockResolvedValueOnce(page(["last"]));
    expect((await call({ operation: "poll", queryId })).rows).toEqual([
      { value: "last" },
    ]);
    expect(
      mocks.executeRequest.mock.calls.map(([input]) => input.method),
    ).toEqual(["POST", "GET", "GET"]);
  });
  it("retains the paging cursor and retries the same opaque reference after quota429", async () => {
    mocks.executeRequest.mockResolvedValueOnce(
      page(["first"], "2", "provider-next"),
    );
    const first = await call(start);
    const previousState = structuredClone([...mocks.states.values()][0]);
    const previousVault = [...mocks.secrets.entries()];
    mocks.executeRequest.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 429,
        truncated: false,
        headers: { "retry-after": "0" },
        json: {},
      },
    });
    await expect(
      call({ operation: "next-page", queryId: first.queryId }),
    ).rejects.toMatchObject({
      errorCode: "organization_query_quota_cooldown",
      statusCode: 429,
    });
    expect([...mocks.states.values()][0]).toEqual(previousState);
    expect([...mocks.secrets.entries()]).toEqual(previousVault);
    mocks.executeRequest.mockResolvedValueOnce(page(["last"], "2"));
    const last = await call({ operation: "next-page", queryId: first.queryId });
    expect(last.rows).toEqual([{ value: "last" }]);
    expect(last.complete).toBe(true);
    expect(
      mocks.executeRequest.mock.calls.map(([input]) => input.method),
    ).toEqual(["POST", "GET", "GET"]);
    expect(mocks.executeRequest.mock.calls[2]?.[0].query.pageToken).toBe(
      "provider-next",
    );
  });

  it("keeps an unknown GET failure resumable while sanitizing a provider-spoofed quota error", async () => {
    const queryId = await pending();
    const priorState = structuredClone([...mocks.states.values()][0]);
    const priorVault = [...mocks.secrets.entries()];
    mocks.executeRequest.mockRejectedValueOnce(
      Object.assign(new Error("private provider marker"), {
        errorCode: "organization_query_quota_cooldown",
        statusCode: 429,
        details: { rawProvider: "private provider marker" },
      }),
    );
    let caught: unknown;
    try {
      await call({ operation: "poll", queryId });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      errorCode: "organization_query_request_failed",
    });
    expect(String(caught)).not.toContain("private provider marker");
    expect(caught).not.toHaveProperty("details.rawProvider");
    expect([...mocks.states.values()][0]).toEqual(priorState);
    expect([...mocks.secrets.entries()]).toEqual(priorVault);
    mocks.executeRequest.mockResolvedValueOnce(page(["last"]));
    expect((await call({ operation: "poll", queryId })).rows).toEqual([
      { value: "last" },
    ]);
    expect(
      mocks.executeRequest.mock.calls.map(([input]) => input.method),
    ).toEqual(["POST", "GET", "GET"]);
  });
  it.each(["network", "503", "truncated", "malformed"])(
    "preserves a read-safe GET continuation after %s failure for an explicit retry",
    async (kind) => {
      mocks.executeRequest.mockResolvedValueOnce(
        page(["first"], "2", "provider-next"),
      );
      const first = await call(start);
      const previousState = structuredClone([...mocks.states.values()][0]);
      const previousVault = [...mocks.secrets.entries()];
      const expectedCode = {
        network: "organization_query_request_failed",
        "503": "organization_query_provider_failed",
        truncated: "organization_query_response_truncated",
        malformed: "organization_query_schema_unreadable",
      }[kind];
      if (kind === "network")
        mocks.executeRequest.mockRejectedValueOnce(
          new DOMException("controlled GET timeout", "AbortError"),
        );
      if (kind === "503")
        mocks.executeRequest.mockResolvedValueOnce({
          response: { ok: false, status: 503, truncated: false, json: {} },
        });
      if (kind === "truncated") {
        const result = page(["last"], "2");
        result.response.truncated = true;
        mocks.executeRequest.mockResolvedValueOnce(result);
      }
      if (kind === "malformed")
        mocks.executeRequest.mockResolvedValueOnce(
          response({
            jobComplete: true,
            jobReference: { jobId: "job-one", projectId: mocks.project },
            schema: { fields: [] },
            rows: [],
            totalRows: "2",
          }),
        );
      await expect(
        call({ operation: "next-page", queryId: first.queryId }),
      ).rejects.toMatchObject({ errorCode: expectedCode });
      expect([...mocks.states.values()][0]).toEqual(previousState);
      expect([...mocks.secrets.entries()]).toEqual(previousVault);
      mocks.executeRequest.mockResolvedValueOnce(page(["last"], "2"));
      const last = await call({
        operation: "next-page",
        queryId: first.queryId,
      });
      expect(last.rows).toEqual([{ value: "last" }]);
      expect(last.complete).toBe(true);
      expect(
        mocks.executeRequest.mock.calls.map(([input]) => input.method),
      ).toEqual(["POST", "GET", "GET"]);
    },
  );

  it.each([
    [400, "bytesBilledLimitExceeded", /add-project-cell/],
    [400, "responseTooLarge", /LIMIT|aggregate/i],
  ])(
    "report SAYA-1117-ADHOC-WAREHOUSE: preserves safe reason %s without leaking provider message",
    async (status, reason, guidance) => {
      mocks.executeRequest.mockResolvedValueOnce({
        response: {
          ok: false,
          status,
          truncated: false,
          json: {
            error: {
              errors: [{ reason, message: "private-table-and-credential" }],
            },
          },
        },
      });
      const error = await call(start).catch((value) => value);
      expect(error).toMatchObject({
        errorCode: "organization_query_provider_failed",
        details: { providerStatus: status, providerReason: reason },
      });
      expect((error as Error).message).toMatch(guidance);
      expect(JSON.stringify(error)).not.toContain("private-table");
    },
  );

  it.each(["mcp", "webmcp", "a2a"] as const)(
    "report SAYA-1117-ADHOC-WAREHOUSE: routes %s callers to saved warehouse connections when org credentials are missing",
    async (caller) => {
      const { requireOrganizationBigQueryProjectId } =
        await import("../server/lib/org-bigquery-credentials.js");
      const { fail } = await import("@agent-native/core/action");
      vi.mocked(requireOrganizationBigQueryProjectId).mockRejectedValueOnce(
        (() => {
          try {
            fail("Organization BigQuery credentials are not configured.", {
              errorCode: "bigquery_org_credentials_missing",
              statusCode: 409,
            });
          } catch (error) {
            return error;
          }
        })(),
      );
      await expect(action.run(start, { caller })).rejects.toMatchObject({
        errorCode: "bigquery_org_credentials_missing",
        details: { nextRequiredAction: "add-project-cell" },
      });
    },
  );
});
