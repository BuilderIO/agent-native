import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractRenderedDesignSystemFromUrl: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/brand-kit", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/brand-kit")
  >("@agent-native/core/brand-kit");
  return actual;
});

vi.mock("@agent-native/creative-context/server", () => ({
  extractRenderedDesignSystemFromUrl: mocks.extractRenderedDesignSystemFromUrl,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/db/index.js", () => ({}));

import action, { normalizeBrandWebsiteUrl } from "./analyze-brand-assets";

describe("analyze-brand-assets", () => {
  beforeEach(() => {
    mocks.extractRenderedDesignSystemFromUrl.mockReset();
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

  it("delegates website analysis to the shared rendered extractor", async () => {
    mocks.extractRenderedDesignSystemFromUrl.mockResolvedValue({
      url: "https://example.com/",
      status: "complete",
      rendered: true,
      title: "Brand",
      warnings: [],
      diagnostics: [],
    });

    const result = await action.run({ websiteUrl: "example.com" });

    expect(mocks.extractRenderedDesignSystemFromUrl).toHaveBeenCalledWith(
      "example.com",
    );
    expect(result.websiteAnalysis).toMatchObject({
      url: "https://example.com/",
      status: "complete",
      rendered: true,
      title: "Brand",
    });
  });
});
