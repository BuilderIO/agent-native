import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getQuery: (event: any) => event.query ?? {},
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

describe("poll handler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    mockExecute.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits screen-refresh events when the refresh marker changes", async () => {
    let appStateTs = 1_000;
    let settingsTs = 900;
    let refreshTs = 500;
    let refreshValue = JSON.stringify({ scope: "initial" });

    mockExecute.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (
        sql.includes("MAX(updated_at)") &&
        sql.includes("application_state")
      ) {
        return { rows: [{ max_ts: appStateTs }] };
      }
      if (sql.includes("MAX(updated_at)") && sql.includes("settings")) {
        return { rows: [{ max_ts: settingsTs }] };
      }
      if (sql.includes("WHERE key = ?")) {
        return { rows: [{ updated_at: refreshTs, value: refreshValue }] };
      }
      return { rows: [] };
    });

    const { createPollHandler } = await import("./poll.js");
    const handler = createPollHandler() as any;

    const baseline = await handler({ query: { since: "0" } });
    expect(baseline).toEqual({ version: 1_000, events: [] });

    vi.setSystemTime(101_500);
    appStateTs = 2_000;
    settingsTs = 900;
    refreshTs = 2_000;
    refreshValue = JSON.stringify({ scope: "documents" });

    const next = await handler({ query: { since: String(baseline.version) } });

    expect(next.version).toBeGreaterThan(baseline.version);
    expect(next.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "screen-refresh",
          type: "change",
          key: "__screen_refresh__",
          scope: "documents",
        }),
      ]),
    );
  });
});
