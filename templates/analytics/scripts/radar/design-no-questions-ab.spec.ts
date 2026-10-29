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
        signup_assignment_failures: 2,
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
    "uses server traces, client-observed ready events and maturity joins (%s)",
    (_name, sql) => {
      expect(sql).toContain("agent_experiment_exposed");
      expect(sql).not.toContain("design_prompt_submitted");
      expect(sql).toContain("design_ready_viewed");
      expect(sql).toContain("design_exported");
      expect(sql).toContain("telemetry_origin");
      expect(sql).toContain("output_id");
      const serverOriginFilter =
        _name === "PostgreSQL"
          ? "properties ->> 'telemetry_origin' = 'server'"
          : "json_value(properties, '$.telemetry_origin') = 'server'";
      const exposureRows =
        /exposure_rows AS \(([\s\S]*?)\),\s*exposures AS/.exec(sql)?.[1];
      const assignmentFailures =
        /assignment_failures AS \(([\s\S]*?)\),\s*prompts AS/.exec(sql)?.[1];
      const readyEvents = /ready AS \(([\s\S]*?)\),\s*second_prompts AS/.exec(
        sql,
      )?.[1];
      expect(exposureRows).toContain("agent_experiment_exposed");
      expect(exposureRows).toContain(serverOriginFilter);
      expect(assignmentFailures).toContain(
        "agent_experiment_assignment_failed",
      );
      expect(assignmentFailures).toContain(serverOriginFilter);
      expect(readyEvents).toContain(
        _name === "PostgreSQL"
          ? "properties ->> 'telemetry_origin' = 'client'"
          : "json_value(e.properties, '$.telemetry_origin') = 'client'",
      );
      expect(readyEvents).toContain("turn_id");
      expect(readyEvents).not.toContain("telemetry_origin' = 'server'");
      if (_name === "PostgreSQL") {
        expect(sql).toContain("e.properties ->> 'output_id' = r.output_id");
        expect(sql).toContain("e.properties ->> 'telemetry_origin' = 'server'");
        expect(sql).not.toContain(
          "e.properties ->> 'render_location' = 'browser'",
        );
      } else {
        expect(sql).toContain(
          "json_value(e.properties, '$.output_id') = r.output_id",
        );
        expect(sql).toContain(
          "json_value(e.properties, '$.telemetry_origin') = 'server'",
        );
        expect(sql).not.toContain(
          "json_value(e.properties, '$.render_location') = 'browser'",
        );
      }
      expect(sql).toContain("event_name = '$ai_generation'");
      expect(sql).toContain("exposed_turn_id");
      expect(sql).toContain("<> a.exposed_turn_id");
      expect(sql).toContain("experiment_ids");
      expect(sql).toContain("experiment_variants");
      expect(sql).toContain("render_location");
      expect(sql).toContain("agent_experiment_assignment_failed");
      expect(sql).toContain("signup_assignment_failures");
      expect(sql).toContain("caller");
      expect(sql).toContain("no_questions");
      expect(sql).toContain("mature_1to7d");
      expect(sql).toContain("mature_24h");
      expect(sql).toContain(
        _name === "PostgreSQL"
          ? "AND happened_at <= $4::timestamptz"
          : "AND happened_at <= @as_of",
      );
    },
  );

  it("bounds exposures by the requested dates and outcomes by the data cutoff", () => {
    const postgresSql = buildPostgresDesignNoQuestionsAbSql();
    const bigQuerySql = buildBigQueryDesignNoQuestionsAbSql(
      "`project.analytics.events_query_range`",
    );

    expect(postgresSql).toContain(
      "e.event_date <= to_char($4::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')",
    );
    expect(postgresSql).toContain("AND event_date BETWEEN $1 AND $2");
    expect(postgresSql).toContain("AND e.happened_at <= $4::timestamptz");
    expect(bigQuerySql).toMatch(
      /events_query_range`?\(@start_date, DATE\(@as_of\)\)/,
    );
    expect(bigQuerySql).toContain(
      "AND event_date BETWEEN @start_date AND @end_date",
    );
    expect(bigQuerySql).toContain("AND e.happened_at <= @as_of");
  });

  it("reports all requested metrics with mature denominators and sample size", async () => {
    const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const asOf = new Date(Date.now() - 60 * 1000).toISOString();
    expect(asOf.slice(0, 10)).not.toBe(startDate);
    const result = await runDesignNoQuestionsReadout({
      startDate,
      endDate: startDate,
      asOf,
    });

    expect(result.dataCutoff).toBe(asOf);
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
    expect(result.signupAssignmentFailures).toBe(2);
    expect(formatDesignNoQuestionsReadout(result)).toContain(
      "358 per arm (716 total)",
    );
    expect(formatDesignNoQuestionsReadout(result)).toContain(
      "Signup assignment failures with no arm: 2",
    );
    expect(formatDesignNoQuestionsReadout(result)).toContain(
      "Design-ready is client-observed",
    );
    expect(formatDesignNoQuestionsReadout(result)).toContain(
      "Completed UI exports use server-origin events matching the output ID",
    );
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      buildPostgresDesignNoQuestionsAbSql(),
      [startDate, startDate, "org-1", asOf],
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
