import { describe, expect, it } from "vitest";
import { canFormatPanelSql, formatPanelSql } from "./format-sql";

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
});
