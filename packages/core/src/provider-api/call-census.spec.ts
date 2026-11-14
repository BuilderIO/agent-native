import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CALL_CENSUS_FLUSH_AT,
  CALL_CENSUS_MAX_BUCKETS,
  CALL_CENSUS_WINDOW_MS,
  flushProviderCallCensus,
  recordProviderCall,
  resetProviderCallCensusForTests,
} from "./call-census.js";

const KEY = {
  app: "calendar-app",
  provider: "google_calendar",
  operation: "event_read",
  connection: "9f2c1d7a-0000-4000-8000-000000000000",
};

let log: ReturnType<typeof vi.spyOn>;

function lines(): Array<Record<string, unknown>> {
  return log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
}

beforeEach(() => {
  log = vi.spyOn(console, "info").mockImplementation(() => {});
  resetProviderCallCensusForTests();
});

afterEach(() => {
  resetProviderCallCensusForTests();
  log.mockRestore();
});

describe("provider call census", () => {
  it("holds a single call until the window closes", () => {
    recordProviderCall(KEY, 403, 1_000);
    expect(lines()).toHaveLength(0);
    expect(flushProviderCallCensus()).toBe(1);
    expect(lines()).toMatchObject([
      {
        event: "provider.api.calls",
        app: "calendar-app",
        provider: "google_calendar",
        operation: "event_read",
        connection: "9f2c1d7a",
        count: 1,
        failures: 1,
        statuses: { "403": 1 },
      },
    ]);
  });

  it(`flushes automatically at ${CALL_CENSUS_FLUSH_AT} calls, not one line per call`, () => {
    for (let i = 0; i < CALL_CENSUS_FLUSH_AT - 1; i++) {
      recordProviderCall(KEY, 200, 1_000 + i);
    }
    expect(lines()).toHaveLength(0);
    recordProviderCall(KEY, 200, 2_000);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      count: CALL_CENSUS_FLUSH_AT,
      failures: 0,
      statuses: { "200": CALL_CENSUS_FLUSH_AT },
    });
    // The bucket restarts after a flush instead of repeating the count.
    recordProviderCall(KEY, 500, 3_000);
    expect(flushProviderCallCensus()).toBe(1);
    expect(lines()[1]).toMatchObject({
      count: 1,
      failures: 1,
      statuses: { "500": 1 },
    });
  });

  it("flushes a slow lane by wall-clock window so a 3/min 403 is never invisible", () => {
    recordProviderCall(KEY, 403, 1_000);
    recordProviderCall(KEY, 403, 2_000);
    expect(lines()).toHaveLength(0);
    recordProviderCall(KEY, 403, 1_000 + CALL_CENSUS_WINDOW_MS);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      count: 3,
      failures: 3,
      statuses: { "403": 3 },
      windowMs: CALL_CENSUS_WINDOW_MS,
    });
  });

  it("separates apps, connections and operations that share one provider", () => {
    recordProviderCall({ ...KEY, app: "mail-app" }, 200, 1_000);
    recordProviderCall(
      { ...KEY, connection: "11111111-0000-4000-8000-000000000000" },
      200,
      1_000,
    );
    recordProviderCall({ ...KEY, operation: "calendar_list" }, 200, 1_000);
    expect(flushProviderCallCensus()).toBe(3);
    expect(
      lines().map((line) => [line.app, line.operation, line.connection]),
    ).toEqual([
      ["mail-app", "event_read", "9f2c1d7a"],
      ["calendar-app", "event_read", "11111111"],
      ["calendar-app", "calendar_list", "9f2c1d7a"],
    ]);
  });

  it("counts a call that never got a response as status 0 and a failure", () => {
    recordProviderCall(KEY, null, 1_000);
    flushProviderCallCensus();
    expect(lines()[0]).toMatchObject({
      count: 1,
      failures: 1,
      statuses: { "0": 1 },
    });
  });

  it("stays bounded under connection fan-out", () => {
    for (let i = 0; i < CALL_CENSUS_MAX_BUCKETS + 10; i++) {
      recordProviderCall(
        { ...KEY, connection: String(i).padStart(8, "0") },
        200,
        1_000,
      );
    }
    expect(flushProviderCallCensus()).toBeLessThanOrEqual(
      CALL_CENSUS_MAX_BUCKETS + 1,
    );
    expect(lines().at(-1)).toMatchObject({ app: "overflow", count: 10 });
  });

  it("emits no URL, query, body or address", () => {
    recordProviderCall(KEY, 200, 1_000);
    flushProviderCallCensus();
    const serialised = JSON.stringify(lines());
    expect(serialised).not.toMatch(/googleapis|@|\/events\?|q=/);
    expect(Object.keys(lines()[0]!).sort()).toEqual([
      "app",
      "censusId",
      "connection",
      "count",
      "event",
      "failures",
      "operation",
      "provider",
      "statuses",
      "windowMs",
    ]);
  });
});
