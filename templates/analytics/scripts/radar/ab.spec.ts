import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  resolveRadarOrganizationId: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, ...queryMocks };
});

import {
  buildBigQueryAbSql,
  buildPostgresAbSql,
  isConfiguredAbVariant,
  parseAbReadoutArgs,
  runAbReadout,
} from "./ab.ts";

beforeEach(() => {
  vi.clearAllMocks();
  queryMocks.resolveRadarOrganizationId.mockResolvedValue("org-1");
  queryMocks.resolveRadarFirstPartyBackend.mockResolvedValue({
    sink: "postgres",
    table: null,
  });
  queryMocks.runPostgresQuery.mockResolvedValue({ rows: [] });
});

describe("experiment cohort SQL", () => {
  it.each([
    ["PostgreSQL", buildPostgresAbSql()],
    ["BigQuery", buildBigQueryAbSql("`project.analytics.events_query_range`")],
  ])("only selects configured experiment variants (%s)", (_name, sql) => {
    expect(sql).toContain("'control', 'credits'");
  });

  it.each([
    ["PostgreSQL", buildPostgresAbSql()],
    ["BigQuery", buildBigQueryAbSql("`project.analytics.events_query_range`")],
  ])(
    "assigns downstream outcomes through the exposure cohort (%s)",
    (_name, sql) => {
      expect(sql).toContain(
        "WHERE event_name = 'onboarding_experiment_exposed'",
      );
      expect(sql).toContain(
        "LEFT JOIN base_events e ON e.person_key = x.person_key",
      );
      expect(sql).toContain("e.happened_at >= x.exposed_at");
      expect(sql).toMatch(/e\.happened_at <= (\$4::timestamptz|@as_of)/);
      expect(sql).toContain("experiment_variant");
    },
  );

  it.each([
    ["PostgreSQL", buildPostgresAbSql(), "interval '48 hours'", "$2::date"],
    [
      "BigQuery",
      buildBigQueryAbSql("`project.analytics.events_query_range`"),
      "INTERVAL 48 HOUR",
      "@end_date",
    ],
  ])(
    "requires full observation windows before marking D1 and D7 mature (%s)",
    (_name, sql, window, cutoff) => {
      expect(sql).toContain(window);
      expect(sql).toContain(cutoff);
      expect(sql).toContain("d1_mature");
      expect(sql).toContain("d7_mature");
    },
  );
});

describe("configured experiment variants", () => {
  it.each(["control", "credits"])("accepts %s", (variant) => {
    expect(isConfiguredAbVariant(variant)).toBe(true);
  });

  it.each(["unexpected-arm", "control\nprivate text", null, undefined, 2])(
    "rejects unconfigured values without exposing them",
    (variant) => {
      expect(isConfiguredAbVariant(variant)).toBe(false);
    },
  );
});

describe("A/B readout arguments", () => {
  it.each([
    [["--start"]],
    [["--end", "--as-of", "2026-10-26T00:00:00Z"]],
    [["--as-of"]],
    [["--experiment"]],
  ])("rejects a missing flag value", (args) => {
    expect(() => parseAbReadoutArgs(args)).toThrow(/requires a value/);
  });

  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-02-28", "2026-02-30"],
  ])(
    "rejects impossible calendar dates %s to %s",
    async (startDate, endDate) => {
      await expect(runAbReadout({ startDate, endDate })).rejects.toMatchObject({
        exitCode: 2,
        message: "A valid ordered --start and --end date is required.",
      });
    },
  );

  it.each(["2026-02-30T12:00:00Z", "2026-10-26T12:00:00", "2026-10-26"])(
    "rejects invalid or timezone-free --as-of timestamp %s",
    async (asOf) => {
      await expect(
        runAbReadout({
          startDate: "2026-10-19",
          endDate: "2026-10-26",
          asOf,
        }),
      ).rejects.toMatchObject({
        exitCode: 2,
        message:
          "--as-of must be an ISO timestamp with a valid date and explicit UTC offset.",
      });
    },
  );

  it("accepts an --as-of timestamp with an explicit UTC offset", async () => {
    queryMocks.runPostgresQuery.mockResolvedValue({
      rows: [
        { app: "all", variant: "control" },
        { app: "all", variant: "credits" },
      ],
    });

    const result = await runAbReadout({
      startDate: "2026-10-19",
      endDate: "2026-10-26",
      asOf: "2026-10-26T12:00:00-07:00",
    });

    expect(result.dataCutoff).toBe("2026-10-26T19:00:00.000Z");
  });

  it("rejects an empty cohort instead of returning a ready empty readout", async () => {
    await expect(
      runAbReadout({ startDate: "2026-10-19", endDate: "2026-10-26" }),
    ).rejects.toMatchObject({
      exitCode: 2,
      message: "A/B readout did not return both configured experiment arms.",
    });
  });

  it("rejects a readout that contains only one experiment arm", async () => {
    queryMocks.runPostgresQuery.mockResolvedValue({
      rows: [{ app: "all", variant: "control", exposed: 10 }],
    });

    await expect(
      runAbReadout({ startDate: "2026-10-19", endDate: "2026-10-26" }),
    ).rejects.toMatchObject({
      exitCode: 2,
      message: "A/B readout did not return both configured experiment arms.",
    });
  });
});
