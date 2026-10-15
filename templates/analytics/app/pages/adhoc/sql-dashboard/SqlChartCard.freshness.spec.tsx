// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlQueryFreshness } from "@/lib/sql-query-freshness";

const mocks = vi.hoisted(() => ({
  chartProps: [] as Array<{
    panelId: string;
    onFreshnessChange?: (freshness: SqlQueryFreshness | null) => void;
  }>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.time ? `${key}(${values.time})` : key,
  useFormatters: () => ({
    formatDate: (value: string, options?: { dateStyle?: string }) =>
      options?.dateStyle ? `full:${value}` : `formatted:${value}`,
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setActivatorNodeRef: () => {},
    setNodeRef: () => {},
  }),
}));

vi.mock("@/components/dashboard/SqlChart", () => ({
  ChartFillHeight: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  SqlChart: (props: {
    panel: { id: string };
    onFreshnessChange?: (freshness: SqlQueryFreshness | null) => void;
  }) => {
    mocks.chartProps.push({
      panelId: props.panel.id,
      onFreshnessChange: props.onFreshnessChange,
    });
    return <div data-testid="chart-body" />;
  },
}));

vi.mock("./ViewSqlPopover", () => ({
  ViewSqlPopover: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: () => null,
    DropdownMenuLabel: Passthrough,
    DropdownMenuRadioGroup: Passthrough,
    DropdownMenuRadioItem: Passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuItem: Passthrough,
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";

import { SqlChartCard } from "./SqlChartCard";
import type { SqlPanel } from "./types";

const FETCHED_AT = "2026-10-14T12:00:00.000Z";

const panel: SqlPanel = {
  id: "signups",
  title: "Signups",
  sql: "SELECT 1 AS value",
  source: "bigquery",
  chartType: "metric",
  width: 1,
};

describe("SqlChartCard freshness clock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.chartProps = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (props: Partial<Parameters<typeof SqlChartCard>[0]> = {}) =>
    act(async () => {
      root.render(
        <TooltipProvider>
          <SqlChartCard
            panel={panel}
            onRemove={() => {}}
            dashboardId="dashboard-1"
            eagerLoad
            {...props}
          />
        </TooltipProvider>,
      );
    });
  const report = (freshness: SqlQueryFreshness | null) =>
    act(async () => {
      mocks.chartProps[mocks.chartProps.length - 1]!.onFreshnessChange?.(
        freshness,
      );
    });
  const clock = () =>
    container.querySelector<HTMLElement>("[data-dashboard-report-freshness]");

  it("shows no clock until the chart reports a result", async () => {
    await render();
    expect(clock()).toBeNull();
  });

  it("puts the time and cache state behind a clock in the panel's hover actions, not the chart body", async () => {
    await render();
    await report({ fetchedAt: FETCHED_AT, cache: "app-cache" });

    expect(clock()?.getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT}) · sqlDashboard.cacheApp`,
    );
    const options = container.querySelector(
      `[aria-label="sqlDashboard.panelOptions"]`,
    );
    expect(clock()!.parentElement).toBe(options!.parentElement);
    expect(
      container.querySelector('[data-testid="chart-body"]')!.contains(clock()),
    ).toBe(false);
    expect(container.textContent).not.toContain("sqlDashboard.fetchedAt");
  });

  it("offers a clock for an unknown fetch time and cache state rather than inventing either", async () => {
    await render();
    await report({ cache: "unknown" });

    expect(clock()?.getAttribute("aria-label")).toBe(
      "sqlDashboard.fetchTimeUnknown · sqlDashboard.cacheUnknown",
    );
  });

  it("removes the clock when the chart stops showing a result", async () => {
    await render();
    await report({ fetchedAt: FETCHED_AT, cache: "live" });
    expect(clock()).not.toBeNull();

    await report(null);
    expect(clock()).toBeNull();
  });

  it("keeps the same callback while the panel is unchanged, so the chart does not re-report", async () => {
    await render();
    await render();
    await render({ resolvedSql: "SELECT 2 AS value" });

    const callbacks = new Set(
      mocks.chartProps.map((props) => props.onFreshnessChange),
    );
    expect(callbacks.size).toBe(1);
  });

  it("never shows one panel's clock on a card reused for another panel or dashboard", async () => {
    await render();
    await report({ fetchedAt: FETCHED_AT, cache: "app-cache" });
    expect(clock()).not.toBeNull();

    await render({ panel: { ...panel, id: "sessions" } });
    expect(clock()).toBeNull();

    await report({ fetchedAt: FETCHED_AT, cache: "live" });
    expect(clock()).not.toBeNull();

    await render({ dashboardId: "dashboard-2" });
    expect(clock()).toBeNull();
  });

  it("ignores a late report for a panel the card no longer shows", async () => {
    await render();
    const staleReport =
      mocks.chartProps[mocks.chartProps.length - 1]!.onFreshnessChange!;
    await render({ panel: { ...panel, id: "sessions" } });

    await act(async () => {
      staleReport({ fetchedAt: FETCHED_AT, cache: "app-cache" });
    });

    expect(clock()).toBeNull();
  });
});
