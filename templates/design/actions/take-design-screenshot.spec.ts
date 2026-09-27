import { describe, expect, it, vi } from "vitest";

const { mockAccessFilter, mockGetDb } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn().mockResolvedValue([
    {
      id: "file_1",
      designId: "public_design",
      filename: "index.html",
      fileType: "html",
      content: "<html></html>",
    },
  ]);
  return {
    mockAccessFilter: vi.fn(() => ({ kind: "access-filter" })),
    mockGetDb: vi.fn(() => chain),
  };
});

vi.mock("@agent-native/core/collab", () => ({
  getText: vi.fn(),
  hasCollabState: vi.fn().mockResolvedValue(false),
}));
vi.mock("@agent-native/core/file-upload", () => ({ uploadFile: vi.fn() }));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn().mockReturnValue("viewer@example.test"),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mockAccessFilter,
  registerShareableResource: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mockGetDb,
  schema: {
    designFiles: {
      id: "id",
      designId: "design_id",
      filename: "filename",
      fileType: "file_type",
      content: "content",
    },
    designs: { id: "design_id", title: "title" },
    designShares: {},
  },
}));
vi.mock("../server/lib/design-to-figma-svg.js", () => ({
  isAllowedFigmaSvgRenderRequest: vi.fn(),
}));
vi.mock("../server/lib/playwright-runtime.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    importPlaywright: vi
      .fn()
      .mockRejectedValue(new Error("no chromium binary")),
  };
});

import action, {
  chromiumUnavailableReason,
  contrastRatio,
  isMissingBrowserError,
  parseRgbColor,
  relativeLuminance,
  requiredContrastRatio,
  resolveViewports,
} from "./take-design-screenshot.js";

describe("public design screenshot access", () => {
  it("includes public link visibility when reading a specific design file", async () => {
    mockAccessFilter.mockClear();
    const result = await action.run(
      { designId: "public_design" } as never,
      {} as never,
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockAccessFilter).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      "viewer",
      { includePublic: true },
    );
  });
});

describe("resolveViewports", () => {
  it("defaults to desktop (1280) + mobile (375) when widths is omitted", () => {
    const viewports = resolveViewports();
    expect(viewports).toEqual([
      { label: "desktop", widthPx: 1280, heightPx: 800 },
      { label: "mobile", widthPx: 375, heightPx: 812 },
    ]);
  });

  it("defaults when widths is an empty array", () => {
    expect(resolveViewports([])).toHaveLength(2);
  });

  it("derives a viewport per requested width with a device-appropriate height", () => {
    const viewports = resolveViewports([390, 768, 1440]);
    expect(viewports).toHaveLength(3);
    expect(viewports[0]).toMatchObject({ widthPx: 390, label: "mobile-390" });
    expect(viewports[1]).toMatchObject({ widthPx: 768, label: "tablet-768" });
    expect(viewports[2]).toMatchObject({
      widthPx: 1440,
      label: "desktop-1440",
    });
    for (const vp of viewports) {
      expect(vp.heightPx).toBeGreaterThan(0);
    }
  });

  it("uses an explicit `heights` entry instead of the device heuristic when provided", () => {
    const viewports = resolveViewports([960], [543]);
    expect(viewports).toEqual([
      { label: "desktop-960", widthPx: 960, heightPx: 543 },
    ]);
  });

  it("falls back to the device heuristic for indices missing from `heights`", () => {
    const viewports = resolveViewports([1280, 375], [900]);
    expect(viewports[0]).toMatchObject({ widthPx: 1280, heightPx: 900 });
    expect(viewports[1]).toMatchObject({ widthPx: 375, heightPx: 812 });
  });
});

describe("isMissingBrowserError", () => {
  it("recognizes a missing-executable Playwright error", () => {
    expect(
      isMissingBrowserError(
        new Error(
          "Executable doesn't exist at /root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome",
        ),
      ),
    ).toBe(true);
  });

  it("recognizes a 'playwright install' hint message", () => {
    expect(
      isMissingBrowserError(
        new Error(
          "Looks like Playwright Test or Playwright wasn't installed. Please run 'npx playwright install'",
        ),
      ),
    ).toBe(true);
  });

  it("does not flag an unrelated error", () => {
    expect(isMissingBrowserError(new Error("Design file not found"))).toBe(
      false,
    );
  });

  it("handles non-Error thrown values", () => {
    expect(isMissingBrowserError("chromium not found")).toBe(true);
    expect(isMissingBrowserError("some other string")).toBe(false);
  });
});

describe("chromiumUnavailableReason", () => {
  it("produces a model-actionable message that names the audit fallback", () => {
    const reason = chromiumUnavailableReason(
      new Error("Executable doesn't exist"),
    );
    expect(reason).toContain("run-design-audit");
    expect(reason).toContain("Executable doesn't exist");
    expect(reason.toLowerCase()).not.toContain("stack trace");
  });
});

describe("parseRgbColor", () => {
  it("parses an rgb() string", () => {
    expect(parseRgbColor("rgb(17, 24, 39)")).toEqual([17, 24, 39]);
  });

  it("parses an opaque rgba() string", () => {
    expect(parseRgbColor("rgba(255, 255, 255, 1)")).toEqual([255, 255, 255]);
  });

  it("returns null for a fully transparent color", () => {
    expect(parseRgbColor("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseRgbColor("transparent")).toBeNull();
    expect(parseRgbColor("currentcolor")).toBeNull();
  });
});

describe("relativeLuminance + contrastRatio", () => {
  it("gives black-on-white the maximum ~21:1 ratio", () => {
    const ratio = contrastRatio([0, 0, 0], [255, 255, 255]);
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("gives identical colors a 1:1 ratio", () => {
    expect(contrastRatio([128, 128, 128], [128, 128, 128])).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of fg/bg order", () => {
    const a = contrastRatio([17, 24, 39], [255, 255, 255]);
    const b = contrastRatio([255, 255, 255], [17, 24, 39]);
    expect(a).toBeCloseTo(b, 10);
  });

  it("flags light-gray-on-white as failing normal-text AA (< 4.5)", () => {
    const ratio = contrastRatio([209, 213, 219], [255, 255, 255]);
    expect(ratio).toBeLessThan(4.5);
  });
});

describe("requiredContrastRatio", () => {
  it("requires 4.5:1 for normal body text", () => {
    expect(requiredContrastRatio(16, 400)).toBe(4.5);
  });

  it("requires 3:1 for large text (>=24px)", () => {
    expect(requiredContrastRatio(24, 400)).toBe(3);
  });

  it("requires 3:1 for bold text >=18.66px", () => {
    expect(requiredContrastRatio(19, 700)).toBe(3);
  });

  it("requires 4.5:1 for bold text below the large-bold threshold", () => {
    expect(requiredContrastRatio(16, 700)).toBe(4.5);
  });
});
