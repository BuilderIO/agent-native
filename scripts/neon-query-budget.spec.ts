import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  beginDatabaseOperation,
  createDatabaseRequestTelemetry,
} from "../packages/core/src/db/request-telemetry.ts";
import {
  compareQueryBudget,
  parseCacheablePageMetrics,
  parsePrivateRequestMetrics,
  withSchemaProvisioningRuntime,
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
        poolAcquisitions: 2,
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

  it("provisions fixture schemas outside serverless mode and restores runtime state", async () => {
    const keys = ["NETLIFY", "NETLIFY_FUNCTION_NAME", "CONTEXT"] as const;
    const previousEnvironment = new Map(
      keys.map((key) => [key, process.env[key]]),
    );
    const runtime = globalThis as typeof globalThis & {
      __AGENT_NATIVE_MIGRATION_RUNTIME__?: boolean;
    };
    const previousMigrationRuntime = runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
    const startupState = (globalThis as any)[
      Symbol.for("@agent-native/core/db.startup-telemetry-state")
    ] as {
      telemetry: ReturnType<typeof createDatabaseRequestTelemetry>;
    };
    const startupQueryCount = startupState.telemetry.queryCount;
    process.env.NETLIFY = "true";
    process.env.NETLIFY_FUNCTION_NAME = "serverless-fixture";
    process.env.CONTEXT = "production";
    runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = false;

    try {
      const fixtureEnvironment = await withSchemaProvisioningRuntime(
        async () => {
          const endOperation = beginDatabaseOperation("query");
          endOperation("success");
          return {
            netlify: process.env.NETLIFY,
            functionName: process.env.NETLIFY_FUNCTION_NAME,
            context: process.env.CONTEXT,
            migrationRuntime: runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__,
          };
        },
      );
      assert.deepEqual(fixtureEnvironment, {
        netlify: undefined,
        functionName: undefined,
        context: "production",
        migrationRuntime: true,
      });
      assert.equal(process.env.NETLIFY, "true");
      assert.equal(process.env.NETLIFY_FUNCTION_NAME, "serverless-fixture");
      assert.equal(process.env.CONTEXT, "production");
      assert.equal(runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__, false);
      assert.equal(startupState.telemetry.queryCount, startupQueryCount);
    } finally {
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (previousMigrationRuntime === undefined) {
        delete runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
      } else {
        runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = previousMigrationRuntime;
      }
    }
  });

  it("checks request-scoped counters against a measured baseline", () => {
    const privateMetrics = parsePrivateRequestMetrics(
      "app;dur=5, db-queries;dur=3, db-connects;dur=1, db-rows;dur=8, db-catalog;dur=2, db-migrations;dur=1",
    );
    assert.deepEqual(privateMetrics, {
      queries: 3,
      poolAcquisitions: 1,
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
    assert.deepEqual(
      compareQueryBudget(
        {
          ...report,
          page: {
            ...privateMetrics,
            catalogQueries: 3,
            migrationTableQueries: 2,
          },
        },
        baseline,
        { absolute: 1, percent: 0.1 },
      ),
      [],
    );
    assert.ok(
      compareQueryBudget(
        { ...report, idlePoll: { ...privateMetrics, queries: 5 } },
        baseline,
        { absolute: 1, percent: 0.1 },
      ).includes("forms idlePoll.queries: measured 5, budget 4 (baseline 3)"),
    );
    const catalogAndMigrationRegressions = compareQueryBudget(
      {
        ...report,
        page: {
          ...privateMetrics,
          catalogQueries: 4,
          migrationTableQueries: 3,
        },
      },
      baseline,
      { absolute: 1, percent: 0.1 },
    );
    assert.ok(
      catalogAndMigrationRegressions.includes(
        "forms page.catalogQueries: measured 4, budget 3 (baseline 2)",
      ),
    );
    assert.ok(
      catalogAndMigrationRegressions.includes(
        "forms page.migrationTableQueries: measured 3, budget 2 (baseline 1)",
      ),
    );
    const incompleteBudget = structuredClone(baseline);
    Reflect.deleteProperty(incompleteBudget.budget.page, "catalogQueries");
    assert.ok(
      compareQueryBudget(report, incompleteBudget, {
        absolute: 1,
        percent: 0.1,
      }).includes(
        "forms page.catalogQueries: budget baseline is missing or invalid",
      ),
    );
  });
});
