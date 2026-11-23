import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsAssetLabelsSettings } from "./AnalyticsAssetLabelsSettings";

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./AnalyticsAssetLabelsSettings.fixtures"))
    .assetLabelHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

function render(view: string): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AnalyticsAssetLabelsSettings
        route={
          { view } as unknown as Parameters<
            typeof AnalyticsAssetLabelsSettings
          >[0]["route"]
        }
      />
    </QueryClientProvider>,
  );
}

describe("AnalyticsAssetLabelsSettings", () => {
  it("renders the asset statuses section with its empty state", () => {
    const html = render("asset-statuses");
    expect(html).toContain("Asset statuses");
    expect(html).toContain("No statuses yet.");
    expect(html).not.toContain("Asset categories");
  });

  it("renders the asset categories section with its empty state", () => {
    const html = render("asset-categories");
    expect(html).toContain("Asset categories");
    expect(html).toContain("No categories yet.");
    expect(html).not.toContain("Asset statuses");
  });
});
