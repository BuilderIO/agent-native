import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  resolveRadarOrganizationId: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  resolveRadarBigQueryEventsTable: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, ...queryMocks };
});

import {
  buildBigQueryDesignNoQuestionsAbSql,
  buildPostgresDesignNoQuestionsAbSql,
  formatDesignNoQuestionsReadout,
  runDesignNoQuestionsReadout,
  sampleNeededPerArmForTenPointLift,
} from "./design-no-questions-ab.ts";

beforeEach(() => {
  vi.clearAllMocks();
  queryMocks.resolveRadarOrganizationId.mockResolvedValue("org-1");
  queryMocks.resolveRadarFirstPartyBackend.mockResolvedValue({
    sink: "postgres",
    table: null,
  });
  queryMocks.runPostgresQuery.mockResolvedValue({
    rows: [
      {
        variant: "control",
        exposed: 10,
        prompt_joined: 10,
        mature_24h: 8,
        mature_24h_prompt: 8,
        ready_24h: 4,
        time_p50_ms: 120000,
        time_p90_ms: 240000,
        second_prompt_24h: 3,
        completed_export_24h: 2,
        mature_1to7d: 5,
        return_1to7d: 1,
      },
      {
        variant: "no_questions",
        exposed: 11,
        prompt_joined: 11,
        mature_24h: 9,
        mature_24h_prompt: 9,
        ready_24h: 6,
        time_p50_ms: 90000,
        time_p90_ms: 180000,
        second_prompt_24h: 2,
        completed_export_24h: 3,
        mature_1to7d: 4,
        return_1to7d: 2,
      },
    ],
  });
});

describe("Design no-questions readout query", () => {
  it.each([
    ["PostgreSQL", buildPostgresDesignNoQuestionsAbSql()],
    [
      "BigQuery",
      buildBigQueryDesignNoQuestionsAbSql(
        "`project.analytics.events_query_range`",
      ),
    ],
  ])(
    "uses explicit exposure, prompt, outcome and maturity joins (%s)",
    (_name, sql) => {
      expect(sql).toContain("agent_experiment_exposed");
      expect(sql).toContain("design_prompt_submitted");
      expect(sql).toContain("design_ready_viewed");
      expect(sql).toContain("design_exported");
      expect(sql).toContain("no_questions");
      expect(sql).toContain("mature_1to7d");
      expect(sql).toContain("mature_24h");
      expect(
        sql.match(/AND happened_at <= (\$4::timestamptz|@as_of)/g),
      ).toHaveLength(2);
    },
  );

  it("reports all requested metrics with mature denominators and sample size", async () => {
    const result = await runDesignNoQuestionsReadout({
      startDate: "2026-10-27",
      endDate: "2026-10-27",
      asOf: "2026-10-27T00:01:00Z",
    });

    expect(result.sampleNeededPerArm).toBe(358);
    expect(result.sampleNeededTotal).toBe(716);
    expect(result.arms[0]).toMatchObject({
      variant: "control",
      exposed: 10,
      mature24h: 8,
      ready24h: { users: 4, rate: 0.5 },
      secondPrompt24h: { users: 3, denominator: 8 },
      completedExport24h: { users: 2, denominator: 8 },
      return1to7d: { users: 1, denominator: 5 },
    });
    expect(formatDesignNoQuestionsReadout(result)).toContain(
      "358 per arm (716 total)",
    );
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      buildPostgresDesignNoQuestionsAbSql(),
      ["2026-10-27", "2026-10-27", "org-1", "2026-10-27T00:01:00.000Z"],
      { fresh: true, cache: false },
    );
  });

  it("requires full query maturity windows when readout arguments are valid", async () => {
    expect(sampleNeededPerArmForTenPointLift()).toBe(358);
    await expect(
      runDesignNoQuestionsReadout({
        startDate: "2026-02-30",
        endDate: "2026-03-01",
      }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});
