import { afterEach, describe, expect, it, vi } from "vitest";

import { withDbTimeout } from "./client.js";
import {
  beginDatabaseOperation,
  createDatabaseRequestTelemetry,
  runWithDatabaseRequestTelemetry,
} from "./request-telemetry.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("database request telemetry", () => {
  it("tracks cumulative operation time and overlapping wall time separately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const telemetry = createDatabaseRequestTelemetry();

    runWithDatabaseRequestTelemetry(telemetry, () => {
      const finishFirst = beginDatabaseOperation("query");
      vi.setSystemTime(10);
      const finishSecond = beginDatabaseOperation("query");
      vi.setSystemTime(20);
      finishFirst("success");
      vi.setSystemTime(30);
      finishSecond("success");
    });

    expect(telemetry.queryCount).toBe(2);
    expect(telemetry.operationTotalMs).toBe(40);
    expect(telemetry.operationWallMs).toBe(30);
    expect(telemetry.slowestOperationMs).toBe(20);
  });

  it("tracks a direct HTTP query as one database query", async () => {
    const telemetry = createDatabaseRequestTelemetry();

    await runWithDatabaseRequestTelemetry(telemetry, () =>
      withDbTimeout("http-query", async () => "ok", 100),
    );

    expect(telemetry.operationCount).toBe(1);
    expect(telemetry.queryCount).toBe(1);
  });

  it("records returned rows and observed catalog and migration-table queries", async () => {
    const telemetry = createDatabaseRequestTelemetry();

    await runWithDatabaseRequestTelemetry(telemetry, () =>
      withDbTimeout(
        "http-query",
        async () => ({ rows: [{ name: "one" }, { name: "two" }] }),
        100,
        undefined,
        {
          sql: "SELECT name FROM information_schema.columns JOIN _org_migrations_named ON true",
        },
      ),
    );

    expect(telemetry.queryCount).toBe(1);
    expect(telemetry.rowsReturned).toBe(2);
    expect(telemetry.catalogQueryCount).toBe(1);
    expect(telemetry.migrationTableQueryCount).toBe(1);
  });

  it("classifies app-prefixed migration tables", async () => {
    const telemetry = createDatabaseRequestTelemetry();

    await runWithDatabaseRequestTelemetry(telemetry, () =>
      withDbTimeout("http-query", async () => [], 100, undefined, {
        sql: 'SELECT name FROM public."forms_migrations"',
      }),
    );

    expect(telemetry.migrationTableQueryCount).toBe(1);
  });

  it("does not classify catalog names inside comments or string literals", async () => {
    const telemetry = createDatabaseRequestTelemetry();

    await runWithDatabaseRequestTelemetry(telemetry, () =>
      withDbTimeout("http-query", async () => [{ ok: true }], 100, undefined, {
        sql: "SELECT 'pg_catalog._fake_migrations' AS note -- information_schema",
      }),
    );

    expect(telemetry.rowsReturned).toBe(1);
    expect(telemetry.catalogQueryCount).toBe(0);
    expect(telemetry.migrationTableQueryCount).toBe(0);
  });

  // Without AsyncLocalStorage nothing scopes the telemetry to the request, so
  // reporting it as measured would log zero database work as a real reading.
  it("reports the request as unmeasured when the runtime has no AsyncLocalStorage", async () => {
    const storageKey = Symbol.for(
      "@agent-native/core/db.request-telemetry-storage",
    );
    const globals = globalThis as Record<symbol, unknown>;
    const savedStorage = globals[storageKey];
    Reflect.deleteProperty(globals, storageKey);
    vi.resetModules();
    vi.doMock("../shared/optional-node-builtins.js", () => ({
      getAsyncLocalStorageCtor: () => undefined,
    }));
    try {
      const telemetryModule = await import("./request-telemetry.js");

      expect(
        telemetryModule.enterDatabaseRequestTelemetry(
          telemetryModule.createDatabaseRequestTelemetry(),
        ),
      ).toBe(false);
    } finally {
      vi.doUnmock("../shared/optional-node-builtins.js");
      vi.resetModules();
      globals[storageKey] = savedStorage;
    }
  });
});
