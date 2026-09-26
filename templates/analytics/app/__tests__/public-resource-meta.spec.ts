import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicAnalysisMetadata: vi.fn(),
  getPublicDashboardMetadata: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "/analytics",
}));

vi.mock("../../server/lib/dashboards-store", () => ({
  getPublicAnalysisMetadata: mocks.getPublicAnalysisMetadata,
  getPublicDashboardMetadata: mocks.getPublicDashboardMetadata,
}));

vi.mock("@/pages/adhoc/AdhocRouter", () => ({ default: () => null }));
vi.mock("@/pages/analyses/AnalysisDetail", () => ({ default: () => null }));

import {
  loader as loadAnalysis,
  meta as analysisMeta,
} from "../routes/analyses.$id";
import {
  loader as loadDashboard,
  meta as dashboardMeta,
} from "../routes/dashboards.$id";

const request = new Request("https://analytics.example.com/dashboards/shared");

describe("public Analytics resource metadata", () => {
  it("uses dashboard details only when the dashboard is public", async () => {
    mocks.getPublicDashboardMetadata.mockResolvedValueOnce({
      title: "Active Customers",
      description: null,
      panelTitles: ["Monthly customers"],
    });
    mocks.getPublicDashboardMetadata.mockResolvedValueOnce(null);

    const publicData = await loadDashboard({
      params: { id: "shared" },
      request,
    } as never);
    const privateData = await loadDashboard({
      params: { id: "private" },
      request,
    } as never);

    const publicMeta = dashboardMeta({ loaderData: publicData } as never);
    const privateMeta = dashboardMeta({ loaderData: privateData } as never);

    expect(publicMeta).toEqual(
      expect.arrayContaining([
        { property: "og:title", content: "Active Customers" },
        {
          property: "og:description",
          content: "Analytics dashboard covering Monthly customers.",
        },
      ]),
    );
    expect(privateMeta).toEqual([{ title: expect.any(String) }]);
    expect(JSON.stringify(privateMeta)).not.toContain("Confidential Forecast");
    expect(mocks.getPublicDashboardMetadata).toHaveBeenNthCalledWith(
      1,
      "shared",
    );
    expect(mocks.getPublicDashboardMetadata).toHaveBeenNthCalledWith(
      2,
      "private",
    );
  });

  it("uses analysis title and description only when the analysis is public", async () => {
    mocks.getPublicAnalysisMetadata.mockResolvedValueOnce({
      name: "Revenue Trends",
      description: "Growth by region",
      question: "",
    });
    mocks.getPublicAnalysisMetadata.mockResolvedValueOnce(null);

    const publicData = await loadAnalysis({
      params: { id: "shared" },
      request,
    } as never);
    const orgData = await loadAnalysis({
      params: { id: "org" },
      request,
    } as never);

    const publicMeta = analysisMeta({ loaderData: publicData } as never);
    const orgMeta = analysisMeta({ loaderData: orgData } as never);

    expect(publicMeta).toEqual(
      expect.arrayContaining([
        { property: "og:title", content: "Revenue Trends" },
        { property: "og:description", content: "Growth by region" },
      ]),
    );
    expect(JSON.stringify(orgMeta)).not.toContain("Internal Pipeline");
    expect(JSON.stringify(orgMeta)).not.toContain("Private forecast");
  });
});
