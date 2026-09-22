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
});
