// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Freshness = {
  fetchedAt?: string;
  cache: "live" | "app-cache" | "provider-cache" | "restored" | "unknown";
};

const mocks = vi.hoisted(() => ({
  query: {
    data: { rows: [{ value: 42 }] as Record<string, unknown>[] },
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    error: null as Error | null,
    refetch: vi.fn(),
    freshness: undefined as Freshness | undefined,
  },
  snapshots: undefined as boolean | undefined,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.time ? `${key}(${values.time})` : key,
  useFormatters: () => ({
    formatDate: (value: string, options?: { dateStyle?: string }) =>
      options?.dateStyle ? `full:${value}` : `formatted:${value}`,
    formatNumber: (value: number) => String(value),
  }),
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: (rows: Record<string, unknown>[]) => rows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: (
    _queryKey: string[],
    _sql: string,
    _source: string,
    options?: { snapshots?: boolean },
  ) => {
    mocks.snapshots = options?.snapshots;
    return mocks.query;
  },
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

import { SqlChart } from "./SqlChart";

describe("SqlChart freshness chip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.query.data = { rows: [{ value: 42 }] };
    mocks.query.isLoading = false;
    mocks.query.isFetching = false;
    mocks.query.isPlaceholderData = false;
    mocks.query.error = null;
    mocks.query.freshness = undefined;
    mocks.snapshots = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const panel = {
    id: "signups",
    title: "Signups",
    sql: "SELECT 42 AS value",
    source: "bigquery" as const,
    chartType: "metric" as const,
    width: 1,
  };
  const chip = () =>
    container.querySelector("[data-dashboard-report-freshness]");
  const render = (props: Partial<Parameters<typeof SqlChart>[0]> = {}) =>
    act(async () => {
      root.render(<SqlChart panel={panel} {...props} />);
    });

  it("shows when a fresh BigQuery result was fetched, with no cache suffix", async () => {
    mocks.query.freshness = {
      fetchedAt: "2026-10-14T12:00:00.000Z",
      cache: "live",
    };

    await render();

    expect(chip()?.getAttribute("data-dashboard-report-freshness")).toBe(
      "live",
    );
    expect(chip()?.textContent).toBe(
      "sqlDashboard.fetchedAt(formatted:2026-10-14T12:00:00.000Z)",
    );
  });

  it.each([
    ["app-cache", "sqlDashboard.cacheApp"],
    ["provider-cache", "sqlDashboard.cacheProvider"],
    ["restored", "sqlDashboard.cacheRestored"],
    ["unknown", "sqlDashboard.cacheUnknown"],
  ] as const)(
    "names a %s result without hiding its fetch time",
    async (cache, label) => {
      mocks.query.freshness = { fetchedAt: "2026-10-14T12:00:00.000Z", cache };

      await render();

      expect(chip()?.textContent).toBe(
        `sqlDashboard.fetchedAt(formatted:2026-10-14T12:00:00.000Z) · ${label}`,
      );
    },
  );

  it("says the fetch time is unknown instead of inventing one", async () => {
    mocks.query.freshness = { cache: "restored" };

    await render();

    expect(chip()?.textContent).toBe(
      "sqlDashboard.fetchTimeUnknown · sqlDashboard.cacheRestored",
    );
  });

  it("exposes the full fetch time on hover and keeps the chart clickable around it", async () => {
    mocks.query.freshness = {
      fetchedAt: "2026-10-14T12:00:00.000Z",
      cache: "live",
    };

    await render();

    const element = chip()!;
    expect(element.getAttribute("title")).toBe("full:2026-10-14T12:00:00.000Z");
    expect(element.className).toContain("pointer-events-auto");
    expect(element.parentElement?.className).toContain("pointer-events-none");
    expect(element.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-10-14T12:00:00.000Z",
    );
  });

  it("offers no timestamp title when the fetch time is unknown", async () => {
    mocks.query.freshness = { cache: "restored" };

    await render();

    expect(chip()?.hasAttribute("title")).toBe(false);
    expect(chip()?.querySelector("time")).toBeNull();
  });

  it("shows no chip for a source that reports nothing", async () => {
    await render();

    expect(chip()).toBeNull();
  });

  it("gives way to the updating notice while the same query refreshes", async () => {
    mocks.query.freshness = {
      fetchedAt: "2026-10-14T12:00:00.000Z",
      cache: "restored",
    };
    mocks.query.isFetching = true;

    await render();

    expect(chip()).toBeNull();
    expect(
      container.querySelector("[data-dashboard-report-updating]"),
    ).not.toBeNull();
  });

  it("shows the new fetch time after a refresh lands", async () => {
    mocks.query.freshness = {
      fetchedAt: "2026-10-14T12:00:00.000Z",
      cache: "live",
    };
    await render();
    mocks.query.freshness = {
      fetchedAt: "2026-10-14T12:05:00.000Z",
      cache: "live",
    };

    await render();

    expect(chip()?.textContent).toContain("2026-10-14T12:05:00.000Z");
  });

  it("saves results only for a plain dashboard panel", async () => {
    await render();
    expect(mocks.snapshots).toBe(true);

    await render({ resultOverride: { rows: [{ value: 1 }] } } as never);
    expect(mocks.snapshots).toBe(false);
  });
});
