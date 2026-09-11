import { describe, expect, it } from "vitest";

import {
  canFormatPanelSql,
  formatPanelSql,
  safeFormatPanelSql,
} from "./format-sql";

describe("formatPanelSql", () => {
  it("formats BigQuery SQL while preserving dashboard variables", () => {
    expect(
      formatPanelSql(
        "select date, count(*) as users from `analytics.events` where event_date between {{dateStart}} and {{dateEnd}} group by 1 order by 1",
        "bigquery",
      ),
    ).toBe(`SELECT
  date,
  count(*) AS users
FROM
  \`analytics.events\`
WHERE
  event_date BETWEEN {{dateStart}} AND {{dateEnd}}
GROUP BY
  1
ORDER BY
  1`);
  });

  it("does not try to format JSON descriptor sources", () => {
    expect(canFormatPanelSql("amplitude")).toBe(false);
    expect(formatPanelSql('{"event":"signup"}', "amplitude")).toBe(
      '{"event":"signup"}',
    );
  });

  it("formats first-party Postgres JSON operators", () => {
    expect(
      formatPanelSql(
        "select properties::jsonb ->> 'templateId' as template, count(*) filter (where timestamp::timestamptz >= now() - interval '30 days')::float as rate from analytics_events where '{{timeRange}}' in ('', 'all') group by 1",
        "first-party",
      ),
    ).toBe(`SELECT
  properties::jsonb ->> 'templateId' AS template,
  count(*) FILTER (
    WHERE
      timestamp::timestamptz >= now() - interval '30 days'
  )::float AS rate
FROM
  analytics_events
WHERE
  '{{timeRange}}' IN ('', 'all')
GROUP BY
  1`);
  });

  it("returns original SQL and an error from safe formatting on parser gaps", () => {
    const sql = "select 'unterminated";
    const result = safeFormatPanelSql(sql, "first-party");
    expect(result.sql).toBe(sql);
    expect(result.error).toEqual(expect.any(String));
  });
});
