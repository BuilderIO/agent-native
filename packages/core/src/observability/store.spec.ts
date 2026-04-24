import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture every SQL string + bound args the store sends to the DB so we
// can assert that user-scoped reads include `user_id = ?` and that the
// owner identifier reaches the binding. We don't simulate real SQL
// execution — the goal here is to verify that the data-isolation
// contract is upheld at the query-construction layer.
interface ExecCall {
  sql: string;
  args: any[];
}

const execCalls: ExecCall[] = [];

function createCapturingDb() {
  return {
    execute: vi.fn(async (sql: string | { sql: string; args?: any[] }) => {
      const rawSql = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : (sql.args ?? []);
      execCalls.push({ sql: rawSql, args });
      // Most calls just need to "succeed" with empty rows. SELECTs in this
      // store return an array shape; provide one to keep the mappers happy.
      return { rows: [], rowsAffected: 0 };
    }),
  };
}

const mockDb = createCapturingDb();

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  isPostgres: () => false,
  intType: () => "INTEGER",
}));

// Pull the store after the mock is wired so it picks up the capturing db.
const {
  getTraceSummaries,
  getTraceSummary,
  getTraceSpansForRun,
  getFeedback,
  getFeedbackStats,
  getSatisfactionScores,
  getEvalsForRun,
  getEvalStats,
  getObservabilityOverview,
  insertTraceSpan,
  insertEvalResult,
  insertFeedback,
  upsertTraceSummary,
  upsertSatisfactionScore,
} = await import("./store.js");

function lastSelect(): ExecCall {
  // Skip CREATE/ALTER/INDEX init calls; return the most recent SELECT.
  const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
  if (selects.length === 0) throw new Error("no SELECT was executed");
  return selects[selects.length - 1];
}

describe("observability store: per-user isolation", () => {
  beforeEach(() => {
    execCalls.length = 0;
    vi.clearAllMocks();
  });

  describe("read filtering", () => {
    it("getTraceSummaries adds user_id filter when userId is provided", async () => {
      await getTraceSummaries({ sinceMs: 1000, limit: 50, userId: "alice" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE created_at >= \? AND user_id = \?/);
      expect(call.args).toEqual([1000, "alice", 50]);
    });

    it("getTraceSummaries omits user_id filter when userId is undefined", async () => {
      // Internal callers (background reports, admin tools) can pass no
      // filter to read across all users. The omission must produce a
      // SELECT without a `user_id =` clause — load-bearing for any
      // future callers that intentionally want unfiltered reads.
      await getTraceSummaries({ sinceMs: 1000, limit: 50 });
      const call = lastSelect();
      expect(call.sql).not.toMatch(/user_id/);
      expect(call.args).toEqual([1000, 50]);
    });

    it("getTraceSummary scopes by user_id (prevents IDOR by runId)", async () => {
      await getTraceSummary("run-from-other-user", { userId: "alice" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE run_id = \? AND user_id = \?/);
      expect(call.args).toEqual(["run-from-other-user", "alice"]);
    });

    it("getTraceSpansForRun scopes by user_id (prevents IDOR)", async () => {
      await getTraceSpansForRun("run-x", { userId: "alice" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE run_id = \? AND user_id = \?/);
      expect(call.args).toEqual(["run-x", "alice"]);
    });

    it("getFeedback adds user_id filter when userId is provided", async () => {
      await getFeedback({ sinceMs: 500, limit: 20, userId: "bob" });
      const call = lastSelect();
      expect(call.sql).toMatch(/user_id = \?/);
      expect(call.args).toEqual([500, "bob", 20]);
    });

    it("getFeedbackStats scopes aggregations to userId", async () => {
      await getFeedbackStats(2000, { userId: "carol" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE created_at >= \? AND user_id = \?/);
      expect(call.args).toEqual([2000, "carol"]);
    });

    it("getSatisfactionScores adds user_id filter when userId is provided", async () => {
      await getSatisfactionScores({ sinceMs: 100, userId: "dave" });
      const call = lastSelect();
      expect(call.sql).toMatch(/user_id = \?/);
      expect(call.args).toEqual([100, "dave", 100]);
    });

    it("getEvalsForRun scopes by user_id (prevents IDOR)", async () => {
      await getEvalsForRun("run-x", { userId: "alice" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE run_id = \? AND user_id = \?/);
      expect(call.args).toEqual(["run-x", "alice"]);
    });

    it("getEvalStats applies user_id to BOTH sub-queries", async () => {
      await getEvalStats(3000, { userId: "alice" });
      // getEvalStats fires two SELECTs (totals + per-criteria); both must
      // carry the user filter, otherwise the per-criteria breakdown leaks
      // other users' eval data while only the totals are scoped.
      const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
      expect(selects.length).toBe(2);
      for (const s of selects) {
        expect(s.sql).toMatch(/user_id = \?/);
        expect(s.args).toEqual([3000, "alice"]);
      }
    });

    it("getObservabilityOverview applies user_id to ALL four sub-queries", async () => {
      await getObservabilityOverview(4000, { userId: "alice" });
      const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
      expect(selects.length).toBe(4);
      for (const s of selects) {
        expect(s.sql).toMatch(/AND user_id = \?/);
        expect(s.args).toEqual([4000, "alice"]);
      }
    });

    it("getObservabilityOverview without userId leaves all four sub-queries unfiltered", async () => {
      await getObservabilityOverview(4000);
      const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
      expect(selects.length).toBe(4);
      for (const s of selects) {
        expect(s.sql).not.toMatch(/user_id/);
        expect(s.args).toEqual([4000]);
      }
    });
  });

  describe("write capture", () => {
    it("insertTraceSpan persists user_id alongside the span", async () => {
      await insertTraceSpan({
        id: "s1",
        runId: "r1",
        threadId: "t1",
        userId: "alice",
        parentSpanId: null,
        spanType: "agent_run",
        name: "n",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costCentsX100: 0,
        durationMs: 0,
        status: "success",
        errorMessage: null,
        metadata: null,
        createdAt: 1,
      });
      const call = execCalls.find((c) =>
        /INSERT INTO agent_trace_spans/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.sql).toMatch(/\buser_id\b/);
      expect(call!.args).toContain("alice");
    });

    it("upsertTraceSummary persists user_id (covers SQLite REPLACE branch)", async () => {
      await upsertTraceSummary({
        runId: "r1",
        threadId: "t1",
        userId: "alice",
        totalSpans: 1,
        llmCalls: 1,
        toolCalls: 0,
        successfulTools: 0,
        failedTools: 0,
        totalDurationMs: 0,
        totalCostCentsX100: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        model: "m",
        createdAt: 1,
      });
      const call = execCalls.find((c) =>
        /INSERT (OR REPLACE )?INTO agent_trace_summaries/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.sql).toMatch(/\buser_id\b/);
      expect(call!.args).toContain("alice");
    });

    it("insertEvalResult persists user_id", async () => {
      await insertEvalResult({
        id: "e1",
        runId: "r1",
        threadId: "t1",
        userId: "alice",
        evalType: "automated",
        criteria: "c",
        score: 0.5,
        reasoning: null,
        metadata: null,
        createdAt: 1,
      });
      const call = execCalls.find((c) =>
        /INSERT INTO agent_evals/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.sql).toMatch(/\buser_id\b/);
      expect(call!.args).toContain("alice");
    });

    it("upsertSatisfactionScore persists user_id", async () => {
      await upsertSatisfactionScore({
        id: "sat-t1",
        threadId: "t1",
        userId: "alice",
        frustrationScore: 0,
        rephrasingScore: 0,
        abandonmentScore: 0,
        sentimentScore: 0,
        lengthTrendScore: 0,
        computedAt: 1,
      });
      const call = execCalls.find((c) =>
        /INSERT (OR REPLACE )?INTO agent_satisfaction_scores/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.sql).toMatch(/\buser_id\b/);
      expect(call!.args).toContain("alice");
    });

    it("insertFeedback already wrote user_id (regression guard)", async () => {
      await insertFeedback({
        id: "f1",
        runId: null,
        threadId: "t1",
        messageSeq: null,
        feedbackType: "thumbs_up",
        value: "",
        userId: "alice",
        createdAt: 1,
      });
      const call = execCalls.find((c) =>
        /INSERT INTO agent_feedback/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.args).toContain("alice");
    });
  });
});
