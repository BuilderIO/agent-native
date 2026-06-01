import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchBrandWebsiteSignals: vi.fn(),
  resolveAccess: vi.fn(),
}));

// The pure scraping/normalize helpers now live in @agent-native/core/brand-kit
// and are unit-tested there. Here we only verify the action wires inputs through.
vi.mock("@agent-native/core/brand-kit", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/brand-kit")
  >("@agent-native/core/brand-kit");
  return {
    ...actual,
    fetchBrandWebsiteSignals: mocks.fetchBrandWebsiteSignals,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/db/index.js", () => ({}));

import action, { normalizeBrandWebsiteUrl } from "./analyze-brand-assets";

describe("analyze-brand-assets", () => {
  beforeEach(() => {
    mocks.fetchBrandWebsiteSignals.mockReset();
    mocks.resolveAccess.mockReset();
  });

  it("re-exports normalizeBrandWebsiteUrl from the shared brand-kit module", () => {
    expect(normalizeBrandWebsiteUrl("example.com/brand")).toBe(
      "https://example.com/brand",
    );
  });

  it("passes companyName and brandNotes straight through", async () => {
    const result = await action.run({
      companyName: "Acme",
      brandNotes: "bold",
    });
    expect(result).toMatchObject({ companyName: "Acme", brandNotes: "bold" });
  });

  it("delegates website analysis to fetchBrandWebsiteSignals", async () => {
    mocks.fetchBrandWebsiteSignals.mockResolvedValue({
      url: "https://example.com/",
      themeColor: "#123456",
      pageTitle: "Brand",
    });

    const result = await action.run({ websiteUrl: "example.com" });

    expect(mocks.fetchBrandWebsiteSignals).toHaveBeenCalledWith("example.com");
    expect(result.websiteAnalysis).toMatchObject({
      url: "https://example.com/",
      themeColor: "#123456",
      pageTitle: "Brand",
    });
  });
});
