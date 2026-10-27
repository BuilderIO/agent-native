import { describe, expect, it } from "vitest";

import { buildBigQueryAbSql, buildPostgresAbSql } from "./ab.ts";

describe("experiment cohort SQL", () => {
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
