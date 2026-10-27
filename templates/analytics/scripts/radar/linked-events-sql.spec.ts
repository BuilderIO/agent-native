import { describe, expect, it } from "vitest";

import { addLinkedEventMetricsSql } from "./linked-events-sql.ts";
import { buildEventStatsSql } from "./sql.ts";
import { buildBigQueryEventStatsSql } from "./warehouse-sql.ts";

const table = "`project_id.analytics.events_raw_query_range`";

describe("linked event metrics SQL", () => {
  it("links daily Postgres outcomes by user, output, or recording attempt", () => {
    const sql = addLinkedEventMetricsSql(
      buildEventStatsSql(),
      "postgres",
      "DAY",
    );

    expect(sql).toContain(", linked_events AS (");
    const postgresPeriod = "date_trunc($4, happened_at, 'UTC') AS period_start";
    expect(sql.split(postgresPeriod).length - 1).toBe(2);
    expect(sql).toContain("f.person_key = s.person_key");
    expect(sql).toContain("f.generation_attempt_id = s.generation_attempt_id");
    expect(sql).toContain("f.happened_at > s.started_at");
    expect(sql).toContain(
      "o.person_key = p.person_key AND o.output_id = p.output_id",
    );
    expect(sql).toContain("o.happened_at > p.prompt_at");
    expect(sql).toContain("r.recording_attempt_id = s.recording_attempt_id");
    expect(sql).toContain("r.happened_at > s.started_at");
    expect(sql).toContain("AS linked_slides_unlinked_events");
    expect(sql).toContain("AS linked_design_unlinked_events");
    expect(sql).toContain("AS linked_clips_unlinked_events");
  });

  it("uses the same event period and tracking keys in BigQuery", () => {
    const sql = addLinkedEventMetricsSql(
      buildBigQueryEventStatsSql(table, "DAY"),
      "bigquery",
      "DAY",
    );

    expect(sql).toContain(
      "timestamp_trunc(happened_at, DAY, 'UTC') AS period_start",
    );
    expect(sql).toContain("json_value(properties, '$.generation_attempt_id')");
    expect(sql).toContain("json_value(properties, '$.output_id')");
    expect(sql).toContain("json_value(properties, '$.recording_attempt_id')");
    expect(sql).toContain(
      "countif(person_key IS NULL OR generation_attempt_id IS NULL)",
    );
    expect(sql).toContain("countif(person_key IS NULL OR output_id IS NULL)");
    expect(sql).toContain("countif(recording_attempt_id IS NULL)");
  });

  it("fails loudly if the aggregate query shape changes", () => {
    expect(() =>
      addLinkedEventMetricsSql("SELECT * FROM event_stats", "postgres", "DAY"),
    ).toThrow("Event stats SQL has an unsupported final SELECT.");
  });
});
