import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BigQueryAgentBudgetSnapshot } from "../server/lib/bigquery-agent-budget.js";
import type { OutsideAgentBigQueryReport } from "../server/lib/bigquery-agent-calls.js";
import type {
  BigQueryAgentQueryInput,
  BigQueryAgentQueryResult,
} from "../server/lib/bigquery-agent-runner.js";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  decide: vi.fn(),
  release: vi.fn(),
  allowanceBudget: vi.fn(),
  askAbout: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: <T>(definition: T) => definition,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "alice@example.com",
  getRequestOrgId: () => "org-1",
}));
vi.mock("../server/lib/bigquery-agent-runner.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/bigquery-agent-runner.js")
  >()),
  runBigQueryAgentQuery: mocks.run,
  decideBigQueryAgentQuery: mocks.decide,
  releaseBigQueryAgentDecision: mocks.release,
}));
vi.mock("../server/lib/bigquery-agent-approval.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/bigquery-agent-approval.js")
  >()),
  allowanceBudget: mocks.allowanceBudget,
  allowanceToAskAbout: mocks.askAbout,
  recordReviewedAllowance: mocks.record,
}));

const { default: action } = await import("./query-warehouse.js");
const {
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} = await import("../server/lib/bigquery-agent-budget.js");
const { BIGQUERY_AGENT_SQL_POLICY_VERSION } =
  await import("../server/lib/bigquery-agent-sql-policy.js");
const { startBigQueryAgentDeadline } =
  await import("../server/lib/bigquery-agent-runner.js");
const { runWithRequestContext } = await import("@agent-native/core/server");

function invocation<T>(work: () => Promise<T>): Promise<T> {
  return Promise.resolve(
    runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      work,
    ),
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const SQL =
  "SELECT DATE_TRUNC(DATE(created_at), WEEK) AS week, COUNT(*) AS signups FROM `builder-3b0a2.dbt_mart.users` GROUP BY week";
const TABLE = "builder-3b0a2.dbt_mart.users";
const GIB = 1024 ** 3;
const MCP = { caller: "mcp", userEmail: "alice@example.com", orgId: "org-1" };

const report: OutsideAgentBigQueryReport = {
  thisCall: {
    jobsAdmitted: 1,
    reservedUsd: 0.0069,
    billedUsd: 0.0031,
    stillReservedUsd: 0,
    cacheHits: 0,
  },
  jobs: [],
  today: null,
};

function completed(
  rows: Record<string, unknown>[],
  extra: Partial<
    Extract<BigQueryAgentQueryResult, { status: "completed" }>
  > = {},
): BigQueryAgentQueryResult {
  return {
    status: "completed",
    code: "ready",
    jobId: "agent_native_mcp_1",
    projectId: "builder-3b0a2",
    location: "US",
    executedSql: SQL,
    referencedTables: [TABLE],
    rows,
    schema: [
      { name: "week", type: "DATE" },
      { name: "signups", type: "INT64" },
    ],
    rowCount: rows.length,
    truncated: false,
    truncation: null,
    bytesProcessed: GIB,
    cost: {
      estimatedBytes: GIB,
      estimatedUsd: 0.0061,
      reservedBytes: GIB,
      reservedUsd: 0.0069,
      billedBytes: GIB,
      billedUsd: 0.0061,
      providerCacheHit: false,
    },
    report,
    ...extra,
  } as BigQueryAgentQueryResult;
}

function budgetWith(usedBytes: number): BigQueryAgentBudgetSnapshot {
  const scope = (limitBytes: number) => ({
    limitBytes,
    settledBytes: usedBytes,
    reservedBytes: 0,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
  });
  return {
    utcDay: "2026-11-22",
    resetsAt: "2026-11-23T00:00:00.000Z",
    jobCapBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
    person: {
      ...scope(OUTSIDE_AGENT_PERSON_BASE_BYTES),
      baseAllowanceBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
      ceilingBytes: OUTSIDE_AGENT_PERSON_CEILING_BYTES,
      approvedToday: false,
    },
    org: scope(8_796_093_022_208),
    limitsSource: { person: "default", org: "default" },
  };
}

async function runWith(
  args: Record<string, unknown>,
  context: Partial<ActionRunContext> = MCP,
) {
  return action.run(
    action.schema.parse({ sql: SQL, ...args }),
    context as ActionRunContext,
  );
}

async function thrown(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return error as Error & {
      errorCode?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
    };
  }
  throw new Error("Expected the call to fail");
}

beforeEach(() => {
  for (const mock of [
    mocks.run,
    mocks.decide,
    mocks.release,
    mocks.allowanceBudget,
    mocks.askAbout,
    mocks.record,
  ]) {
    mock.mockReset();
  }
  mocks.run.mockImplementation(async () =>
    completed([{ week: "2026-11-16", signups: 42 }]),
  );
});

describe("query-warehouse results", () => {
  it("returns ok with the rows, the SQL that ran, the tables it read, its bytes and the budget report", async () => {
    expect(await runWith({})).toEqual({
      status: "ok",
      executedSql: SQL,
      referencedTables: [TABLE],
      bytesProcessed: GIB,
      rowCount: 1,
      truncated: false,
      truncation: null,
      columns: [
        { name: "week", type: "DATE" },
        { name: "signups", type: "INT64" },
      ],
      rows: [{ week: "2026-11-16", signups: 42 }],
      jobId: "agent_native_mcp_1",
      location: "US",
      policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
      bigQueryBudget: report,
    });
  });

  it("returns empty, not ok, for a query that ran and matched no rows", async () => {
    mocks.run.mockResolvedValue(completed([]));
    expect(await runWith({})).toMatchObject({
      status: "empty",
      rowCount: 0,
      rows: [],
      truncated: false,
    });
  });

  it("keeps the truncation flag a capped result came back with", async () => {
    mocks.run.mockResolvedValue(
      completed([{ week: "2026-11-16", signups: 1 }], {
        truncated: true,
        truncation: "rows",
      }),
    );
    expect(await runWith({ maxRows: 1 })).toMatchObject({
      status: "ok",
      truncated: true,
      truncation: "rows",
    });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ maxRows: 1 }),
    );
  });

  it("dry-runs without billing: validates, estimates and returns no rows", async () => {
    mocks.run.mockResolvedValue({
      status: "ready",
      code: "ready",
      executedSql: SQL,
      referencedTables: [TABLE],
      bytesProcessed: GIB,
      location: "US",
      schema: [{ name: "signups", type: "INT64" }],
      cost: {
        estimatedBytes: GIB,
        estimatedUsd: 0.0061,
        reservedBytes: GIB,
        reservedUsd: 0.0069,
      },
      budgetCheck: null,
      report: { ...report, thisCall: { ...report.thisCall, jobsAdmitted: 0 } },
      message: "Estimated $0.01. Nothing ran.",
    } satisfies BigQueryAgentQueryResult);
    expect(await runWith({ dryRun: true })).toMatchObject({
      status: "estimated",
      executedSql: SQL,
      referencedTables: [TABLE],
      bytesProcessed: GIB,
      rowCount: 0,
      rows: [],
      columns: [{ name: "signups", type: "INT64" }],
      jobId: null,
      estimate: {
        estimatedUsd: 0.0061,
        reservedUsd: 0.0069,
        budgetCheck: null,
      },
    });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ estimateOnly: true }),
    );
  });

  it("rejects a row limit above 5,000", () => {
    expect(() => action.schema.parse({ sql: SQL, maxRows: 5_001 })).toThrow();
  });
});

describe("query-warehouse failures", () => {
  it.each([
    ["refused", "query_statement_not_allowed", 422],
    ["refused", "query_table_not_allowed", 403],
    ["refused", "query_feature_not_allowed", 422],
    ["refused", "query_invalid", 400],
    ["refused", "query_timeout", 504],
    ["refused", "approval_required", 429],
    ["refused", "budget_exhausted", 429],
    ["refused", "over_job_cap", 422],
    ["refused", "budget_unavailable", 503],
    ["refused", "estimate_unavailable", 503],
    ["refused", "query_quota_exceeded", 429],
    ["failed", "query_bytes_cap_exceeded", 422],
    ["failed", "query_row_too_large", 422],
    ["failed", "query_quota_exceeded", 429],
    ["failed", "query_failed", 502],
    ["failed", "execution_record_unavailable", 503],
    ["uncertain", "query_timeout", 504],
    ["uncertain", "job_outcome_unknown", 502],
  ] as const)(
    "throws a %s %s as its own code, with no rows",
    async (status, code, statusCode) => {
      mocks.run.mockResolvedValue({
        status,
        code,
        message: `the ${code} message`,
        jobId: status === "refused" ? undefined : "agent_native_mcp_1",
        cost: null,
        report,
      } as unknown as BigQueryAgentQueryResult);
      const error = await thrown(() => runWith({}));
      expect(error).toMatchObject({ errorCode: code, statusCode });
      expect(error.message).toContain(`the ${code} message`);
      expect(error.details).toMatchObject({
        bigQueryBudget: report,
        policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
      });
      expect(JSON.stringify(error.details)).not.toContain("rows");
    },
  );
});

describe("query-warehouse callers", () => {
  it("asks through itself over MCP, and records a review-page approval only once its checks pass", async () => {
    await runWith({});
    const input = mocks.run.mock.calls[0]?.[0] as BigQueryAgentQueryInput;
    expect(input).toMatchObject<Partial<BigQueryAgentQueryInput>>({
      sql: SQL,
      source: "query-warehouse",
      caller: "mcp",
      askVia: "query-warehouse",
      estimateOnly: false,
    });
    expect(mocks.record).not.toHaveBeenCalled();
    await must(input.beforeAdmission)();
    expect(mocks.record).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
  });

  it("over A2A, where nothing can ask, runs without an ask route", async () => {
    await runWith({}, { ...MCP, caller: "a2a" });
    const input = mocks.run.mock.calls[0]?.[0] as BigQueryAgentQueryInput;
    expect(input.caller).toBe("a2a");
    expect(input).not.toHaveProperty("askVia");
  });

  it("records no approval for a dry run, which bills nothing", async () => {
    mocks.run.mockResolvedValue({
      status: "ready",
      code: "ready",
      executedSql: SQL,
      referencedTables: [TABLE],
      bytesProcessed: 0,
      location: "US",
      schema: [],
      cost: {
        estimatedBytes: 0,
        estimatedUsd: 0,
        reservedBytes: 0,
        reservedUsd: 0,
      },
      budgetCheck: null,
      report,
      message: "Nothing ran.",
    } satisfies BigQueryAgentQueryResult);
    await runWith({ dryRun: true });
    expect(mocks.run.mock.calls[0]?.[0]).not.toHaveProperty("beforeAdmission");
  });
});

describe("query-warehouse asks once past $1", () => {
  let sql = SQL;
  let sequence = 0;
  beforeEach(() => {
    sequence++;
    sql = `${SQL} -- call ${sequence}`;
  });
  // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
  const args = (extra: Record<string, unknown> = {}) =>
    action.schema.parse({ sql, ...extra });
  const ask = (extra: Record<string, unknown> = {}) =>
    action.mcpNeedsApproval(args(extra), MCP as ActionRunContext);
  const notice = () =>
    action.approvalNotice(args(), {
      ...MCP,
      actionName: "query-warehouse",
      askedAt: Date.now(),
    } as never);
  const decision = (extra: Record<string, unknown>) => ({
    deadline: startBigQueryAgentDeadline(),
    identity: { ownerEmail: "alice@example.com", orgId: "org-1" },
    ...extra,
  });

  it("never asks about a dry run", async () => {
    expect(await ask({ dryRun: true })).toBe(false);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("asks exactly when the decision says this call needs the person's approval", async () => {
    mocks.decide.mockResolvedValue(
      decision({ status: "admitted", needsApproval: false }),
    );
    expect(await ask()).toBe(false);
    mocks.decide.mockResolvedValue(
      decision({ status: "ask", needsApproval: true, reservedBytes: 33 * GIB }),
    );
    expect(await ask()).toBe(true);
    // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
    expect(mocks.decide).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sql,
        source: "query-warehouse",
        caller: "mcp",
        askVia: "query-warehouse",
        deadline: expect.objectContaining({ signal: expect.any(AbortSignal) }),
      }),
    );
  });

  it("never asks when deciding fails, because a throw would ask", async () => {
    mocks.decide.mockRejectedValue(new Error("connection reset"));
    expect(await ask()).toBe(false);
  });

  it("hands the run the plan, reservation and deadline its approval decision made", async () => {
    const decided = decision({ status: "admitted", needsApproval: false });
    mocks.decide.mockResolvedValue(decided);
    await invocation(async () => {
      expect(await ask()).toBe(false);
      // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
      await runWith({ sql });
    });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ decided }),
    );
    // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
    await invocation(() => runWith({ sql }));
    expect(mocks.run.mock.calls[1]?.[0]).not.toHaveProperty("decided");
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("never hands one call's decision to another call with the same SQL", async () => {
    const decided = decision({ status: "admitted", needsApproval: false });
    mocks.decide.mockResolvedValue(decided);
    await invocation(async () => {
      expect(await ask()).toBe(false);
    });
    // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
    await invocation(() => runWith({ sql }));
    expect(mocks.run.mock.calls[0]?.[0]).not.toHaveProperty("decided");
  });

  it("keeps two overlapping identical calls on their own decisions when one asks while the other has yet to run", async () => {
    const admitted = decision({ status: "admitted", needsApproval: false });
    const asked = decision({
      status: "ask",
      needsApproval: true,
      reservedBytes: 33 * GIB,
    });
    mocks.decide.mockResolvedValueOnce(admitted).mockResolvedValueOnce(asked);
    mocks.askAbout.mockResolvedValue(
      budgetWith(OUTSIDE_AGENT_PERSON_BASE_BYTES - 5 * GIB),
    );
    const firstDecided = deferred();
    const secondNoticed = deferred();
    const first = invocation(async () => {
      expect(await ask()).toBe(false);
      firstDecided.resolve();
      await secondNoticed.promise;
      // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
      await runWith({ sql });
    });
    const second = invocation(async () => {
      await firstDecided.promise;
      expect(await ask()).toBe(true);
      const text = await notice();
      secondNoticed.resolve();
      return text;
    });
    const [, text] = await Promise.all([first, second]);
    expect(text).toContain("this call can bill up to $0.21");
    expect(mocks.askAbout.mock.calls[0]?.[1]).toBe(33 * GIB);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0]?.[0]).toMatchObject({ decided: admitted });
  });

  it("releases an admission its call never runs once the call's work deadline passes, and a late run still gets that decision", async () => {
    const decided = decision({
      status: "admitted",
      needsApproval: false,
      deadline: startBigQueryAgentDeadline({ workMs: 200, cleanupMs: 400 }),
    });
    mocks.decide.mockResolvedValue(decided);
    await invocation(async () => {
      expect(await ask()).toBe(false);
      await new Promise((resolve) =>
        decided.deadline.signal.addEventListener("abort", resolve),
      );
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith(decided);
      // raw-sql-ok: a fixed test SELECT with a per-test comment suffix, passed to mocked runner calls only.
      await runWith({ sql });
    });
    expect(mocks.run.mock.calls[0]?.[0]).toMatchObject({ decided });
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("answers the approval question within the call's deadline when its budget read stalls", async () => {
    mocks.decide.mockResolvedValue(
      decision({
        status: "ask",
        needsApproval: true,
        reservedBytes: 33 * GIB,
        deadline: startBigQueryAgentDeadline({ workMs: 200, cleanupMs: 400 }),
      }),
    );
    mocks.askAbout.mockReturnValue(new Promise(() => undefined));
    const error = await invocation(async () => {
      expect(await ask()).toBe(true);
      return thrown(notice);
    });
    expect(error).toMatchObject({
      errorCode: "query_timeout",
      statusCode: 504,
    });
  });

  it("states what this query can bill in the question from the plan it decided on, without planning again", async () => {
    mocks.decide.mockResolvedValue(
      decision({ status: "ask", needsApproval: true, reservedBytes: 33 * GIB }),
    );
    mocks.askAbout.mockResolvedValue(
      budgetWith(OUTSIDE_AGENT_PERSON_BASE_BYTES - 5 * GIB),
    );
    const text = await invocation(async () => {
      expect(await ask()).toBe(true);
      return notice();
    });
    expect(text).toMatch(/^Allow up to \$5\.00 of BigQuery today\?/);
    expect(text).toContain("this call can bill up to $0.21");
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    const [, askBytes, runsOnBigQuery] = mocks.askAbout.mock.calls[0] ?? [];
    expect(askBytes).toBe(33 * GIB);
    expect(await (runsOnBigQuery as () => Promise<boolean>)()).toBe(true);
  });

  it("refuses with the query's own code, and asks nothing, when the SQL was refused", async () => {
    mocks.decide.mockResolvedValue(
      decision({
        status: "refused",
        needsApproval: false,
        code: "query_statement_not_allowed",
        message: "Outside agents can run exactly one read-only SELECT.",
      }),
    );
    const error = await invocation(async () => {
      expect(await ask()).toBe(false);
      return thrown(notice);
    });
    expect(error).toMatchObject({
      errorCode: "query_statement_not_allowed",
      statusCode: 422,
    });
    expect(mocks.askAbout).not.toHaveBeenCalled();
  });
});

describe("query-warehouse description", () => {
  it("describes the daily limits as defaults an admin can change, and points to the effective ones", () => {
    expect(action.description).toMatch(/by default/);
    expect(action.description).toMatch(/admin can change/);
    expect(action.description).toMatch(/bigQueryBudget\.today/);
  });

  it("says a dashed project name needs backticks or @project", () => {
    expect(action.description).toMatch(/backticks/);
    expect(action.description).toContain("@project");
  });
});
