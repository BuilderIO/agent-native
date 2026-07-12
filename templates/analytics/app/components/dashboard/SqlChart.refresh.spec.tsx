// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoModeEnabled: false,
  query: {
    data: {
      rows: [{ value: 42 }] as Record<string, unknown>[],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  },
  createDemoChartTrendRows: vi.fn((rows: Record<string, unknown>[]) => rows),
}));

vi.mock("@agent-native/core/client", () => ({
  useDemoModeStatus: () => ({
    enabled: mocks.demoModeEnabled,
    forced: false,
    isLoading: false,
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: mocks.createDemoChartTrendRows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => mocks.query,
}));

import { SqlChart } from "./SqlChart";

describe("SqlChart refresh feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.demoModeEnabled = false;
    mocks.query.data = { rows: [{ value: 42 }] };
    mocks.query.isLoading = false;
    mocks.query.isFetching = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("restores the panel skeleton while cached data is refetching", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };

    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(container.textContent).toContain("42");
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();

    mocks.query.isFetching = true;
    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("42");

    mocks.query.isFetching = false;
    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();
    expect(container.textContent).toContain("42");
  });

  it("reshapes line data only while Demo mode is enabled", async () => {
    const panel = {
      id: "signups-over-time",
      title: "Signups over time",
      sql: "SELECT date, value FROM signups",
      source: "first-party" as const,
      chartType: "line" as const,
      width: 1,
      config: { xKey: "date", yKey: "value" },
    };
    mocks.query.data = {
      rows: [
        { date: "2026-07-01", value: 5 },
        { date: "2026-07-02", value: 2 },
        { date: "2026-07-03", value: 9 },
      ],
    };

    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });
    expect(mocks.createDemoChartTrendRows).not.toHaveBeenCalled();

    mocks.demoModeEnabled = true;
    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(mocks.createDemoChartTrendRows).toHaveBeenCalledWith(
      mocks.query.data.rows,
      ["value"],
      "signups-over-time",
    );
  });
});
