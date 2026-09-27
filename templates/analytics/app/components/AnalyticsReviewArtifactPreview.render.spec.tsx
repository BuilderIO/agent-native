// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sqlChartProps: null as Record<string, unknown> | null,
  markdownContent: null as string | null,
  queries: [] as Array<{ action: string; args: Record<string, unknown> }>,
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
  useActionQuery: (action: string, args: Record<string, unknown>) => {
    mocks.queries.push({ action, args });
    return action === "query-observability-review-panel"
      ? mocks.panelQuery
      : mocks.query;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/dashboard/SqlChart", () => ({
  SqlChart: (props: Record<string, unknown>) => {
    mocks.sqlChartProps = props;
    return null;
  },
}));

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
    });
  });

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
});
