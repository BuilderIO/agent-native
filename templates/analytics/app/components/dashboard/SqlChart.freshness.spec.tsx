// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_RESULT_AGE_MS } from "@/lib/sql-query-freshness";
import type { DataSourceType } from "@/pages/adhoc/sql-dashboard/types";

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
    completedManualRefreshToken: undefined as number | undefined,
    freshness: undefined as Freshness | undefined,
  },
  snapshots: undefined as boolean | undefined,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSession: () => ({
    session: { userId: "test-user", orgId: "test-org" },
    status: "authenticated",
  }),
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setActivatorNodeRef: () => {},
    setNodeRef: () => {},
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
  isExtensionApiPath: () => false,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { SqlChartCard } from "@/pages/adhoc/sql-dashboard/SqlChartCard";

import { SqlChart } from "./SqlChart";

const FETCHED_AT = "2026-10-14T12:00:00.000Z";
const fetchedMs = Date.parse(FETCHED_AT);

describe("SqlChart freshness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(fetchedMs + 60_000);
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
    mocks.query.completedManualRefreshToken = undefined;
    mocks.snapshots = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
  const staleText = () =>
    container.querySelector("[data-dashboard-report-stale]");
  const render = (props: Partial<Parameters<typeof SqlChart>[0]> = {}) =>
    act(async () => {
      root.render(<SqlChart panel={panel} {...props} />);
    });
  const setAge = (ageMs: number) => vi.setSystemTime(fetchedMs + ageMs);
  const advance = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });

  describe("inline text", () => {
    it("says nothing about a routine result, whatever its cache state", async () => {
      for (const cache of ["live", "app-cache", "provider-cache"] as const) {
        mocks.query.freshness = { fetchedAt: FETCHED_AT, cache };
        await render();
        expect(staleText()).toBeNull();
        expect(container.textContent).toBe("42");
      }
    });

    it("keeps standalone status beside the chart without an empty row or replacing the chart host", async () => {
      const chartHost = () =>
        container.querySelector("[data-dashboard-report-chart-body]");
      const status = () =>
        container.querySelector("[data-dashboard-report-standalone-status]");
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      await render();
      const initialChartHost = chartHost();
      expect(initialChartHost?.textContent).toBe("42");
      expect(
        status()?.querySelector("[data-dashboard-report-updating]"),
      ).toBeNull();
      expect(
        container.querySelector("[data-dashboard-report-status-slot]"),
      ).toBeNull();
      mocks.query.isFetching = true;
      await render();
      expect(
        status()?.querySelector("[data-dashboard-report-updating]"),
      ).not.toBeNull();
      mocks.query.isFetching = false;
      setAge(STALE_RESULT_AGE_MS + 1_000);
      await render();
      expect(
        status()?.querySelector("[data-dashboard-report-stale]"),
      ).not.toBeNull();
      setAge(60_000);
      await render();
      expect(
        status()?.querySelector("[data-dashboard-report-updating]"),
      ).toBeNull();
      expect(chartHost()).toBe(initialChartHost);
    });

    it("shows no reserved row for an empty result", async () => {
      mocks.query.data = { rows: [] };
      await render();
      expect(
        container.querySelector("[data-dashboard-report-status-slot]"),
      ).toBeNull();
      expect(container.textContent).toContain("common.noData");
    });

    it("keeps exactly one hour normal and labels the first moment past it", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "app-cache" };

      setAge(STALE_RESULT_AGE_MS);
      await render();
      expect(staleText()).toBeNull();

      setAge(STALE_RESULT_AGE_MS + 1);
      await render();
      expect(staleText()?.textContent).toBe(
        `sqlDashboard.fetchedAt(formatted:${FETCHED_AT}) · sqlDashboard.cacheApp`,
      );
      expect(staleText()?.getAttribute("data-dashboard-report-stale")).toBe(
        "app-cache",
      );
      expect(staleText()?.querySelector("time")?.getAttribute("datetime")).toBe(
        FETCHED_AT,
      );
    });

    it("turns an idle panel stale at the cutoff with no outside re-render", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      setAge(STALE_RESULT_AGE_MS - 5_000);
      await render();
      expect(staleText()).toBeNull();

      await advance(4_999);
      expect(staleText()).toBeNull();
      await advance(2);
      expect(staleText()).not.toBeNull();
    });

    it("stops timing once stale, and leaves no timer behind when it unmounts", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      setAge(STALE_RESULT_AGE_MS - 5_000);
      await render();
      expect(vi.getTimerCount()).toBe(1);

      await advance(5_001);
      expect(staleText()).not.toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      setAge(0);
      await render({ dashboardId: "other" });
      expect(vi.getTimerCount()).toBe(1);
      await act(async () => root.unmount());
      expect(vi.getTimerCount()).toBe(0);
      root = createRoot(container);
    });

    it("re-times the panel when a refresh brings a newer fetch time", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      setAge(STALE_RESULT_AGE_MS + 1_000);
      await render();
      expect(staleText()).not.toBeNull();

      mocks.query.freshness = {
        fetchedAt: new Date(fetchedMs + STALE_RESULT_AGE_MS).toISOString(),
        cache: "live",
      };
      await render();
      expect(staleText()).toBeNull();
      expect(vi.getTimerCount()).toBe(1);
    });

    it("never invents an age for an unknown, unreadable or future fetch time", async () => {
      setAge(10 * STALE_RESULT_AGE_MS);
      for (const freshness of [
        { cache: "restored" },
        { cache: "unknown" },
        { fetchedAt: "not a date", cache: "unknown" },
        {
          fetchedAt: new Date(Date.now() + 60_000).toISOString(),
          cache: "live",
        },
      ] as const) {
        mocks.query.freshness = freshness;
        await render();
        expect(staleText()).toBeNull();
      }
    });

    it("shows nothing for a source that reports nothing", async () => {
      setAge(10 * STALE_RESULT_AGE_MS);
      await render();
      expect(staleText()).toBeNull();
    });

    it("says nothing about a result the caller supplied instead of fetching", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      setAge(10 * STALE_RESULT_AGE_MS);
      await render({ resultOverride: { rows: [{ value: 1 }] } } as never);
      expect(staleText()).toBeNull();
    });

    it("gives way to the updating text while a stale result refreshes", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "app-cache" };
      setAge(STALE_RESULT_AGE_MS + 1_000);
      mocks.query.isFetching = true;
      await render();
      expect(staleText()).toBeNull();
      expect(
        container.querySelector("[data-dashboard-report-updating]"),
      ).not.toBeNull();
      expect(container.textContent).toContain("42");
    });

    it("keeps the previous filters label rather than the age while paused offscreen", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      mocks.query.isPlaceholderData = true;
      setAge(STALE_RESULT_AGE_MS + 1_000);
      await render({ loadData: false, retainWhileOffscreen: true });
      expect(staleText()).toBeNull();
      expect(
        container.querySelector(
          "[data-dashboard-report-paused] .panel-freshness-text",
        )?.textContent,
      ).toBe("sqlDashboard.previousFilters");
    });
  });

  describe("reported to the host for the clock", () => {
    const onFreshnessChange = vi.fn();
    const last = () =>
      onFreshnessChange.mock.calls[
        onFreshnessChange.mock.calls.length - 1
      ]?.[0];

    beforeEach(() => onFreshnessChange.mockClear());

    it("hands over the fetch time and cache state of a routine result", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "app-cache" };
      await render({ onFreshnessChange });
      expect(last()).toEqual({ fetchedAt: FETCHED_AT, cache: "app-cache" });
    });

    it("hands over an unknown fetch time or cache state as unknown", async () => {
      mocks.query.freshness = { cache: "unknown" };
      await render({ onFreshnessChange });
      expect(last()).toEqual({ fetchedAt: undefined, cache: "unknown" });
    });

    it.each([
      "ga4",
      "amplitude",
      "prometheus",
      "demo",
      "program",
    ] satisfies DataSourceType[])(
      "reports %s presentation status without inventing freshness or confirming an unsupported refresh",
      async (source) => {
        const props = { panel: { ...panel, source }, onFreshnessChange };
        await render(props);
        expect(last()).toBeNull();
        const body = container.querySelector(
          "[data-dashboard-report-chart-body]",
        );
        await render({ ...props, refreshToken: 1 });
        mocks.query.isFetching = true;
        await render({ ...props, refreshToken: 1 });
        expect(last()).toEqual({
          fetchedAt: undefined,
          cache: "unknown",
          status: "updating",
        });
        mocks.query.isPlaceholderData = true;
        await render({ ...props, refreshToken: 1 });
        expect(last()).toEqual({
          fetchedAt: undefined,
          cache: "unknown",
          status: "previous-filters-updating",
        });
        mocks.query.isFetching = false;
        await render({
          ...props,
          refreshToken: 1,
          loadData: false,
          retainWhileOffscreen: true,
        });
        expect(last()).toEqual({
          fetchedAt: undefined,
          cache: "unknown",
          status: "previous-filters",
        });
        mocks.query.isPlaceholderData = false;
        await render({ ...props, refreshToken: 1 });
        expect(last()).toBeNull();
        expect(
          container.querySelector("[data-dashboard-report-chart-body]"),
        ).toBe(body);
        expect(
          container.querySelector("[data-dashboard-report-standalone-status]"),
        ).toBeNull();
      },
    );

    it("reports a confirmed completion without metadata only when the query supplies its own token", async () => {
      await render({ onFreshnessChange });
      await render({ onFreshnessChange, refreshToken: 1 });
      mocks.query.completedManualRefreshToken = 1;
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last()).toEqual({
        fetchedAt: undefined,
        cache: "unknown",
        status: "refreshed",
      });
      await advance(2_999);
      expect(last()?.status).toBe("refreshed");
      await advance(1);
      expect(last()).toBeNull();
    });

    it.each(["section", "extension"] as const)(
      "does not report status for a %s even if the query retains an updating result",
      async (chartType) => {
        mocks.query.isFetching = true;
        await render({ panel: { ...panel, chartType }, onFreshnessChange });
        expect(last()).toBeNull();
      },
    );

    it("suppresses a prior confirmed status for a supplied result, skeleton, or error", async () => {
      await render({ onFreshnessChange });
      await render({ onFreshnessChange, refreshToken: 1 });
      mocks.query.completedManualRefreshToken = 1;
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last()?.status).toBe("refreshed");
      await render({
        onFreshnessChange,
        refreshToken: 1,
        resultOverride: { rows: [{ value: 1 }] },
      });
      expect(last()).toBeNull();
      mocks.query.data = undefined as never;
      mocks.query.isLoading = true;
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last()).toBeNull();
      mocks.query.isLoading = false;
      mocks.query.data = { rows: [] };
      mocks.query.error = new Error("query failed");
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last()).toBeNull();
    });

    it("reports nothing for a source that reports nothing, and null on unmount", async () => {
      await render({ onFreshnessChange });
      expect(last()).toBeNull();

      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      await render({ onFreshnessChange });
      expect(last()).toEqual({ fetchedAt: FETCHED_AT, cache: "live" });

      await act(async () => root.unmount());
      expect(last()).toBeNull();
      root = createRoot(container);
    });

    it("reports nothing while the panel shows a skeleton or an error", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      mocks.query.isLoading = true;
      mocks.query.data = undefined as never;
      await render({ onFreshnessChange });
      expect(last()).toBeNull();

      mocks.query.isLoading = false;
      mocks.query.data = { rows: [] };
      mocks.query.error = new Error("query failed");
      await render({ onFreshnessChange });
      expect(last()).toBeNull();
    });

    it("keeps reporting the shown result's time while it refreshes", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      mocks.query.isFetching = true;
      await render({ onFreshnessChange });
      expect(last()).toEqual({
        fetchedAt: FETCHED_AT,
        cache: "live",
        status: "updating",
      });
      expect(
        container.querySelector("[data-dashboard-report-updating]"),
      ).toBeNull();
      expect(
        container.querySelector("[data-dashboard-report-status-slot]"),
      ).toBeNull();
    });

    it("reports statuses through the same bridge without chart-body status or renderer replacement", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "app-cache" };
      await render({ onFreshnessChange, refreshToken: 0 });
      const body = container.querySelector(
        "[data-dashboard-report-chart-body]",
      );
      await render({ onFreshnessChange, refreshToken: 1 });
      mocks.query.isFetching = true;
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last().status).toBe("updating");
      mocks.query.isPlaceholderData = true;
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last().status).toBe("previous-filters-updating");
      mocks.query.isFetching = false;
      await render({
        onFreshnessChange,
        refreshToken: 1,
        loadData: false,
        retainWhileOffscreen: true,
      });
      expect(last().status).toBe("previous-filters");
      mocks.query.isPlaceholderData = false;
      mocks.query.completedManualRefreshToken = 1;
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last().status).toBe("refreshed");
      await advance(2_999);
      expect(last().status).toBe("refreshed");
      await advance(1);
      expect(last().status).toBeUndefined();
      setAge(STALE_RESULT_AGE_MS + 1);
      await render({ onFreshnessChange, refreshToken: 1 });
      expect(last().status).toBe("stale");
      expect(
        container.querySelector("[data-dashboard-report-chart-body]"),
      ).toBe(body);
      expect(
        container.querySelector("[data-dashboard-report-standalone-status]"),
      ).toBeNull();
      expect(
        container.querySelector("[data-dashboard-report-status-slot]"),
      ).toBeNull();
    });

    it("does not report a result the caller supplied", async () => {
      mocks.query.freshness = { fetchedAt: FETCHED_AT, cache: "live" };
      await render({
        onFreshnessChange,
        resultOverride: { rows: [{ value: 1 }] },
      } as never);
      expect(last()).toBeNull();
    });
  });

  it.each([
    "ga4",
    "amplitude",
    "prometheus",
    "demo",
    "program",
  ] satisfies DataSourceType[])(
    "keeps the real %s card and title tracks while its metadata-free clock appears and clears",
    async (source) => {
      const renderCard = () =>
        act(async () => {
          root.render(
            <TooltipProvider>
              <SqlChartCard
                panel={{ ...panel, source }}
                dashboardId="metadata-free"
                eagerLoad
                onRemove={() => {}}
              />
            </TooltipProvider>,
          );
        });
      const clock = () =>
        container.querySelector("[data-dashboard-report-freshness]");
      await renderCard();
      const header = container.querySelector(".dashboard-panel-header")!;
      const tracks = Array.from(header.children);
      const body = container.querySelector(
        "[data-dashboard-report-chart-body]",
      );
      expect(tracks).toHaveLength(3);
      expect(clock()).toBeNull();
      mocks.query.isFetching = true;
      await renderCard();
      expect(clock()?.getAttribute("aria-label")).toBe(
        "sqlDashboard.updating · sqlDashboard.fetchTimeUnknown · sqlDashboard.cacheUnknown",
      );
      expect(clock()?.getAttribute("data-dashboard-report-freshness")).toBe(
        "unknown",
      );
      expect(tracks[1]!.contains(clock())).toBe(true);
      expect(
        container.querySelector("[data-dashboard-report-standalone-status]"),
      ).toBeNull();
      mocks.query.isFetching = false;
      await renderCard();
      expect(clock()).toBeNull();
      expect(Array.from(header.children)).toEqual(tracks);
      expect(
        container.querySelector("[data-dashboard-report-chart-body]"),
      ).toBe(body);
      expect(body?.textContent).toBe("42");
    },
  );

  it("saves results only for a plain dashboard panel", async () => {
    await render();
    expect(mocks.snapshots).toBe(true);

    await render({ resultOverride: { rows: [{ value: 1 }] } } as never);
    expect(mocks.snapshots).toBe(false);
  });
});
