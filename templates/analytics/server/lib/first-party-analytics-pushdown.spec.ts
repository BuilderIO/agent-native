import { describe, expect, it } from "vitest";

import { firstPartyEventPushdownPredicates } from "./first-party-analytics-pushdown.js";

function pushed(predicate: string): string[] {
  const source = "SELECT * FROM analytics_events WHERE org_id = 'org'";
  const sql = `SELECT id FROM (${source}) AS e WHERE ${predicate}`;
  return firstPartyEventPushdownPredicates(sql, sql.indexOf(source));
}

describe("constant predicate folding", () => {
  it.each(["'30d' = '30d'", "'30d' IN ('7d', '30d')", "TRUE"])(
    "unwraps true branches: %s",
    (condition) => {
      expect(
        pushed(
          `((('30d' = '7d' AND event_date >= DATE '2026-10-09') OR (${condition} AND ((event_date >= DATE '2026-09-16')))))`,
        ),
      ).toEqual(["event_date >= DATE '2026-09-16'"]);
    },
  );

  it.each(["'30d' = '7d'", "'30d' IN ('', 'all')", "FALSE"])(
    "drops false disjuncts: %s",
    (condition) => {
      expect(pushed(`(${condition} OR event_date <= CURRENT_DATE())`)).toEqual([
        "event_date <= CURRENT_DATE ( )",
      ]);
      expect(pushed(`(${condition} AND event_name = 'signup')`)).toEqual([]);
    },
  );

  it("preserves BETWEEN, aliases and conjunctions after folding", () => {
    expect(
      pushed(
        "'custom' = 'custom' AND (e.event_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-09' AND e.event_name IN ('signup', 'app_entered'))",
      ),
    ).toEqual([
      "event_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-09'",
      "event_name IN ( 'signup' , 'app_entered' )",
    ]);
  });

  it.each([
    "event_date >= DATE '2026-10-01' OR event_name = 'signup'",
    "'all' IN ('', 'all') OR event_date >= DATE '2026-10-01'",
    "NULL = 'all' OR event_date >= DATE '2026-10-01'",
    "'all' IN ('7d', NULL) OR event_date >= DATE '2026-10-01'",
    "@range = '7d' OR event_date >= DATE '2026-10-01'",
    "'7d' = '7d' AND (event_date >= received_at OR event_name = 'signup')",
    "event_date >= CASE WHEN 'all' = '7d' AND app = 'chat' THEN DATE '2026-10-01' ELSE DATE '2026-10-09' END",
    "NOT ('7d' = 'all' AND event_date >= DATE '2026-10-01')",
    "event_name = 'a OR event_date >= CURRENT_DATE()' OR event_name = 'signup'",
    String.raw`'a\nb' = 'a\nb' OR event_date >= DATE '2026-10-01'`,
    "'7d' IN (SELECT app FROM apps) OR event_date >= DATE '2026-10-01'",
  ])("leaves unproven expressions unpushed: %s", (predicate) => {
    expect(pushed(predicate)).toEqual([]);
  });

  it("does not promote mutable fields after eliminating constants", () => {
    expect(
      pushed("('7d' = '7d' AND app = 'chat') AND event_name = 'signup'"),
    ).toEqual(["event_name = 'signup'"]);
  });

  it("accepts frozen DATE bounds and leaves a row-dependent custom lookback outside", () => {
    expect(
      pushed(
        "event_date <= DATE '2026-10-16' AND ('custom' IN ('', 'all') OR ('custom' = 'custom' AND event_date >= DATE_SUB(DATE(app), INTERVAL 6 DAY) AND event_date <= DATE '2026-10-09'))",
      ),
    ).toEqual([
      "event_date <= DATE '2026-10-16'",
      "event_date <= DATE '2026-10-09'",
    ]);
  });
});
