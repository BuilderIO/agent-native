// @vitest-environment happy-dom

import type { AnalyticsChartData } from "@shared/analytics-chart-block";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyticsChartBlock } from "./AnalyticsChartBlock";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const hooks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  options: {} as Record<string, Record<string, unknown> | undefined>,
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useRef } = await import("react");
  return {
    callAction: hooks.callAction,
    useActionQuery: (
      name: string,
      _params: unknown,
      options?: Record<string, unknown>,
    ) => {
      useRef(name);
      hooks.options[name] = options;
      return { data: hooks.queries[name] };
    },
  };
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
  useLocale: () => ({ locale: "en-US" }),
}));

const tracked = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: tracked,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

function chart(
  type: AnalyticsChartData["panel"]["type"] = "line",
  overrides: Partial<AnalyticsChartData> = {},
): AnalyticsChartData {
  return {
    dashboard: {
      id: "growth",
      title: "Growth",
      url: "https://analytics.example.test/dashboards/growth",
      visibility: "org",
    },
    panel: {
      id: "wau",
      title: "Weekly active users",
      type,
      fingerprint: "0123456789ab",
      url: "https://analytics.example.test/dashboards/growth?tile=wau",
    },
    filters: { timeRange: "90d" },
    filterSummary: "Time range: Last 90 days",
    columns: ["week", "Users"],
    rows: [
      ["2026-10-05", 120],
      ["2026-10-12", 140],
    ],
    series: [{ label: "Users" }],
    truncated: false,
    capturedAt: "2026-11-07T16:40:00.000Z",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement;

function renderRead(data: AnalyticsChartData) {
  const Read = analyticsChartBlock.Read;
  act(() =>
    defined(root).render(
      <Read
        data={data}
        blockId="analytics-chart-1a2b3c4d"
        ctx={{ dialect: "nfm", documentId: "doc_1", canEdit: false } as never}
      />,
    ),
  );
}

function renderEdit(data: AnalyticsChartData, onChange = vi.fn()) {
  const Edit = defined(analyticsChartBlock.Edit);
  act(() =>
    defined(root).render(
      <Edit
        data={data}
        onChange={onChange}
        editable
        blockId="analytics-chart-1a2b3c4d"
        ctx={{ dialect: "nfm", documentId: "doc_1", canEdit: true } as never}
      />,
    ),
  );
  return onChange;
}

beforeEach(() => {
  hooks.queries = {};
  hooks.options = {};
  hooks.callAction.mockReset();
  tracked.mockReset();
  for (const fn of Object.values(toasts)) fn.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

describe("AnalyticsChart for readers", () => {
  it("draws the kept numbers as an image described for screen readers", () => {
    renderRead(chart());
    const figure = defined(container.querySelector("figure"));
    const titleId = defined(figure.getAttribute("aria-labelledby"));
    expect(document.getElementById(titleId)?.textContent).toBe(
      "Weekly active users",
    );
    const img = defined(container.querySelector("img"));
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(img.getAttribute("alt")).toContain("Weekly active users");
    expect(img.getAttribute("alt")).toContain("140");
    // Nothing from the chart runs in the page.
    expect(container.querySelector("svg script, script")).toBeNull();
    expect(container.textContent).toContain("Time range: Last 90 days");
  });

  it("links back to the panel in Analytics", () => {
    renderRead(chart());
    const link = defined(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://analytics.example.test/dashboards/growth?tile=wau"]',
      ),
    );
    // The test DOM would follow the link; only the open event matters here.
    link.addEventListener("click", (event) => event.preventDefault());
    act(() => link.click());
    expect(tracked).toHaveBeenCalledWith("analytics_chart_opened", {
      panel_type: "line",
    });
  });

  it("shows a metric as its value and comparison", () => {
    renderRead(
      chart("metric", {
        columns: ["Users"],
        rows: [[1234]],
        series: undefined,
        display: { value: "1,234", comparison: "+12% vs previous period" },
      }),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("1,234");
    expect(container.textContent).toContain("+12% vs previous period");
  });

  it("shows a table as a table with a caption", () => {
    renderRead(
      chart("table", {
        columns: ["Account", "Seats"],
        rows: [
          ["Acme", 12],
          ["Globex", 1500],
        ],
        series: undefined,
      }),
    );
    const table = defined(container.querySelector("table"));
    expect(table.querySelector("caption")?.textContent).toContain(
      "Weekly active users",
    );
    expect(
      [...table.querySelectorAll("th")].map((cell) => cell.textContent),
    ).toEqual(["Account", "Seats"]);
    expect(table.textContent).toContain("1,500");
  });

  it("says when the panel returned more rows than the copy keeps", () => {
    renderRead(chart("line", { truncated: true }));
    expect(container.textContent).toContain("analyticsChart.truncated");
  });

  it("never asks Analytics anything for a reader", () => {
    renderRead(chart());
    expect(hooks.options).not.toHaveProperty("get-analytics-chart-status");
    expect(container.textContent).not.toContain("analyticsChart.refresh");
  });
});

describe("AnalyticsChart for editors", () => {
  it("says when the panel changed in Analytics since the copy", () => {
    hooks.queries["get-analytics-chart-status"] = {
      dashboards: [
        {
          dashboardId: "growth",
          status: {
            dashboard: { id: "growth", title: "Growth", visibility: "org" },
            panels: [{ id: "wau", fingerprint: "ba9876543210", type: "line" }],
          },
        },
      ],
    };
    renderEdit(chart());
    expect(container.textContent).toContain("analyticsChart.changedRefresh");
    expect(hooks.options["get-analytics-chart-status"]).toMatchObject({
      method: "POST",
      enabled: true,
      retry: false,
    });
  });

  it("says when the panel is gone from its dashboard, and offers no refresh", () => {
    hooks.queries["get-analytics-chart-status"] = {
      dashboards: [
        {
          dashboardId: "growth",
          status: {
            dashboard: { id: "growth", title: "Growth", visibility: "org" },
            panels: [{ id: "wau", fingerprint: null, type: null }],
          },
        },
      ],
    };
    renderEdit(chart());
    expect(container.textContent).toContain("analyticsChart.panelGone");
    expect(container.textContent).not.toContain("analyticsChart.refresh");
  });

  it("stays quiet when the panel is unchanged or Analytics won't say", () => {
    hooks.queries["get-analytics-chart-status"] = {
      dashboards: [
        {
          dashboardId: "growth",
          status: {
            dashboard: { id: "growth", title: "Growth", visibility: "org" },
            panels: [{ id: "wau", fingerprint: "0123456789ab", type: "line" }],
          },
        },
      ],
    };
    renderEdit(chart());
    expect(container.textContent).not.toContain(
      "analyticsChart.changedRefresh",
    );
    hooks.queries["get-analytics-chart-status"] = {
      dashboards: [{ dashboardId: "growth", error: "Dashboard not found" }],
    };
    renderEdit(chart());
    expect(container.textContent).not.toContain(
      "analyticsChart.changedRefresh",
    );
  });

  it("refreshes the copy in place as the editor", async () => {
    const fresh = chart("line", {
      rows: [
        ["2026-10-05", 120],
        ["2026-10-12", 160],
      ],
      capturedAt: "2026-11-08T09:00:00.000Z",
    });
    hooks.callAction.mockResolvedValue({ status: "captured", chart: fresh });
    const onChange = renderEdit(chart());
    const refresh = defined(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "analyticsChart.refresh",
      ),
    );
    await act(async () => refresh.click());
    expect(hooks.callAction).toHaveBeenCalledWith("capture-analytics-chart", {
      documentId: "doc_1",
      dashboardId: "growth",
      panelId: "wau",
      filters: { timeRange: "90d" },
      purpose: "refresh",
      blockId: "analytics-chart-1a2b3c4d",
    });
    expect(onChange).toHaveBeenCalledWith(fresh);
    expect(toasts.success).toHaveBeenCalled();
  });

  it("asks before a refresh that would show numbers to more people", async () => {
    hooks.callAction.mockResolvedValueOnce({
      status: "needs_confirmation",
      chart: chart("line", {
        dashboard: { ...chart().dashboard, visibility: "private" },
      }),
    });
    const onChange = renderEdit(chart());
    const refresh = defined(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "analyticsChart.refresh",
      ),
    );
    await act(async () => refresh.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(toasts.warning).toHaveBeenCalledTimes(1);

    hooks.callAction.mockResolvedValueOnce({
      status: "captured",
      chart: chart(),
    });
    const [, options] = toasts.warning.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    await act(async () => options.action.onClick());
    expect(hooks.callAction).toHaveBeenLastCalledWith(
      "capture-analytics-chart",
      expect.objectContaining({ acknowledgeWiderAudience: true }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the copy and says why when a refresh fails", async () => {
    hooks.callAction.mockRejectedValue(new Error("Dashboard not found"));
    const onChange = renderEdit(chart());
    const refresh = defined(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "analyticsChart.refresh",
      ),
    );
    await act(async () => refresh.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith("analyticsChart.refreshFailed", {
      description: "Dashboard not found",
    });
  });
});
