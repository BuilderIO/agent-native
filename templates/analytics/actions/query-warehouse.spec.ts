import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BigQueryAgentBudgetSnapshot } from "../server/lib/bigquery-agent-budget.js";
import type { OutsideAgentBigQueryReport } from "../server/lib/bigquery-agent-calls.js";
import type {
  BigQueryAgentQueryInput,
  BigQueryAgentQueryResult,
} from "../server/lib/bigquery-agent-runner.js";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  plan: vi.fn(),
  allowanceBudget: vi.fn(),
  askAbout: vi.fn(),
  record: vi.fn(),
  order: [] as string[],
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
  planBigQueryAgentQuery: mocks.plan,
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
    mocks.plan,
    mocks.allowanceBudget,
    mocks.askAbout,
    mocks.record,
  ]) {
    mock.mockReset();
  }
  mocks.order = [];
  mocks.record.mockImplementation(async () => {
    mocks.order.push("record");
  });
  mocks.run.mockImplementation(async () => {
    mocks.order.push("run");
    return completed([{ week: "2026-11-16", signups: 42 }]);
  });
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
    ["failed", "query_bytes_cap_exceeded", 422],
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
  it("asks through itself over MCP, and records a review-page approval before it runs", async () => {
    await runWith({});
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining<Partial<BigQueryAgentQueryInput>>({
        sql: SQL,
        source: "query-warehouse",
        caller: "mcp",
        askVia: "query-warehouse",
        estimateOnly: false,
      }),
    );
    expect(mocks.record).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(mocks.order).toEqual(["record", "run"]);
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
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe("query-warehouse asks once past $1", () => {
  const ask = (args: Record<string, unknown>) =>
    action.mcpNeedsApproval(
      action.schema.parse({ sql: SQL, ...args }),
      MCP as ActionRunContext,
    );

  it("never asks about a dry run", async () => {
    expect(await ask({ dryRun: true })).toBe(false);
    expect(mocks.allowanceBudget).not.toHaveBeenCalled();
  });

  it("asks nothing, and plans nothing, early in the day", async () => {
    mocks.allowanceBudget.mockResolvedValue({ budget: budgetWith(0) });
    expect(await ask({})).toBe(false);
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("asks when this query's planned reservation would pass the $1 allowance", async () => {
    mocks.allowanceBudget.mockResolvedValue({
      budget: budgetWith(OUTSIDE_AGENT_PERSON_BASE_BYTES - 5 * GIB),
    });
    mocks.plan.mockResolvedValue({
      status: "planned",
      estimatedBytes: 30 * GIB,
      reservedBytes: 33 * GIB,
    });
    expect(await ask({})).toBe(true);
    expect(mocks.plan).toHaveBeenCalledWith(
      SQL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    mocks.plan.mockResolvedValue({
      status: "planned",
      estimatedBytes: GIB,
      reservedBytes: 1.1 * GIB,
    });
    expect(await ask({})).toBe(false);
  });

  it("asks nothing about a query its own checks will refuse", async () => {
    mocks.allowanceBudget.mockResolvedValue({
      budget: budgetWith(OUTSIDE_AGENT_PERSON_BASE_BYTES - 5 * GIB),
    });
    mocks.plan.mockResolvedValue({
      status: "refused",
      code: "query_table_not_allowed",
      message: "outside the allowlist",
    });
    expect(await ask({})).toBe(false);
  });

  it("asks nothing when the budget can't be read, so the run refuses on its own", async () => {
    mocks.allowanceBudget.mockResolvedValue(null);
    expect(await ask({})).toBe(false);
  });

  it("states what this query can bill in the question", async () => {
    mocks.askAbout.mockResolvedValue(
      budgetWith(OUTSIDE_AGENT_PERSON_BASE_BYTES - 5 * GIB),
    );
    mocks.plan.mockResolvedValue({
      status: "planned",
      estimatedBytes: 30 * GIB,
      reservedBytes: 33 * GIB,
    });
    const notice = await action.approvalNotice(
      action.schema.parse({ sql: SQL }),
      { ...MCP, actionName: "query-warehouse", askedAt: Date.now() } as never,
    );
    expect(notice).toMatch(/^Allow up to \$5\.00 of BigQuery today\?/);
    expect(notice).toContain("this call can bill up to $0.21");
    const [, askBytes, runsOnBigQuery] = mocks.askAbout.mock.calls[0] ?? [];
    expect(askBytes).toBe(33 * GIB);
    expect(await (runsOnBigQuery as () => Promise<boolean>)()).toBe(true);
  });
});
