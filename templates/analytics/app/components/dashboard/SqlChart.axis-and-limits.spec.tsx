// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  useFormatters: () => ({
    formatNumber: (value: number) => value.toLocaleString("en-US"),
  }),
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: (rows: Record<string, unknown>[]) => rows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: { rows: mocks.rows },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

import {
  APP_SERIES_COLORS,
  UNKNOWN_APP_COLOR,
} from "@shared/tokens/app-series-colors";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import {
  SqlChart,
  sortTooltipPayloadItems,
  truncatedTableColumns,
} from "./SqlChart";

const CHART_SIZE = { width: 640, height: 320 };

const DOMAINS = Array.from(
  { length: 25 },
  (_, index) => `referrer-number-${index + 1}.example.com`,
);

function panel(
  chartType: SqlPanel["chartType"],
  config: SqlPanel["config"],
): SqlPanel {
  return {
    id: "panel",
    title: "Panel",
    sql: "SELECT 1",
    source: "first-party",
    chartType,
    width: 1,
    config,
  };
}

function dates(count: number): string[] {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

describe("SqlChart axis labels, series order and point limits", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    for (const [prop, value] of Object.entries(CHART_SIZE)) {
      Object.defineProperty(
        HTMLElement.prototype,
        prop === "width" ? "offsetWidth" : "offsetHeight",
        { configurable: true, value },
      );
    }
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ ...CHART_SIZE, top: 0, left: 0, right: 640, bottom: 320 }) as DOMRect;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function render(chart: SqlPanel) {
    await act(async () => {
      root.render(<SqlChart panel={chart} />);
    });
  }

  function xTickTitles(): string[] {
    return [
      ...container.querySelectorAll(".recharts-xAxis-tick-labels title"),
    ].map((title) => title.textContent ?? "");
  }

  it("labels every bar on a category axis, angled and cut with the full name kept", async () => {
    mocks.rows = DOMAINS.map((domain, index) => ({
      domain,
      pageviews: 100 - index,
    }));
    await render(panel("bar", { xKey: "domain", yKey: "pageviews" }));

    expect(xTickTitles()).toEqual(DOMAINS);
    const texts = [
      ...container.querySelectorAll(".recharts-xAxis-tick-labels text"),
    ];
    expect(texts).toHaveLength(DOMAINS.length);
    expect(texts[0].getAttribute("transform")).toMatch(/^rotate\(-\d+\)$/);
    expect(texts[0].getAttribute("text-anchor")).toBe("end");
    expect(texts[0].textContent).toMatch(/…$/);
  });

  it("keeps automatic tick thinning on a date axis", async () => {
    mocks.rows = dates(90).map((day, index) => ({ day, signups: index }));
    await render(panel("bar", { xKey: "day", yKey: "signups" }));

    expect(xTickTitles()).toEqual([]);
    const ticks = container.querySelectorAll(
      ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label",
    );
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThan(90);
  });

  it("stacks pivoted series largest first with Other last, in legend order", async () => {
    mocks.rows = dates(3).flatMap((day) => [
      { day, template: "other", count: 900 },
      { day, template: "mail", count: 5 },
      { day, template: "slides", count: 50 },
      { day, template: "analytics", count: 20 },
    ]);
    await render(
      panel("area", {
        stacked: true,
        pivot: { xKey: "day", seriesKey: "template", valueKey: "count" },
      }),
    );

    const legend = [
      ...container.querySelectorAll("[data-chart-legend-item]"),
    ].map((item) => item.getAttribute("data-chart-legend-item"));
    expect(legend).toEqual(["slides", "analytics", "mail", "other"]);
  });

  it("puts pivot.seriesOrder ahead of the size ranking", async () => {
    mocks.rows = dates(2).flatMap((day) => [
      { day, env: "production", count: 90 },
      { day, env: "preview", count: 5 },
      { day, env: "local", count: 40 },
    ]);
    await render(
      panel("bar", {
        stacked: true,
        pivot: {
          xKey: "day",
          seriesKey: "env",
          valueKey: "count",
          seriesOrder: ["preview"],
        },
      }),
    );

    const legend = [
      ...container.querySelectorAll("[data-chart-legend-item]"),
    ].map((item) => item.getAttribute("data-chart-legend-item"));
    expect(legend).toEqual(["preview", "production", "local"]);
  });

  it("keeps each series' configured color when ranking moves it", async () => {
    mocks.rows = dates(2).flatMap((day) => [
      { day, sentiment: "positive", responses: 5 },
      { day, sentiment: "negative", responses: 20 },
    ]);
    await render(
      panel("bar", {
        stacked: true,
        colors: ["#10b981", "#ef4444"],
        pivot: { xKey: "day", seriesKey: "sentiment", valueKey: "responses" },
      }),
    );

    const swatches = [
      ...container.querySelectorAll("[data-chart-legend-item]"),
    ].map((item) => [
      item.getAttribute("data-chart-legend-item"),
      item.querySelector<HTMLElement>("span[style]")?.style.backgroundColor,
    ]);
    expect(swatches).toEqual([
      ["negative", "#ef4444"],
      ["positive", "#10b981"],
    ]);
  });

  it("keeps each app's color when the result order, stack order and app set change", async () => {
    const appPanel = panel("area", {
      stacked: true,
      pivot: { xKey: "day", seriesKey: "template", valueKey: "count" },
    });
    const swatches = () =>
      [...container.querySelectorAll("[data-chart-legend-item]")].map(
        (item) => [
          item.getAttribute("data-chart-legend-item"),
          item.querySelector<HTMLElement>("span[style]")?.style.backgroundColor,
        ],
      );

    const strokes = () =>
      [...container.querySelectorAll(".recharts-area-curve")].map((curve) =>
        curve.getAttribute("stroke"),
      );

    mocks.rows = dates(2).flatMap((day) => [
      { day, template: "mail", count: 90 },
      { day, template: "slides", count: 5 },
      { day, template: "brain", count: 1 },
      { day, template: "unknown", count: 3 },
    ]);
    await render(appPanel);
    expect(swatches()).toEqual([
      ["mail", APP_SERIES_COLORS.mail],
      ["slides", APP_SERIES_COLORS.slides],
      ["brain", APP_SERIES_COLORS.brain],
      ["unknown", UNKNOWN_APP_COLOR],
    ]);
    expect(strokes()).toEqual([
      APP_SERIES_COLORS.mail,
      APP_SERIES_COLORS.slides,
      APP_SERIES_COLORS.brain,
      UNKNOWN_APP_COLOR,
    ]);

    mocks.rows = dates(2).flatMap((day) => [
      { day, template: "slides", count: 90 },
      { day, template: "mail", count: 5 },
    ]);
    await render({ ...appPanel, id: "reordered" });
    expect(swatches()).toEqual([
      ["slides", APP_SERIES_COLORS.slides],
      ["mail", APP_SERIES_COLORS.mail],
    ]);
    expect(strokes()).toEqual([
      APP_SERIES_COLORS.slides,
      APP_SERIES_COLORS.mail,
    ]);
  });

  it("says when a time series draws only its newest points", async () => {
    mocks.rows = dates(601).map((day, index) => ({ day, signups: index }));
    await render(panel("line", { xKey: "day", yKey: "signups" }));

    const note = container.querySelector("[data-chart-point-limit]");
    expect(note?.textContent).toBe(
      'sqlDashboard.chartPointLimitNewest {"shown":"400","total":"601"}',
    );
  });

  it("says when a category chart draws only its first points", async () => {
    mocks.rows = Array.from({ length: 450 }, (_, index) => ({
      page: `/page-${index}`,
      views: 450 - index,
    }));
    await render(panel("bar", { xKey: "page", yKey: "views" }));

    expect(
      container.querySelector("[data-chart-point-limit]")?.textContent,
    ).toBe('sqlDashboard.chartPointLimitFirst {"shown":"400","total":"450"}');
  });

  it("calls the kept points of a line chart over categories the last, not the newest", async () => {
    mocks.rows = Array.from({ length: 450 }, (_, index) => ({
      page: `/page-${index}`,
      views: 450 - index,
    }));
    await render(panel("line", { xKey: "page", yKey: "views" }));

    expect(
      container.querySelector("[data-chart-point-limit]")?.textContent,
    ).toBe('sqlDashboard.chartPointLimitLast {"shown":"400","total":"450"}');
  });

  it("adds no note when every point is drawn", async () => {
    mocks.rows = dates(400).map((day, index) => ({ day, signups: index }));
    await render(panel("line", { xKey: "day", yKey: "signups" }));

    expect(container.querySelector("[data-chart-point-limit]")).toBeNull();
  });

  it("caps long text cells with a hover title and leaves numbers alone", async () => {
    const longChannel =
      "Paid social / LinkedIn sponsored content retargeting audience";
    mocks.rows = [
      {
        channel: longChannel,
        url: "https://example.com/a/very/long/landing/page",
        people: 1234,
      },
    ];
    await render(
      panel("table", {
        columns: [
          { key: "channel" },
          { key: "url", format: "link" },
          { key: "people", format: "number" },
        ],
      }),
    );

    const cells = container.querySelectorAll("tbody td");
    const channel = cells[0].querySelector("span.truncate");
    expect(channel?.getAttribute("title")).toBe(longChannel);
    expect(channel?.textContent).toBe(longChannel);
    const link = cells[1].querySelector("a");
    expect(link?.className).toContain("truncate");
    expect(link?.getAttribute("href")).toBe(
      "https://example.com/a/very/long/landing/page",
    );
    expect(link?.getAttribute("title")).toBe(
      "https://example.com/a/very/long/landing/page",
    );
    expect(cells[2].querySelector(".truncate")).toBeNull();
    const widths = [...cells].map(
      (cell) => (cell as HTMLElement).style.maxWidth,
    );
    expect(widths[0]).toMatch(/^0(px)?$/);
    expect(widths[1]).toMatch(/^0(px)?$/);
    expect(widths[2]).toBe("");
  });

  it("keeps the width a user set on a text column instead of capping it", async () => {
    mocks.rows = [
      {
        channel: "Paid social / LinkedIn sponsored content",
        note: "Retargeting audience from the September launch",
        people: 1234,
      },
    ];
    await render(
      panel("table", {
        columns: [
          { key: "channel", width: 180 },
          { key: "note" },
          { key: "people", format: "number" },
        ],
      }),
    );

    const headers = [...container.querySelectorAll("thead th")].map(
      (cell) => (cell as HTMLElement).style.width,
    );
    expect(headers).toEqual(["180px", "60%", ""]);
    const cells = [...container.querySelectorAll("tbody td")] as HTMLElement[];
    expect(cells[0].style.maxWidth).toBe("180px");
    expect(cells[0].querySelector("span.truncate")?.getAttribute("title")).toBe(
      "Paid social / LinkedIn sponsored content",
    );
    expect(cells[1].style.maxWidth).toMatch(/^0(px)?$/);
  });
});

describe("truncatedTableColumns", () => {
  it("truncates text columns but not numbers or dates", () => {
    const columns = truncatedTableColumns(
      [
        { key: "name" },
        { key: "count" },
        { key: "share", format: "percent" },
        { key: "code", format: "text" },
        { key: "day" },
        { key: "signedUp", format: "date" },
      ],
      [
        {
          name: "Mail",
          count: "12",
          share: 0.4,
          code: "123",
          day: "2026-10-01",
          signedUp: "2026-10-01T09:30:00Z",
        },
        {
          name: "Slides",
          count: 7,
          share: 0.6,
          code: "456",
          day: "2026-10-02",
          signedUp: "2026-10-02T09:30:00Z",
        },
      ],
    );
    expect([...columns]).toEqual(["name", "code"]);
  });
});

describe("sortTooltipPayloadItems", () => {
  const items = [
    { name: "small", value: 1 },
    { name: "large", value: 9 },
    { name: "other", value: 30 },
  ];

  it("sorts by value without an order", () => {
    expect(sortTooltipPayloadItems(items).map((item) => item.name)).toEqual([
      "other",
      "large",
      "small",
    ]);
  });

  it("follows the series order when given one", () => {
    expect(
      sortTooltipPayloadItems(items, ["large", "small", "other"]).map(
        (item) => item.name,
      ),
    ).toEqual(["large", "small", "other"]);
  });
});
