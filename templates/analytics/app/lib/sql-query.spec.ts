import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_REPORT_READY_TIMEOUT_MS,
  FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS,
} from "@shared/dashboard-report-timeouts";

const mocks = vi.hoisted(() => ({
  addBytesProcessed: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

vi.mock("./cost-tracker", () => ({
  addBytesProcessed: mocks.addBytesProcessed,
}));

import {
  DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
  executeSqlQuery,
} from "./sql-query";

describe("executeSqlQuery", () => {
  beforeEach(() => {
    mocks.addBytesProcessed.mockReset();
    mocks.callAction.mockReset();
  });

  it("uses the dashboard panel action with the existing source/query payload", async () => {
    const controller = new AbortController();
    mocks.callAction.mockResolvedValue({
      rows: [{ date: "2026-07-21", signups: 4 }],
      schema: [
        { name: "date", type: "string" },
        { name: "signups", type: "number" },
      ],
      bytesProcessed: 128,
    });

    await expect(
      executeSqlQuery(
        "SELECT date, signups FROM analytics_events",
        "first-party",
        controller.signal,
      ),
    ).resolves.toEqual({
      rows: [{ date: "2026-07-21", signups: 4 }],
      schema: [
        { name: "date", type: "string" },
        { name: "signups", type: "number" },
      ],
    });

    expect(mocks.callAction).toHaveBeenCalledWith(
      "query-dashboard-panel",
      {
        query: "SELECT date, signups FROM analytics_events",
        source: "first-party",
      },
      { signal: controller.signal },
    );
    expect(mocks.addBytesProcessed).toHaveBeenCalledWith(128);
  });

  it("ends report screenshot panel actions before the capture readiness deadline", async () => {
    const controller = new AbortController();
    mocks.callAction.mockResolvedValue({ rows: [] });

    await executeSqlQuery("SELECT 1", "first-party", controller.signal, {
      reportScreenshot: true,
    });

    expect(FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS).toBeLessThan(
      DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
    );
    expect(DASHBOARD_REPORT_ACTION_TIMEOUT_MS).toBeLessThan(
      DASHBOARD_REPORT_READY_TIMEOUT_MS,
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "query-dashboard-panel",
      { query: "SELECT 1", source: "first-party" },
      {
        signal: controller.signal,
        timeoutMs: DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
      },
    );
  });
});
