// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sqlChartProps: null as Record<string, unknown> | null,
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
    } as Record<string, unknown>,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => mocks.query,
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

import { AnalyticsReviewArtifactPreview } from "./AnalyticsReviewArtifactPreview";

describe("Analytics review artifact preview rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.sqlChartProps = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("disables query loading for saved panels from every provider", async () => {
    await act(async () => {
      root.render(
        <AnalyticsReviewArtifactPreview
          artifactId="dashboard-1"
          compact={false}
        />,
      );
    });

    expect(mocks.sqlChartProps).toMatchObject({
      loadData: false,
      showLoadingWhenDisabled: false,
      dashboardId: "dashboard-1",
      panel: { source: "ga4" },
    });
  });
});
