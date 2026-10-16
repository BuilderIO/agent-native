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
    isPlaceholderData: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  queryEnabled: undefined as boolean | undefined,
  queryRetainScope: undefined as string | undefined,
  queryRefreshToken: undefined as number | undefined,
  queryKey: null as string[] | null,
  createDemoChartTrendRows: vi.fn((rows: Record<string, unknown>[]) => rows),
  embeddedExtensionProps: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: mocks.demoModeEnabled,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: mocks.createDemoChartTrendRows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: (
    queryKey: string[],
    _sql: string,
    _source: string,
    options?: {
      enabled?: boolean;
      refreshToken?: number;
      retainPreviousScope?: string;
    },
  ) => {
    mocks.queryRetainScope = options?.retainPreviousScope;
    mocks.queryKey = queryKey;
    mocks.queryEnabled = options?.enabled;
    mocks.queryRefreshToken = options?.refreshToken;
    return mocks.query;
  },
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: (props: Record<string, unknown>) => {
    mocks.embeddedExtensionProps = props;
    return null;
  },
  ExtensionSlot: () => null,
}));

import { formatSqlChartError, limitChartRows, SqlChart } from "./SqlChart";

describe("limitChartRows", () => {
  it("keeps tables untouched and bounds chart point rendering", () => {
    const rows = Array.from({ length: 401 }, (_, index) => ({ index }));
    expect(limitChartRows(rows, "table")).toBe(rows);
    expect(limitChartRows(rows, "line")).toEqual(rows.slice(-400));
    expect(limitChartRows(rows, "heatmap")).toEqual(rows.slice(-400));
    expect(limitChartRows(rows, "bar")).toEqual(rows.slice(0, 400));
    expect(limitChartRows(rows, "pie")).toEqual(rows.slice(0, 400));
    expect(limitChartRows(rows, "funnel")).toEqual(rows.slice(0, 400));
    expect(limitChartRows(rows, "callout")).toEqual(rows.slice(0, 400));
  });
});

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
    mocks.query.isPlaceholderData = false;
    mocks.query.error = null;
    mocks.query.refetch = vi.fn();
    mocks.queryEnabled = undefined;
    mocks.queryRetainScope = undefined;
    mocks.queryRefreshToken = undefined;
    mocks.queryKey = null;
    mocks.embeddedExtensionProps = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const metricPanel = {
    id: "signups",
    title: "Signups",
    sql: "SELECT 42 AS value",
    source: "first-party" as const,
    chartType: "metric" as const,
    width: 1,
  };
  const updatingNotice = () =>
    container.querySelector("[data-dashboard-report-updating]");
  const loadingSkeleton = () =>
    container.querySelector('[data-dashboard-report-loading="true"]');

  it("keeps the last rows visible with a compact notice while the same query refreshes", async () => {
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });
    expect(container.textContent).toContain("42");
    expect(updatingNotice()).toBeNull();

    mocks.query.isFetching = true;
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });

    expect(loadingSkeleton()).toBeNull();
    expect(container.textContent).toContain("42");
    expect(
      updatingNotice()?.getAttribute("data-dashboard-report-updating"),
    ).toBe("refresh");
    expect(updatingNotice()?.textContent).toContain("sqlDashboard.updating");
    expect(
      updatingNotice()?.querySelector("svg")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(updatingNotice()?.querySelector('[role="status"]')).toBeNull();

    mocks.query.isFetching = false;
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });
    expect(updatingNotice()).toBeNull();
    expect(container.textContent).toContain("42");
  });

  it("labels rows from the previous filters while the new filters load", async () => {
    mocks.query.isFetching = true;
    mocks.query.isPlaceholderData = true;
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });

    expect(loadingSkeleton()).toBeNull();
    expect(container.textContent).toContain("42");
    expect(
      updatingNotice()?.getAttribute("data-dashboard-report-updating"),
    ).toBe("previous-filters");
    expect(updatingNotice()?.textContent).toContain(
      "sqlDashboard.updatingPreviousFilters",
    );
  });

  it("keeps a completed empty result visible while it refreshes", async () => {
    mocks.query.data = { rows: [] };
    mocks.query.isFetching = true;
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });

    expect(loadingSkeleton()).toBeNull();
    expect(container.textContent).toContain("common.noData");
    expect(updatingNotice()).not.toBeNull();
  });

  it("shows the skeleton when a fetch has no completed result to keep", async () => {
    mocks.query.data = undefined as never;
    mocks.query.isLoading = true;
    mocks.query.isFetching = true;
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });

    expect(loadingSkeleton()?.className).toContain("skeleton-shimmer");
    expect(loadingSkeleton()?.className).toContain(
      "analytics-dashboard-panel-skeleton",
    );
    expect(updatingNotice()).toBeNull();
  });

  it("shows the skeleton while retrying a failure that has no rows", async () => {
    mocks.query.data = { rows: [] };
    mocks.query.error = new Error("query failed");
    mocks.query.isFetching = true;
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });

    expect(loadingSkeleton()).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps previous-filter rows beside a labelled error and a retry when the new filters fail", async () => {
    const onRefreshRequested = vi.fn();
    mocks.query.isPlaceholderData = true;
    mocks.query.error = new Error("new filters failed");
    await act(async () => {
      root.render(
        <SqlChart
          panel={metricPanel}
          onRefreshRequested={onRefreshRequested}
        />,
      );
    });

    expect(container.textContent).toContain("42");
    expect(updatingNotice()).toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("sqlDashboard.previousFilters");
    expect(alert?.textContent).toContain("new filters failed");
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(onRefreshRequested).toHaveBeenCalledTimes(1);

    mocks.query.isFetching = true;
    await act(async () => {
      root.render(
        <SqlChart
          panel={metricPanel}
          onRefreshRequested={onRefreshRequested}
        />,
      );
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      updatingNotice()?.getAttribute("data-dashboard-report-updating"),
    ).toBe("previous-filters");
  });

  it("does not call a same-query refresh failure previous filters", async () => {
    mocks.query.error = new Error("refresh failed");
    await act(async () => {
      root.render(<SqlChart panel={metricPanel} />);
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("refresh failed");
    expect(alert?.textContent).not.toContain("sqlDashboard.previousFilters");
  });

  it("scopes retained rows to the panel, dashboard, source, chart config and pivot range", async () => {
    const scopeOf = async (
      overrides: Record<string, unknown> = {},
      props: Record<string, unknown> = {},
    ) => {
      await act(async () => {
        root.render(
          <SqlChart
            panel={{ ...metricPanel, ...overrides } as never}
            dashboardId="dashboard-1"
            {...props}
          />,
        );
      });
      return mocks.queryRetainScope;
    };

    const base = await scopeOf();
    expect(base).toBeDefined();

    // A different filter changes only the SQL, so the scope must not change.
    expect(await scopeOf({}, { resolvedSql: "SELECT 7 AS value" })).toBe(base);
    expect(await scopeOf({ sql: "SELECT 7 AS value" })).toBe(base);
    expect(await scopeOf({}, { timeRange: 30 })).toBe(base);

    expect(await scopeOf({ id: "other" })).not.toBe(base);
    expect(await scopeOf({ source: "bigquery" })).not.toBe(base);
    expect(await scopeOf({ chartType: "table" })).not.toBe(base);
    expect(await scopeOf({ config: { yKey: "other" } })).not.toBe(base);
    expect(await scopeOf({}, { dashboardId: "dashboard-2" })).not.toBe(base);

    const pivot = { config: { pivot: { rowKey: "a", valueKey: "b" } } };
    const pivotBase = await scopeOf(pivot, { timeRange: 7 });
    expect(await scopeOf(pivot, { timeRange: 7 })).toBe(pivotBase);
    expect(await scopeOf(pivot, { timeRange: 30 })).not.toBe(pivotBase);
  });

  it("passes dashboard refresh tokens through to the query hook", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "bigquery" as const,
      chartType: "metric" as const,
      width: 1,
    };

    await act(async () => {
      root.render(<SqlChart panel={panel} refreshToken={0} />);
    });
    expect(mocks.queryRefreshToken).toBe(0);
    expect(mocks.query.refetch).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<SqlChart panel={panel} refreshToken={1} />);
    });

    expect(mocks.queryRefreshToken).toBe(1);
    expect(mocks.query.refetch).not.toHaveBeenCalled();
  });

  it("routes the error-card refresh action through its dashboard callback", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "bigquery" as const,
      chartType: "metric" as const,
      width: 1,
    };
    const onRefreshRequested = vi.fn();
    mocks.query.data = { rows: [] };
    mocks.query.error = new Error("query failed");

    await act(async () => {
      root.render(
        <SqlChart panel={panel} onRefreshRequested={onRefreshRequested} />,
      );
    });

    const refreshButton = container.querySelector("button");
    expect(refreshButton).not.toBeNull();
    await act(async () => {
      refreshButton?.click();
    });
    expect(onRefreshRequested).toHaveBeenCalledTimes(1);
  });

  it("renders cached data without starting a query when loading is disabled", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };

    await act(async () => {
      root.render(
        <SqlChart
          panel={panel}
          dashboardId="dashboard-1"
          loadData={false}
          showLoadingWhenDisabled={false}
        />,
      );
    });

    expect(mocks.queryEnabled).toBe(false);
    expect(mocks.queryKey).toEqual([
      "sql-chart",
      "dashboard-1",
      "SELECT 42 AS value",
      "first-party",
    ]);
    expect(container.textContent).toContain("42");
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();
  });

  it("renders a review result override without querying the active org", async () => {
    const panel = {
      id: "customer-orders",
      title: "Customer orders",
      sql: "SELECT total FROM orders",
      source: "bigquery" as const,
      chartType: "metric" as const,
      width: 1,
    };
    mocks.query.data = { rows: [{ total: 1 }] };

    await act(async () => {
      root.render(
        <SqlChart
          panel={panel}
          loadData={false}
          resultOverride={{ rows: [{ total: 42 }] }}
          showLoadingWhenDisabled={false}
        />,
      );
    });

    expect(mocks.queryEnabled).toBe(false);
    expect(container.textContent).toContain("42");
    expect(container.textContent).not.toContain("1");
  });

  it("does not show a loading skeleton when disabled without cached data", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };
    mocks.query.data = { rows: [] };

    await act(async () => {
      root.render(
        <SqlChart
          panel={panel}
          loadData={false}
          showLoadingWhenDisabled={false}
        />,
      );
    });

    expect(mocks.queryEnabled).toBe(false);
    expect(container.textContent).toContain("common.noData");
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();
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

  it("shows an extension skeleton until the embedded extension is ready", async () => {
    const panel = {
      id: "github-metrics",
      title: "GitHub metrics",
      sql: "",
      source: "first-party" as const,
      chartType: "extension" as const,
      width: 1,
      config: { extensionId: "extension-1" },
    };

    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(
      container.querySelector('[data-dashboard-extension-loading="true"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).not.toBeNull();

    await act(async () => {
      (mocks.embeddedExtensionProps?.onReady as (() => void) | undefined)?.();
    });

    expect(
      container.querySelector('[data-dashboard-extension-loading="true"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();
  });

  it("shows a readable retry action when a chart query fails", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };
    mocks.query.data = { rows: [] };
    mocks.query.error = new Error(
      "Action query-dashboard-panel failed: <HTML><TITLE>Inactivity Timeout</TITLE><BODY>Description: Too much time has passed</BODY>",
    );

    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This chart took too long to load. Try again.",
    );
    const retryButton = container.querySelector("button");
    expect(retryButton?.textContent).toContain("sqlDashboard.refresh");

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.queryRefreshToken).toBe(1);
  });

  it("keeps the last good rows visible when a refresh fails", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "bigquery" as const,
      chartType: "metric" as const,
      width: 1,
    };
    const onRefreshRequested = vi.fn();
    mocks.query.data = { rows: [{ value: 42 }] };
    mocks.query.error = new Error("forced refresh failed");

    await act(async () => {
      root.render(
        <SqlChart panel={panel} onRefreshRequested={onRefreshRequested} />,
      );
    });

    expect(container.textContent).toContain("42");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "forced refresh failed",
    );
    const refreshButton = container.querySelector("button");
    expect(refreshButton).not.toBeNull();
    await act(async () => {
      refreshButton?.click();
    });
    expect(onRefreshRequested).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh banner on a funnel with cached rows that draws nothing", async () => {
    const panel = {
      id: "stages",
      title: "Stages",
      sql: "SELECT 1 AS stage, 100 AS users",
      source: "first-party" as const,
      chartType: "funnel" as const,
      width: 1,
      config: { xKey: "stage", yKey: "users" },
    };
    const onRefreshRequested = vi.fn();
    mocks.query.data = { rows: [{ stage: 1, users: 100 }] };
    mocks.query.error = new Error("forced refresh failed");

    await act(async () => {
      root.render(
        <SqlChart panel={panel} onRefreshRequested={onRefreshRequested} />,
      );
    });

    expect(container.textContent).toContain("common.noData");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "forced refresh failed",
    );
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(onRefreshRequested).toHaveBeenCalledTimes(1);
  });

  it("does not expose a retry for a disabled query with a cached error", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };
    mocks.query.data = { rows: [] };
    mocks.query.error = new Error("Cached query failed");

    await act(async () => {
      root.render(
        <SqlChart
          panel={panel}
          dashboardId="dashboard-1"
          loadData={false}
          showLoadingWhenDisabled={false}
        />,
      );
    });

    expect(mocks.queryEnabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Cached query failed",
    );
    expect(container.querySelector("button")).toBeNull();
    expect(mocks.query.refetch).not.toHaveBeenCalled();
  });

  it("keeps the skeleton while a normal dashboard chart is offscreen", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };
    mocks.query.data = { rows: [] };

    await act(async () => {
      root.render(<SqlChart panel={panel} loadData={false} />);
    });

    expect(mocks.queryEnabled).toBe(false);
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("common.noData");
  });

  it("hides abort implementation details and keeps error text word-wrapped", async () => {
    expect(
      formatSqlChartError(new Error("signal is aborted without reason")),
    ).toBe("This chart load was interrupted. Try again.");

    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };
    mocks.query.data = { rows: [] };
    mocks.query.error = new Error(
      "A provider returned a very long error message that should wrap at word boundaries instead of breaking every word",
    );

    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    const message = container.querySelector('[role="alert"] p');
    expect(message?.className).toContain("break-words");
    expect(message?.className).not.toContain("break-all");
  });
});
