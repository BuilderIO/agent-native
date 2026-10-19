// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REFRESH_CONFIRMATION_MS } from "./panel-freshness";

const mocks = vi.hoisted(() => ({
  query: {
    data: { rows: [{ value: 42 }] as Record<string, unknown>[] },
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    error: null as Error | null,
    refetch: vi.fn(),
    dataUpdatedAt: 1_000,
    freshness: undefined,
    completedManualRefreshToken: undefined as number | undefined,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: (value: string) => value,
    formatNumber: (value: number) => String(value),
  }),
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: (rows: Record<string, unknown>[]) => rows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => mocks.query,
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
  isExtensionApiPath: () => false,
}));

import { SqlChart } from "./SqlChart";

describe("SqlChart manual refresh confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted = false;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = false;
    mocks.query.data = { rows: [{ value: 42 }] };
    mocks.query.isLoading = false;
    mocks.query.isFetching = false;
    mocks.query.isPlaceholderData = false;
    mocks.query.error = null;
    mocks.query.dataUpdatedAt = 1_000;
    mocks.query.completedManualRefreshToken = undefined;
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
    source: "first-party" as const,
    chartType: "metric" as const,
    width: 1,
  };
  const confirmation = () =>
    container.querySelector("[data-dashboard-report-refreshed]");
  const render = (props: Partial<Parameters<typeof SqlChart>[0]> = {}) =>
    act(async () => {
      mounted = true;
      root.render(<SqlChart panel={panel} {...props} />);
    });
  const advance = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });
  // One user-requested refresh of the panel: the token rises and the query
  // starts fetching.
  const requestRefresh = async (token: number, props = {}) => {
    // The panel mounts at the token before this request: a token it mounts
    // with is not a request.
    if (!mounted) await render({ refreshToken: token - 1, ...props });
    await render({ refreshToken: token, ...props });
    mocks.query.isFetching = true;
    await render({ refreshToken: token, ...props });
  };
  // The fetch ends; `completed` is what useSqlQuery reports for it.
  const settle = async (
    token: number,
    outcome: { completed?: number; updatedAt?: number; error?: Error },
    props = {},
  ) => {
    mocks.query.isFetching = false;
    if (outcome.updatedAt !== undefined) {
      mocks.query.dataUpdatedAt = outcome.updatedAt;
    }
    mocks.query.error = outcome.error ?? null;
    mocks.query.completedManualRefreshToken = outcome.completed;
    await render({ refreshToken: token, ...props });
  };

  it("proposes three seconds as the one constant", () => {
    expect(REFRESH_CONFIRMATION_MS).toBe(3000);
  });

  it("confirms the panel's own successful refresh briefly, then removes it", async () => {
    await render({ refreshToken: 0 });
    await requestRefresh(1);
    expect(confirmation()).toBeNull();

    await settle(1, { completed: 1, updatedAt: 2_000 });
    expect(
      confirmation()?.querySelector(".panel-freshness-text")?.textContent,
    ).toBe("sqlDashboard.refreshed");
    expect(confirmation()?.querySelector("[role=status]")?.textContent).toBe(
      "sqlDashboard.refreshed",
    );
    expect(container.textContent).toContain("42");

    await advance(REFRESH_CONFIRMATION_MS - 1);
    expect(confirmation()).not.toBeNull();
    await advance(1);
    expect(confirmation()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // The same completion on a later render does not start it again.
    await render({ refreshToken: 1 });
    expect(confirmation()).toBeNull();
  });

  it("confirms a refresh started from the panel's own local retry too", async () => {
    mocks.query.data = { rows: [] };
    mocks.query.error = new Error("query failed");
    await render();
    await act(async () => {
      container.querySelector("button")?.click();
    });
    mocks.query.data = { rows: [{ value: 42 }] };
    mocks.query.error = null;
    mocks.query.isFetching = true;
    await render();
    mocks.query.isFetching = false;
    mocks.query.dataUpdatedAt = 3_000;
    mocks.query.completedManualRefreshToken = 1;
    await render();

    expect(confirmation()).not.toBeNull();
  });

  it("does not confirm a refresh whose fetch reported no completion", async () => {
    await requestRefresh(1);
    await settle(1, { error: new Error("refresh failed") });

    expect(confirmation()).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("42");

    // A later automatic success, newer data and all, is not the request.
    mocks.query.isFetching = true;
    await render({ refreshToken: 1 });
    await settle(1, { updatedAt: 2_000 });
    expect(confirmation()).toBeNull();
  });

  it("does not confirm fresher data that no manual request produced", async () => {
    await render({ refreshToken: 0 });
    await requestRefresh(1);
    // An automatic fetch lands first: new data, no completion for the request.
    await settle(1, { updatedAt: 2_000 });
    expect(confirmation()).toBeNull();
  });

  it("does not let an earlier request's completion confirm the latest request", async () => {
    await requestRefresh(1);
    await render({ refreshToken: 2 });
    await settle(2, { completed: 1, updatedAt: 2_000 });
    expect(confirmation()).toBeNull();

    mocks.query.isFetching = true;
    await render({ refreshToken: 2 });
    await settle(2, { completed: 2, updatedAt: 3_000 });
    expect(confirmation()).not.toBeNull();
  });

  it("does not confirm when a filter change replaces the refreshed query", async () => {
    await requestRefresh(1, { resolvedSql: "SELECT 1 AS value" });
    await render({ refreshToken: 1, resolvedSql: "SELECT 2 AS value" });
    // useSqlQuery drops the request's completion with the query it belonged to.
    await settle(1, { updatedAt: 2_000 }, { resolvedSql: "SELECT 2 AS value" });

    expect(confirmation()).toBeNull();
  });

  it("does not mark an automatic revalidation, a remount, or a token it mounted with", async () => {
    await render({ refreshToken: 4 });
    mocks.query.isFetching = true;
    await render({ refreshToken: 4 });
    await settle(4, { updatedAt: 2_000 });
    expect(confirmation()).toBeNull();

    // Filters changing: the new query loads and lands with no refresh asked.
    mocks.query.isPlaceholderData = true;
    mocks.query.isFetching = true;
    await render({ refreshToken: 4, resolvedSql: "SELECT 2 AS value" });
    mocks.query.isPlaceholderData = false;
    await settle(4, { updatedAt: 3_000 }, { resolvedSql: "SELECT 2 AS value" });
    expect(confirmation()).toBeNull();
  });

  it("clears the text when another refresh starts, and again when it succeeds", async () => {
    await render({ refreshToken: 0 });
    await requestRefresh(1);
    await settle(1, { completed: 1, updatedAt: 2_000 });
    expect(confirmation()).not.toBeNull();

    await requestRefresh(2);
    expect(confirmation()).toBeNull();
    await settle(2, { completed: 2, updatedAt: 3_000 });
    expect(confirmation()).not.toBeNull();
    await advance(REFRESH_CONFIRMATION_MS);
    expect(confirmation()).toBeNull();
  });

  it("does not carry the text over to another query's result", async () => {
    await render({ refreshToken: 0 });
    await requestRefresh(1);
    await settle(1, { completed: 1, updatedAt: 2_000 });
    expect(confirmation()).not.toBeNull();

    mocks.query.completedManualRefreshToken = undefined;
    await render({ refreshToken: 1, resolvedSql: "SELECT 2 AS value" });
    expect(confirmation()).toBeNull();
  });

  it("clears confirmation when its completion is withdrawn and does not revive it", async () => {
    await render({ refreshToken: 0 });
    await requestRefresh(1);
    await settle(1, { completed: 1, updatedAt: 2_000 });
    expect(confirmation()).not.toBeNull();

    mocks.query.completedManualRefreshToken = undefined;
    await render({ refreshToken: 1 });
    expect(confirmation()).toBeNull();

    mocks.query.completedManualRefreshToken = 1;
    await render({ refreshToken: 1 });
    expect(confirmation()).toBeNull();
  });

  it("shows no timer after the panel unmounts mid-confirmation", async () => {
    await render({ refreshToken: 0 });
    await requestRefresh(1);
    await settle(1, { completed: 1, updatedAt: 2_000 });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it("gives the updating text priority while the refresh runs", async () => {
    await requestRefresh(1);
    expect(
      container.querySelector("[data-dashboard-report-updating]"),
    ).not.toBeNull();
    expect(confirmation()).toBeNull();
  });
});
