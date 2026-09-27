import { describe, it, expect, beforeEach, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

interface ExecCall {
  sql: string;
  args: any[];
}

const execCalls: ExecCall[] = [];
let selectedRows: Record<string, unknown>[] = [];
const mockEnsureIndexExists = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

function createCapturingDb() {
  return {
    execute: vi.fn(async (sql: string | { sql: string; args?: any[] }) => {
      const rawSql = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : (sql.args ?? []);
      execCalls.push({ sql: rawSql, args });
      return {
        rows: /^\s*SELECT\b/i.test(rawSql) ? selectedRows : [],
        rowsAffected: 0,
      };
    }),
  };
}

const mockDb = createCapturingDb();

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: mockEnsureIndexExists,
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const {
  getTraceSummaries,
  getTraceSummary,
  getLatestTraceSummaryForThread,
  getTraceSpansForRun,
  getSuccessfulToolSpansForReview,
  MAX_REVIEW_TOOL_SPANS,
  getOrgScopedThreadData,
  getOrgScopedThreadTitles,
  getOrgScopedReviewThreads,
  getRecentReviewRunsForReviewGroups,
  getHumanReviewSummaries,
  getHumanReviewSummariesForThreads,
  getFeedback,
  getInstructionUpdates,
  getFeedbackStats,
  getSatisfactionScores,
  getEvalsForRun,
  getEvalStats,
  getObservabilityOverview,
  insertTraceSpan,
  insertEvalResult,
  insertFeedback,
  upsertTraceSummary,
  upsertHumanReviewSummary,
  upsertSatisfactionScore,
} = await import("./store.js");

function lastSelect(): ExecCall {
  const selects = execCalls.filter((c) => /^\s*SELECT\b/i.test(c.sql));
  if (selects.length === 0) throw new Error("no SELECT was executed");
  return selects[selects.length - 1];
}

describe("observability store: per-user isolation", () => {
  beforeEach(() => {
    execCalls.length = 0;
    selectedRows = [];
    vi.clearAllMocks();
  });

  describe("read filtering", () => {
    it("getTraceSummaries adds user_id filter when userId is provided", async () => {
      await getTraceSummaries({ sinceMs: 1000, limit: 50, userId: "alice" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE created_at >= \? AND user_id = \?/);
      expect(call.args).toEqual([1000, "alice", 50]);
      expect(mockEnsureIndexExists).toHaveBeenCalledWith(
        "idx_trace_summaries_org_created",
        expect.stringMatching(
          /ON agent_trace_summaries \(org_id, created_at DESC\)/,
        ),
      );
      expect(mockEnsureIndexExists).toHaveBeenCalledWith(
        "idx_trace_spans_type_name_run_id",
        expect.stringMatching(
          /ON agent_trace_spans \(span_type, name, run_id\)/,
        ),
      );
      expect(mockEnsureIndexExists).toHaveBeenCalledWith(
        "idx_feedback_org_source_created",
        expect.stringMatching(
          /ON agent_feedback \(org_id, source, created_at DESC\)/,
        ),
      );
      expect(mockEnsureIndexExists).toHaveBeenCalledWith(
        "idx_feedback_org_run_created",
        expect.stringMatching(
          /ON agent_feedback \(org_id, run_id, created_at DESC\)/,
        ),
      );
    });

    it("getTraceSummaries omits user_id filter when userId is undefined", async () => {
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

    it("getTraceSummary scopes admin run-id lookups to the explicit org", async () => {
      await getTraceSummary("run-from-org-b", { orgId: "org-a" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE run_id = \? AND org_id = \?/);
      expect(call.args).toEqual(["run-from-org-b", "org-a"]);
    });

    it("lists only summaries explicitly attributed to the requested org", async () => {
      await getTraceSummaries({ sinceMs: 1000, limit: 50, orgId: "org-a" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE created_at >= \? AND org_id = \?/);
      expect(call.args).toEqual([1000, "org-a", 50]);
    });

    it("excludes summary-agent runs in SQL before applying list limit", async () => {
      await getTraceSummaries({
        sinceMs: 1000,
        limit: 20,
        orgId: "org-a",
        excludeSpanName: "agent_run:observability:human-review-summary",
        requireReviewContext: true,
      });
      const call = lastSelect();
      expect(call.sql.indexOf("NOT IN")).toBeLessThan(
        call.sql.indexOf("LIMIT ?"),
      );
      expect(call.sql).toMatch(/thread_id IS NOT NULL/);
      expect(call.sql).toMatch(/FROM chat_threads review_thread/);
      expect(call.sql).toMatch(
        /FROM agent_human_review_summaries review_summary/,
      );
      expect(call.sql.indexOf("review_summary")).toBeLessThan(
        call.sql.indexOf("LIMIT ?"),
      );
      expect(call.sql).toMatch(
        /FROM agent_trace_spans\s+WHERE span_type = 'agent_run' AND name = \?\s+AND org_id = \?/,
      );
      expect(call.args).toEqual([
        1000,
        "org-a",
        "agent_run:observability:human-review-summary",
        "org-a",
        20,
      ]);
    });

    it("rolls recurring automation runs up by resource without crossing orgs", async () => {
      const pg = await createTestPglite();
      try {
        await pg.exec(`
          CREATE TABLE agent_trace_summaries (
            run_id TEXT PRIMARY KEY, thread_id TEXT, user_id TEXT, org_id TEXT,
            total_spans BIGINT DEFAULT 0, llm_calls BIGINT DEFAULT 0,
            tool_calls BIGINT DEFAULT 0, successful_tools BIGINT DEFAULT 0,
            failed_tools BIGINT DEFAULT 0, total_duration_ms BIGINT DEFAULT 0,
            total_cost_cents_x100 BIGINT DEFAULT 0,
            total_input_tokens BIGINT DEFAULT 0,
            total_output_tokens BIGINT DEFAULT 0, model TEXT DEFAULT '',
            created_at BIGINT NOT NULL
          );
          CREATE TABLE agent_trace_spans (
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL, org_id TEXT,
            span_type TEXT NOT NULL, name TEXT NOT NULL, metadata TEXT,
            created_at BIGINT
          );
          CREATE TABLE chat_threads (
            id TEXT, org_id TEXT, owner_email TEXT, title TEXT
          );
          CREATE TABLE agent_human_review_summaries (
            run_id TEXT, org_id TEXT
          );
        `);
        const runs = [
          {
            runId: "a-old",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-a1",
            createdAt: 1,
            automationId: "resource-a",
          },
          {
            runId: "a-new",
            orgId: "org-a",
            userId: "bob@example.com",
            threadId: "thread-a2",
            createdAt: 3,
            automationId: "resource-a",
          },
          {
            runId: "b-only",
            orgId: "org-b",
            userId: "alice@example.com",
            threadId: "thread-b1",
            createdAt: 2,
            automationId: "resource-a",
          },
          {
            runId: "c-only",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-c1",
            createdAt: 4,
            automationId: "resource-b",
          },
          {
            runId: "d-only",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-d1",
            createdAt: 5,
          },
          {
            runId: "e-personal-alice",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-e1",
            createdAt: 6,
            automationId: "personal-resource",
            scope: "personal",
          },
          {
            runId: "f-personal-bob",
            orgId: "org-a",
            userId: "bob@example.com",
            threadId: "thread-f1",
            createdAt: 7,
            automationId: "personal-resource",
            scope: "personal",
          },
          {
            runId: "g-legacy-org-one",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-g1",
            createdAt: 8,
            legacyAutomationName: "nightly-cleanup",
          },
          {
            runId: "h-legacy-org-two",
            orgId: "org-a",
            userId: "bob@example.com",
            threadId: "thread-h1",
            createdAt: 9,
            legacyAutomationName: "nightly-cleanup",
          },
          {
            runId: "i-legacy-personal-one",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-i1",
            createdAt: 10,
            legacyAutomationName: "personal-cleanup",
            scope: "personal",
          },
          {
            runId: "j-legacy-personal-two",
            orgId: "org-a",
            userId: "alice@example.com",
            threadId: "thread-j1",
            createdAt: 11,
            legacyAutomationName: "personal-cleanup",
            scope: "personal",
          },
        ] as const;
        for (const run of runs) {
          await pg.query(
            `INSERT INTO agent_trace_summaries
              (run_id, thread_id, user_id, org_id, created_at)
              VALUES ($1, $2, $3, $4, $5)`,
            [run.runId, run.threadId, run.userId, run.orgId, run.createdAt],
          );
          await pg.query(
            `INSERT INTO chat_threads (id, org_id, owner_email, title)
              VALUES ($1, $2, $3, $4)`,
            [run.threadId, run.orgId, run.userId, "A real thread"],
          );
          if (run.automationId || run.legacyAutomationName) {
            await pg.query(
              `INSERT INTO agent_trace_spans
                (id, run_id, org_id, span_type, name, metadata, created_at)
                VALUES ($1, $2, $3, 'agent_run', $4, $5, $6)`,
              [
                `span-${run.runId}`,
                run.runId,
                run.orgId,
                `background_automation_run:${run.legacyAutomationName ?? "daily-digest"}`,
                JSON.stringify({
                  ...(run.automationId
                    ? { automationId: run.automationId }
                    : {}),
                  automation: run.legacyAutomationName ?? "daily-digest",
                  scope: run.scope ?? "organization",
                }),
                run.createdAt,
              ],
            );
          }
        }
        vi.mocked(mockDb.execute).mockImplementationOnce(async (input) => {
          if (typeof input === "string") {
            const result = await pg.query(input);
            return { rows: result.rows, rowsAffected: 0 };
          }
          const result = await pg.query(input.sql, input.args ?? []);
          return { rows: result.rows, rowsAffected: 0 };
        });

        const summaries = await getTraceSummaries({
          sinceMs: 0,
          limit: 20,
          excludeSpanName: "agent_run:observability:human-review-summary",
          requireReviewContext: true,
        });

        expect(mockDb.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            sql: expect.stringContaining(
              "ROWS BETWEEN CURRENT ROW AND 5 FOLLOWING",
            ),
          }),
        );
        expect(summaries).toHaveLength(10);
        expect(summaries).toContainEqual(
          expect.objectContaining({
            runId: "a-new",
            orgId: "org-a",
            userId: "bob@example.com",
            runCount: 2,
            reviewGroupLabel: "daily-digest",
            reviewGroupRunIds: ["a-new", "a-old"],
          }),
        );
        expect(
          summaries.filter(
            (summary) => summary.reviewGroupLabel === "daily-digest",
          ),
        ).toHaveLength(5);
        expect(
          summaries.filter((summary) =>
            summary.reviewGroupLabel?.endsWith("cleanup"),
          ),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ runId: "g-legacy-org-one", runCount: 1 }),
            expect.objectContaining({ runId: "h-legacy-org-two", runCount: 1 }),
            expect.objectContaining({
              runId: "i-legacy-personal-one",
              runCount: 1,
            }),
            expect.objectContaining({
              runId: "j-legacy-personal-two",
              runCount: 1,
            }),
          ]),
        );
        expect(
          summaries.filter(
            (summary) =>
              summary.runId.startsWith("e-personal-") ||
              summary.runId.startsWith("f-personal-"),
          ),
        ).toEqual([
          expect.objectContaining({
            runId: "f-personal-bob",
            userId: "bob@example.com",
            runCount: 1,
          }),
          expect.objectContaining({
            runId: "e-personal-alice",
            userId: "alice@example.com",
            runCount: 1,
          }),
        ]);
      } finally {
        await pg.close();
      }
    });

    it("excludes other-org and legacy NULL-org threads before reading thread data", async () => {
      await getOrgScopedThreadData("org-a", "alice@example.com", ["a", "b"]);
      const call = lastSelect();
      expect(call.sql).toMatch(
        /WHERE org_id = \? AND LOWER\(owner_email\) = LOWER\(\?\)/,
      );
      expect(call.sql).toMatch(/AND id IN \(\?, \?\)/);
      expect(call.sql).toMatch(/^SELECT id, thread_data FROM chat_threads/);
      expect(call.args).toEqual(["org-a", "alice@example.com", "a", "b"]);
    });

    it("reads thread titles only from explicitly org-owned rows", async () => {
      await getOrgScopedThreadTitles("org-a", "alice@example.com", [
        "thread-a",
      ]);
      const call = lastSelect();
      expect(call.sql).toMatch(/^SELECT id, title FROM chat_threads/);
      expect(call.sql).toMatch(
        /WHERE org_id = \? AND LOWER\(owner_email\) = LOWER\(\?\)/,
      );
      expect(call.args).toEqual(["org-a", "alice@example.com", "thread-a"]);
    });

    it("batches thread data and titles with an org and owner check per row", async () => {
      selectedRows = [
        {
          id: "thread-a",
          owner_email: "alice@example.com",
          org_id: "org-a",
          thread_data: '{"messages":[]}',
          title: "Alice's thread",
          scope_type: "design",
          scope_id: "design-a",
          scope_label: "Design A",
        },
      ];
      const threads = await getOrgScopedReviewThreads([
        {
          orgId: "org-a",
          ownerEmail: "alice@example.com",
          threadId: "thread-a",
        },
        { orgId: "org-b", ownerEmail: "bob@example.com", threadId: "thread-b" },
      ]);
      const queryCalls = execCalls.filter((call) =>
        /FROM chat_threads/.test(call.sql),
      );
      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0]!.sql).toMatch(
        /SELECT id, owner_email, org_id,\s+CASE WHEN OCTET_LENGTH\(thread_data\) <= \? THEN thread_data ELSE NULL END AS thread_data,\s+title, scope_type, scope_id, scope_label FROM chat_threads\s+WHERE \(\(org_id = \? AND LOWER\(owner_email\) = LOWER\(\?\) AND id = \?\) OR \(org_id = \? AND LOWER\(owner_email\) = LOWER\(\?\) AND id = \?\)\)/,
      );
      expect(queryCalls[0]!.args).toEqual([
        1_000_000,
        "org-a",
        "alice@example.com",
        "thread-a",
        "org-b",
        "bob@example.com",
        "thread-b",
      ]);
      expect(threads.get(JSON.stringify(["org-a", "thread-a"]))).toEqual({
        ownerEmail: "alice@example.com",
        threadData: '{"messages":[]}',
        title: "Alice's thread",
        scopeType: "design",
        scopeId: "design-a",
        scopeLabel: "Design A",
      });
    });

    it("omits an oversized review thread while preserving its title", async () => {
      selectedRows = [
        {
          id: "thread-a",
          owner_email: "alice@example.com",
          org_id: "org-a",
          thread_data: null,
          title: "Alice's thread",
          scope_type: null,
          scope_id: null,
          scope_label: null,
        },
      ];
      const threads = await getOrgScopedReviewThreads([
        {
          orgId: "org-a",
          ownerEmail: "alice@example.com",
          threadId: "thread-a",
        },
      ]);

      expect(lastSelect().sql).toContain(
        "CASE WHEN OCTET_LENGTH(thread_data) <= ? THEN thread_data ELSE NULL END",
      );
      expect(threads.get(JSON.stringify(["org-a", "thread-a"]))).toEqual({
        ownerEmail: "alice@example.com",
        threadData: null,
        title: "Alice's thread",
        scopeType: null,
        scopeId: null,
        scopeLabel: null,
      });
    });

    it("loads only explicitly grouped runs through org-owned thread rows", async () => {
      await getRecentReviewRunsForReviewGroups({
        runScopes: [
          { orgId: "org-a", runId: "run-a" },
          { orgId: "org-b", runId: "run-a" },
        ],
        sinceMs: 100,
      });
      const call = lastSelect();
      expect(call.sql).toMatch(
        /INNER JOIN chat_threads thread\s+ON thread\.id = summary\.thread_id AND thread\.org_id = summary\.org_id\s+AND LOWER\(thread\.owner_email\) = LOWER\(summary\.user_id\)/,
      );
      expect(call.sql).toContain("(summary.org_id = ? AND summary.run_id = ?)");
      expect(call.sql).toContain("AS is_human_review_summary_run");
      expect(call.args).toEqual([100, "org-a", "run-a", "org-b", "run-a"]);
    });

    it("keeps scoped threads from summary runs without exposing those runs", async () => {
      const pg = await createTestPglite();
      try {
        await pg.exec(`
          CREATE TABLE agent_trace_summaries (
            run_id TEXT PRIMARY KEY, thread_id TEXT, user_id TEXT, org_id TEXT,
            created_at BIGINT NOT NULL
          );
          CREATE TABLE agent_trace_spans (
            run_id TEXT NOT NULL, org_id TEXT, span_type TEXT NOT NULL, name TEXT NOT NULL
          );
          CREATE TABLE chat_threads (
            id TEXT, org_id TEXT, owner_email TEXT
          );
        `);
        for (const run of [
          {
            runId: "summary-run",
            threadId: "summary-thread",
            createdAt: 200,
          },
          { runId: "normal-run", threadId: "normal-thread", createdAt: 100 },
          { runId: "other-org-run", threadId: "other-thread", createdAt: 150 },
        ]) {
          const orgId = run.runId === "other-org-run" ? "org-b" : "org-a";
          await pg.query(
            `INSERT INTO agent_trace_summaries
              (run_id, thread_id, user_id, org_id, created_at)
              VALUES ($1, $2, 'alice@example.com', $3, $4)`,
            [run.runId, run.threadId, orgId, run.createdAt],
          );
          await pg.query(
            `INSERT INTO chat_threads (id, org_id, owner_email)
              VALUES ($1, $2, 'alice@example.com')`,
            [run.threadId, orgId],
          );
        }
        await pg.query(
          `INSERT INTO agent_trace_spans (run_id, org_id, span_type, name)
            VALUES ('summary-run', 'org-a', 'agent_run',
              'agent_run:observability:human-review-summary')`,
        );
        vi.mocked(mockDb.execute).mockImplementationOnce(async (input) => {
          const result =
            typeof input === "string"
              ? await pg.query(input)
              : await pg.query(input.sql, input.args ?? []);
          return { rows: result.rows, rowsAffected: 0 };
        });

        const result = await getRecentReviewRunsForReviewGroups({
          runScopes: [
            { orgId: "org-a", runId: "summary-run" },
            { orgId: "org-a", runId: "normal-run" },
            { orgId: "org-a", runId: "other-org-run" },
          ],
          sinceMs: 0,
        });

        expect(result.runs.map((run) => run.runId)).toEqual(["normal-run"]);
        expect(result.runThreadScopes).toEqual([
          {
            orgId: "org-a",
            runId: "summary-run",
            threadId: "summary-thread",
          },
          {
            orgId: "org-a",
            runId: "normal-run",
            threadId: "normal-thread",
          },
        ]);
      } finally {
        await pg.close();
      }
    });

    it("bounds successful tool span and metadata reads in SQL", async () => {
      selectedRows = [
        {
          name: "create_design",
          metadata: '{"input":{"designId":"design-a"}}',
        },
      ];
      await expect(
        getSuccessfulToolSpansForReview("run-a", "org-a", 999),
      ).resolves.toEqual([
        {
          name: "create_design",
          metadata: { input: { designId: "design-a" } },
        },
      ]);

      const call = lastSelect();
      expect(call.sql).toMatch(/CASE WHEN OCTET_LENGTH\(metadata\) <= \?/);
      expect(call.sql).toMatch(
        /WHERE run_id = \? AND org_id = \?\s+AND span_type = 'tool_call' AND status = 'success'\s+ORDER BY created_at ASC\s+LIMIT \?/,
      );
      expect(call.sql).not.toContain("SELECT *");
      expect(call.args).toEqual([
        100_000,
        "run-a",
        "org-a",
        MAX_REVIEW_TOOL_SPANS,
      ]);
    });

    it("reads persisted summaries for the active org and requested runs only", async () => {
      await getHumanReviewSummaries("org-a", ["run-a", "run-b"]);
      const call = lastSelect();
      expect(call.sql).toMatch(
        /FROM agent_human_review_summaries WHERE org_id = \? AND run_id IN \(\?, \?\)/,
      );
      expect(call.args).toEqual(["org-a", "run-a", "run-b"]);
    });

    it("loads the latest persisted summary through org-owned threads", async () => {
      selectedRows = [
        {
          run_id: "run-newest",
          org_id: "org-a",
          ask: "Current ask",
          outcome: "Current outcome",
          artifacts: "[]",
          created_by: "admin@example.com",
          created_at: 1,
          updated_at: 3,
          review_thread_id: "thread-a",
        },
        {
          run_id: "run-old",
          org_id: "org-a",
          ask: "Old ask",
          outcome: "Old outcome",
          artifacts: "[]",
          created_by: "admin@example.com",
          created_at: 1,
          updated_at: 2,
          review_thread_id: "thread-a",
        },
        {
          run_id: "run-other-org",
          org_id: "org-b",
          ask: "Other org ask",
          outcome: "Other org outcome",
          artifacts: "[]",
          created_by: "other-admin@example.com",
          created_at: 1,
          updated_at: 4,
          review_thread_id: "thread-a",
        },
      ];
      await expect(
        getHumanReviewSummariesForThreads(
          [
            { orgId: "org-a", threadId: "thread-a" },
            { orgId: "org-b", threadId: "thread-a" },
          ],
          [{ orgId: "org-a", runId: "run-old" }],
        ),
      ).resolves.toMatchObject(
        new Map([
          [
            JSON.stringify(["org-a", "thread-a"]),
            [
              {
                runId: "run-newest",
                ask: "Current ask",
                outcome: "Current outcome",
              },
              {
                runId: "run-old",
                ask: "Old ask",
                outcome: "Old outcome",
              },
            ],
          ],
          [
            JSON.stringify(["org-b", "thread-a"]),
            [
              {
                runId: "run-other-org",
                ask: "Other org ask",
                outcome: "Other org outcome",
              },
            ],
          ],
        ]),
      );
      const call = lastSelect();
      expect(call.sql).toMatch(
        /INNER JOIN agent_trace_summaries trace\s+ON trace\.run_id = review\.run_id AND trace\.org_id = review\.org_id/,
      );
      expect(call.sql).toMatch(
        /INNER JOIN chat_threads thread\s+ON thread\.id = trace\.thread_id AND thread\.org_id = trace\.org_id\s+AND LOWER\(thread\.owner_email\) = LOWER\(trace\.user_id\)/,
      );
      expect(call.sql).toMatch(
        /WHERE \(\(review\.org_id = \? AND trace\.thread_id = \?\) OR \(review\.org_id = \? AND trace\.thread_id = \?\) OR \(review\.org_id = \? AND trace\.run_id = \?\)\)/,
      );
      expect(call.sql).toMatch(
        /ORDER BY review\.updated_at DESC, review\.run_id DESC/,
      );
      expect(call.args).toEqual([
        "org-a",
        "thread-a",
        "org-b",
        "thread-a",
        "org-a",
        "run-old",
        "org-a",
        "run-old",
      ]);
    });

    it("loads explicitly requested summaries from older grouped threads", async () => {
      selectedRows = [
        {
          run_id: "run-old",
          org_id: "org-a",
          ask: "Earlier ask",
          outcome: "Earlier outcome",
          artifacts: "[]",
          created_by: "alice@example.com",
          created_at: 1,
          updated_at: 2,
          review_thread_id: "thread-old",
        },
      ];
      await expect(
        getHumanReviewSummariesForThreads(
          [{ orgId: "org-a", threadId: "thread-latest" }],
          [{ orgId: "org-a", runId: "run-old" }],
        ),
      ).resolves.toMatchObject(
        new Map([
          [
            JSON.stringify(["org-a", "thread-old"]),
            [
              {
                runId: "run-old",
                ask: "Earlier ask",
                outcome: "Earlier outcome",
              },
            ],
          ],
        ]),
      );
      expect(lastSelect().sql).toContain(
        "(review.org_id = ? AND trace.run_id = ?)",
      );
      expect(lastSelect().args).toEqual([
        "org-a",
        "thread-latest",
        "org-a",
        "run-old",
        "org-a",
        "run-old",
      ]);
    });

    it("parses valid persisted summary artifacts", async () => {
      selectedRows = [
        {
          run_id: "run-a",
          org_id: "org-a",
          ask: "Build the report",
          outcome: "Created the report",
          artifacts:
            '[{"appId":"analytics","artifactId":"dash-a","title":"Weekly","path":"/dashboards/dash-a"}]',
          created_by: "admin@example.com",
          created_at: 1,
          updated_at: "2",
        },
      ];
      await expect(getHumanReviewSummaries("org-a")).resolves.toEqual(
        new Map([
          [
            "run-a",
            {
              runId: "run-a",
              orgId: "org-a",
              ask: "Build the report",
              outcome: "Created the report",
              artifacts: [
                {
                  appId: "analytics",
                  artifactId: "dash-a",
                  title: "Weekly",
                  path: "/dashboards/dash-a",
                },
              ],
              createdBy: "admin@example.com",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        ]),
      );
    });

    it.each([
      ["invalid JSON", "not-json"],
      [
        "invalid artifact shape",
        '[{"appId":"unknown","artifactId":"x","title":"X"}]',
      ],
      [
        "app-inconsistent path",
        '[{"appId":"analytics","artifactId":"x","title":"X","path":"/design/x"}]',
      ],
    ])(
      "fails explicitly for persisted summary artifacts with %s",
      async (_label, artifacts) => {
        selectedRows = [
          {
            run_id: "run-a",
            org_id: "org-a",
            ask: "Build the report",
            outcome: "Created the report",
            artifacts,
            created_by: "admin@example.com",
            created_at: 1,
            updated_at: 2,
          },
        ];
        await expect(getHumanReviewSummaries("org-a")).rejects.toThrow();
      },
    );

    it("scopes instruction drafts and feedback writes/reads by org", async () => {
      await getInstructionUpdates({ orgId: "org-a", runId: "run-a" });
      expect(lastSelect().sql).toMatch(/run_id = \? AND org_id = \?/);
      expect(lastSelect().args.slice(0, 2)).toEqual(["run-a", "org-a"]);

      await getFeedback({ orgId: "org-a", source: "human_review" });
      expect(lastSelect().sql).toMatch(/org_id = \? AND source = \?/);
      expect(lastSelect().args.slice(0, 2)).toEqual(["org-a", "human_review"]);
    });

    it("filters feedback and instruction drafts by the selected run IDs", async () => {
      await getFeedback({
        runIds: ["run-a", "run-b"],
        orgId: "org-a",
        source: "human_review",
        limit: 10,
      });
      expect(lastSelect().sql).toMatch(
        /WHERE run_id IN \(\?, \?\) AND org_id = \? AND source = \?/,
      );
      expect(lastSelect().args).toEqual([
        "run-a",
        "run-b",
        "org-a",
        "human_review",
        10,
      ]);

      await getInstructionUpdates({
        runIds: ["run-a", "run-b"],
        orgId: "org-a",
      });
      expect(lastSelect().sql).toMatch(
        /WHERE run_id IN \(\?, \?\) AND org_id = \?/,
      );
      expect(lastSelect().args).toEqual(["run-a", "run-b", "org-a", 500]);
    });

    it("bounds instruction drafts independently for each selected thread", async () => {
      await getInstructionUpdates({
        threadIds: ["thread-a", "thread-b"],
        sinceMs: 500,
        orgId: "org-a",
        perThreadLimit: 1,
      });
      const call = lastSelect();
      expect(call.sql).toMatch(
        /PARTITION BY thread_id ORDER BY updated_at DESC, id DESC/,
      );
      expect(call.sql).toMatch(/WHERE update_row_number <= \?/);
      expect(call.sql).not.toContain("LIMIT ?");
      expect(call.args).toEqual(["thread-a", "thread-b", 500, "org-a", 1]);
    });

    it("returns no rows without querying when an explicit run list is empty", async () => {
      await expect(getFeedback({ runIds: [] })).resolves.toEqual([]);
      await expect(getInstructionUpdates({ runIds: [] })).resolves.toEqual([]);
      expect(execCalls).toHaveLength(0);
    });

    it("gets the latest response by thread and owner", async () => {
      await getLatestTraceSummaryForThread("thread-1", {
        userId: "alice",
        excludeRunId: "run-current",
      });
      const call = lastSelect();
      expect(call.sql).toMatch(
        /WHERE thread_id = \? AND user_id = \? AND run_id <> \?/,
      );
      expect(call.sql).toMatch(/ORDER BY created_at DESC\s+LIMIT 1/);
      expect(call.args).toEqual(["thread-1", "alice", "run-current"]);
    });

    it("getTraceSpansForRun scopes by user_id (prevents IDOR)", async () => {
      await getTraceSpansForRun("run-x", { userId: "alice" });
      const call = lastSelect();
      expect(call.sql).toMatch(/WHERE run_id = \? AND user_id = \?/);
      expect(call.args).toEqual(["run-x", "alice"]);
    });

    it("hides legacy tool errors and sanitizes explicitly captured errors", async () => {
      selectedRows.push(
        {
          id: "legacy",
          run_id: "run-x",
          span_type: "tool_call",
          name: "fetch",
          status: "error",
          error_message:
            "Error: client_secret=old-secret private_key=old-private-key",
          metadata: null,
          created_at: 1,
        },
        {
          id: "captured",
          run_id: "run-x",
          span_type: "tool_call",
          name: "fetch",
          status: "error",
          error_message:
            "Error: client_secret=new-secret private_key=new-private-key",
          metadata: JSON.stringify({
            __tool_error_capture_version: 1,
          }),
          created_at: 2,
        },
        {
          id: "captured-jsonb",
          run_id: "run-x",
          span_type: "tool_call",
          name: "fetch",
          status: "error",
          error_message: "Error: client_secret=jsonb-secret",
          metadata: {
            __tool_error_capture_version: 1,
            input: { query: "safe query" },
          },
          created_at: 3,
        },
        {
          id: "legacy-captured-input",
          run_id: "run-x",
          span_type: "tool_call",
          name: "fetch",
          status: "success",
          metadata: {
            input: {
              headers: { "Proxy-Authorization": "Basic old-proxy-secret" },
              subscriptionKey: "old-subscription-key",
              googleClientSecret: "old-client-secret",
              providerToken: "old-provider-token",
            },
          },
          created_at: 4,
        },
      );

      const spans = await getTraceSpansForRun("run-x");

      expect(spans[0]?.errorMessage).toBeNull();
      expect(spans[1]?.errorMessage).toBe(
        "Error: client_secret=[REDACTED] private_key=[REDACTED]",
      );
      expect(spans[1]?.metadata).not.toHaveProperty(
        "__tool_error_capture_version",
      );
      expect(spans[2]?.errorMessage).toBe("Error: client_secret=[REDACTED]");
      expect(spans[2]?.metadata).toEqual({ input: { query: "safe query" } });
      expect(spans[3]?.metadata).toEqual({
        input: {
          headers: { "Proxy-Authorization": "[REDACTED]" },
          subscriptionKey: "[REDACTED]",
          googleClientSecret: "[REDACTED]",
          providerToken: "[REDACTED]",
        },
      });
    });

    it("getFeedback adds user_id filter when userId is provided", async () => {
      await getFeedback({ sinceMs: 500, limit: 20, userId: "bob" });
      const call = lastSelect();
      expect(call.sql).toMatch(/user_id = \?/);
      expect(call.sql).not.toContain("ROW_NUMBER()");
      expect(call.sql).toMatch(/ORDER BY created_at DESC LIMIT \?$/);
      expect(call.args).toEqual([500, "bob", 20]);
    });

    it("bounds feedback independently for each selected thread", async () => {
      await getFeedback({
        runIds: ["run-a", "run-b"],
        threadIds: ["thread-a", "thread-b"],
        sinceMs: 500,
        feedbackType: "thumbs_down",
        userId: "alice",
        orgId: "org-a",
        source: "human_review",
        limit: 1,
        perThreadLimit: 3,
      });
      const call = lastSelect();
      expect(call.sql).toMatch(
        /PARTITION BY thread_id ORDER BY created_at DESC, id DESC/,
      );
      expect(call.sql).toMatch(/WHERE feedback_row_number <= \?/);
      expect(call.sql).toMatch(
        /FROM agent_feedback WHERE run_id IN \(\?, \?\) AND thread_id IN \(\?, \?\) AND created_at >= \? AND feedback_type = \? AND user_id = \? AND org_id = \? AND source = \?/,
      );
      expect(call.sql).not.toContain("LIMIT ?");
      expect(call.args).toEqual([
        "run-a",
        "run-b",
        "thread-a",
        "thread-b",
        500,
        "thumbs_down",
        "alice",
        "org-a",
        "human_review",
        3,
      ]);
    });

    it("reads feedback only for the explicit org/run pairs in review groups", async () => {
      await getFeedback({
        runScopes: [
          { orgId: "org-a", runId: "shared-run" },
          { orgId: "org-b", runId: "shared-run" },
        ],
        perThreadLimit: 6,
      });

      const call = lastSelect();
      expect(call.sql).toContain(
        "(org_id = ? AND run_id = ?) OR (org_id = ? AND run_id = ?)",
      );
      expect(call.sql).toContain(
        "PARTITION BY org_id,\n              CASE WHEN run_id IS NULL THEN 'thread:' || COALESCE(thread_id, '')",
      );
      expect(call.args).toEqual([
        "org-a",
        "shared-run",
        "org-b",
        "shared-run",
        6,
      ]);
    });

    it("retains the full bounded set of grouped feedback thread scopes", async () => {
      await getFeedback({
        threadScopes: Array.from({ length: 600 }, (_, index) => ({
          orgId: "org-a",
          threadId: `thread-${index}`,
        })),
      });

      const call = lastSelect();
      expect(
        call.sql.match(/\(org_id = \? AND thread_id = \?\)/g),
      ).toHaveLength(600);
      expect(call.args).toHaveLength(1201);
      expect(call.args).toContain("thread-599");
    });

    it("defaults review rollups to six feedback rows per thread and caps overrides", async () => {
      await getFeedback({
        threadIds: ["thread-a", "thread-b"],
        limit: 1,
      });
      const call = lastSelect();
      expect(call.sql).toContain("PARTITION BY thread_id");
      expect(call.sql).toContain("WHERE feedback_row_number <= ?");
      expect(call.args).toEqual(["thread-a", "thread-b", 6]);

      await getFeedback({
        threadIds: ["thread-a", "thread-b"],
        perThreadLimit: 99,
      });
      expect(lastSelect().args).toEqual(["thread-a", "thread-b", 12]);
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

    it("upsertTraceSummary persists user_id", async () => {
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
        /INSERT\s+INTO agent_trace_summaries/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.sql).toMatch(/\buser_id\b/);
      expect(call!.args).toContain("alice");
    });

    it("keeps summary org attribution immutable on conflict", async () => {
      await upsertHumanReviewSummary({
        runId: "r1",
        orgId: "org-a",
        ask: "Original ask",
        outcome: "Created a dashboard",
        artifacts: [
          { appId: "analytics", artifactId: "dash-1", title: "Weekly" },
        ],
        createdBy: "admin@example.com",
        createdAt: 1,
        updatedAt: 2,
      });
      const call = execCalls.find((entry) =>
        /INSERT\s+INTO agent_human_review_summaries/.test(entry.sql),
      );
      expect(call?.sql).toMatch(
        /WHERE agent_human_review_summaries\.org_id = EXCLUDED\.org_id/,
      );
      expect(call?.sql).not.toMatch(/org_id = EXCLUDED\.org_id,/);
      expect(call?.args).toContain("org-a");
      expect(call?.args).toContain(
        '[{"appId":"analytics","artifactId":"dash-1","title":"Weekly"}]',
      );
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
      const call = execCalls.find((c) => /INSERT INTO agent_evals/.test(c.sql));
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
        /INSERT INTO agent_satisfaction_scores/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.sql).toMatch(/\buser_id\b/);
      expect(call!.args).toContain("alice");
    });

    it("insertFeedback persists user_id and dedupes idempotency keys", async () => {
      await insertFeedback({
        id: "f1",
        runId: null,
        threadId: "t1",
        messageSeq: null,
        feedbackType: "thumbs_up",
        value: "",
        idempotencyKey: "feedback-key-1",
        userId: "alice",
        createdAt: 1,
      });
      const call = execCalls.find((c) =>
        /INSERT INTO agent_feedback/.test(c.sql),
      );
      expect(call).toBeDefined();
      expect(call!.args).toContain("alice");
      expect(call!.args).toContain("feedback-key-1");
      expect(call!.sql).toMatch(/idempotency_key/);
      expect(call!.sql).toMatch(/ON CONFLICT DO NOTHING/);
    });
  });
});
