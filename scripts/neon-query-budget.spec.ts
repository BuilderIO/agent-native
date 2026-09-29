import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareQueryBudget,
  parseCacheablePageMetrics,
  parsePrivateRequestMetrics,
  type QueryBudgetReport,
} from "./neon-query-budget.ts";

describe("Neon cold-request query budgets", () => {
  it("parses cacheable page counters including startup queries", () => {
    assert.deepEqual(
      parseCacheablePageMetrics(
        'origin;dur=18;desc="2026-09-29T00:00:00.000Z cold boot=2 init=8 dbq=3 dbrows=4 dbcatalog=1 dbmigrations=2 dbconnects=1 startupdbq=5 startupdbrows=6 startupdbcatalog=2 startupdbmigrations=3 startupdbconnects=1"',
      ),
      {
        queries: 8,
        rowsReturned: 10,
        catalogQueries: 3,
        migrationTableQueries: 5,
        newConnections: 2,
      },
    );
  });

  it("requires every observed counter instead of treating missing as zero", () => {
    assert.throws(
      () =>
        parseCacheablePageMetrics(
          'origin;dur=18;desc="2026-09-29T00:00:00.000Z dbq=0 dbrows=0 dbcatalog=0 dbmigrations=0 dbconnects=0 startupdb=unavailable"',
        ),
      /cold page database counters were incomplete/,
    );
    assert.throws(
      () => parsePrivateRequestMetrics("app;dur=5, db-queries;dur=0"),
      /response omitted required database counters/,
    );
  });

  it("checks request-scoped counters against a measured baseline", () => {
    const privateMetrics = parsePrivateRequestMetrics(
      "app;dur=5, db-queries;dur=3, db-connects;dur=1, db-rows;dur=8, db-catalog;dur=2, db-migrations;dur=1",
    );
    assert.deepEqual(privateMetrics, {
      queries: 3,
      newConnections: 1,
      rowsReturned: 8,
      catalogQueries: 2,
      migrationTableQueries: 1,
    });

    const report: QueryBudgetReport = {
      template: "forms",
      action: "list-forms",
      page: privateMetrics,
      listAction: privateMetrics,
      idlePoll: privateMetrics,
      pollRequests: 1,
      statuses: { page: 200, listAction: 200, idlePoll: 200 },
    };
    const baseline = {
      action: "list-forms",
      budget: {
        page: privateMetrics,
        listAction: privateMetrics,
        idlePoll: privateMetrics,
        pollRequests: 1,
      },
    };
    assert.deepEqual(
      compareQueryBudget(report, baseline, { absolute: 1, percent: 0.1 }),
      [],
    );
    assert.ok(
      compareQueryBudget(
        { ...report, idlePoll: { ...privateMetrics, queries: 5 } },
        baseline,
        { absolute: 1, percent: 0.1 },
      ).includes("forms idlePoll.queries: measured 5, budget 4 (baseline 3)"),
    );
  });
});
