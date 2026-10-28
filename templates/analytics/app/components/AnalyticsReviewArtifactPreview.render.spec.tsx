// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sqlChartProps: null as Record<string, unknown> | null,
  chartEvents: undefined as unknown,
  chartNotes: undefined as unknown,
  listedNotes: undefined as unknown,
  markdownContent: null as string | null,
  queries: [] as Array<{
    action: string;
    args: Record<string, unknown>;
    enabled?: boolean;
  }>,
  query: {
    data: {
      panels: [
        {
          id: "ga4-chart",
          title: "Page views",
          sql: "SELECT 1",
          width: 12,
          source: "ga4",
          chartType: "line",
        },
      ],
      orgId: "customer-org",
      keyDates: [],
      dataNotes: [],
    } as Record<string, unknown>,
    isLoading: false,
    isError: false,
  },
  panelQuery: {
    data: {
      rows: [{ total: 42 }],
      schema: [{ name: "total", type: "number" }],
    } as Record<string, unknown>,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    action: string,
    args: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    mocks.queries.push({
      action,
      args,
      ...(options?.enabled === undefined ? {} : { enabled: options.enabled }),
    });
    return action === "query-observability-review-panel"
      ? mocks.panelQuery
      : mocks.query;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/dashboard/SqlChart", async () => {
  const { usePanelDataNotes, usePanelEvents } =
    await import("@/components/dashboard/dashboard-annotations-context");
  const { useDataNoteLayout } =
    await import("@/components/dashboard/data-note-bands");
  return {
    SqlChart: (props: { panel: SqlPanel }) => {
      mocks.sqlChartProps = props;
      mocks.chartEvents = usePanelEvents(props.panel);
      mocks.chartNotes = usePanelDataNotes(props.panel);
      mocks.listedNotes = useDataNoteLayout(
        mocks.chartNotes as DataNote[],
        [{ total: 42 }],
        "total",
      ).unplaced;
      return null;
    },
  };
});

vi.mock("@/components/Markdown", () => ({
  default: ({ content }: { content: string }) => {
    mocks.markdownContent = content;
    return null;
  },
}));

vi.mock("@/pages/analyses/LegacyFusionAnalysis", () => ({
  default: () => null,
  isLegacyFusionAnalysis: () => false,
}));

import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
} from "@shared/annotation-fixtures";
import type { DataNote } from "@shared/data-notes";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { AnalyticsReviewArtifactPreview } from "./AnalyticsReviewArtifactPreview";

describe("Analytics review artifact preview rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.sqlChartProps = null;
    mocks.chartEvents = undefined;
    mocks.chartNotes = undefined;
    mocks.listedNotes = undefined;
    mocks.markdownContent = null;
    mocks.queries = [];
    mocks.query.data = {
      panels: [
        {
          id: "ga4-chart",
          title: "Page views",
          sql: "SELECT 1",
          width: 12,
          source: "ga4",
          chartType: "line",
        },
      ],
      keyDates: [],
      dataNotes: [],
    };
    mocks.panelQuery.data = {
      rows: [{ total: 42 }],
      schema: [{ name: "total", type: "number" }],
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("queries the saved panel through the review-only read action", async () => {
    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="dashboard-1"
          compact={false}
          reviewOrgId="customer-org"
        />,
      );
    });

    expect(mocks.sqlChartProps).toMatchObject({
      loadData: false,
      showLoadingWhenDisabled: false,
      dashboardId: "dashboard-1",
      panel: { source: "ga4" },
      resultOverride: {
        rows: [{ total: 42 }],
        schema: [{ name: "total", type: "number" }],
      },
    });
    expect(mocks.queries).toContainEqual({
      action: "query-observability-review-panel",
      args: {
        dashboardId: "dashboard-1",
        panelId: "ga4-chart",
        reviewOrgId: "customer-org",
      },
      enabled: true,
    });
  });

  it("uses the saved filter default when filling gaps in pivot chart dates", async () => {
    mocks.query.data = {
      variables: { timeRange: "30d" },
      filters: [
        {
          id: "timeRange",
          label: "Time range",
          type: "select",
          default: "90d",
        },
      ],
      panels: [
        {
          id: "ga4-chart",
          title: "Page views",
          sql: "SELECT 1",
          width: 12,
          source: "ga4",
          chartType: "line",
        },
      ],
      keyDates: [],
      dataNotes: [],
    };

    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="dashboard-1"
          compact={false}
          reviewOrgId="customer-org"
        />,
      );
    });

    expect(mocks.sqlChartProps).toMatchObject({ timeRange: 90 });
  });

  it("draws the key dates the reviewed dashboard came with on its charts", async () => {
    const clipsLaunch = { date: "2026-10-13", label: "Clips launch" };
    mocks.query.data = { ...mocks.query.data, keyDates: [clipsLaunch] };

    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="dashboard-1"
          compact={false}
          reviewOrgId="customer-org"
        />,
      );
    });

    expect(mocks.chartEvents).toEqual([clipsLaunch]);
  });

  it("draws the data notes the reviewed dashboard came with, minus the ones it hides there", async () => {
    const pinned = { dashboardId: "dashboard-1", panelId: "ga4-chart" };
    const shown = { ...SETUP_INCIDENT, panels: [pinned] };
    const hidden = { ...CONNECT_UNDERCOUNT, panels: [pinned] };
    mocks.query.data = {
      ...mocks.query.data,
      dataNotes: [shown, hidden],
      annotations: {
        hiddenDataNotes: [{ noteId: hidden.id, panelId: "ga4-chart" }],
      },
    };

    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="dashboard-1"
          compact={false}
          reviewOrgId="customer-org"
        />,
      );
    });

    expect(mocks.chartNotes).toEqual([shown]);
  });

  it("lists a note under a chart without a date axis when it falls in the dashboard's time range", async () => {
    const pinned = { dashboardId: "dashboard-1", panelId: "ga4-chart" };
    const longAgo = {
      ...SETUP_INCIDENT,
      startDate: "2020-01-06",
      endDate: "2020-01-10",
      panels: [pinned],
    };
    const panel = (sql: string) => ({
      id: "ga4-chart",
      title: "Signups",
      sql,
      width: 12,
      source: "ga4",
      chartType: "metric",
    });
    const render = async (sql: string) => {
      mocks.query.data = {
        variables: { timeRange: "all" },
        filters: [],
        panels: [panel(sql)],
        keyDates: [],
        dataNotes: [longAgo],
      };
      await act(async () => {
        root.render(
          <AnalyticsReviewArtifactPreview
            artifactId="dashboard-1"
            compact={false}
            reviewOrgId="customer-org"
          />,
        );
      });
      return mocks.listedNotes;
    };

    expect(
      await render("SELECT COUNT(*) AS total WHERE '{{timeRange}}' <> ''"),
    ).toEqual([longAgo]);
    expect(await render("SELECT COUNT(*) AS total")).toEqual([]);
  });

  it.each(["keyDates", "dataNotes"])(
    "calls a dashboard that came without its %s unavailable, not unmarked",
    async (missing) => {
      const { [missing]: _, ...data } = mocks.query.data;
      mocks.query.data = data;

      await act(async () => {
        root.render(
          <AnalyticsReviewArtifactPreview
            artifactId="dashboard-1"
            compact={false}
            reviewOrgId="customer-org"
          />,
        );
      });

      expect(mocks.sqlChartProps).toBeNull();
      expect(
        container.querySelector('[data-preview-state="unavailable"]'),
      ).not.toBeNull();
    },
  );

  it("renders saved analysis results in the real review preview", async () => {
    mocks.query.data = {
      id: "analysis-1",
      name: "Saved analysis",
      resultMarkdown: "# Actual saved findings",
      resultData: null,
    };

    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="analysis-1"
          artifactPath="/analyses/analysis-1"
          compact={false}
          reviewOrgId="customer-org"
        />,
      );
    });

    expect(mocks.queries).toContainEqual({
      action: "get-analysis",
      args: {
        id: "analysis-1",
        reviewPreview: true,
        reviewOrgId: "customer-org",
      },
    });
    expect(mocks.markdownContent).toBe("# Actual saved findings");
  });

  it("keeps compact dashboard queries disabled when viewport observation is unavailable", async () => {
    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="dashboard-1"
          compact
          reviewOrgId="customer-org"
        />,
      );
    });

    expect(mocks.queries).toContainEqual({
      action: "query-observability-review-panel",
      args: {
        dashboardId: "dashboard-1",
        panelId: "ga4-chart",
        reviewOrgId: "customer-org",
      },
      enabled: false,
    });
  });
});
