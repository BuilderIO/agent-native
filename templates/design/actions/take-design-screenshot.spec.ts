/**
 * take-design-screenshot.spec.ts
 *
 * Covers the pure, browser-free parts of the screenshot action:
 *  - viewport resolution from the optional `widths` input
 *  - the "no Chromium available" error classifier + model-actionable message
 *  - the WCAG contrast math used by the in-page diagnostics script
 *
 * The actual render path (page.setContent / page.screenshot / page.evaluate)
 * requires a real headless Chromium and a live DB-backed design_files row; it
 * is not exercised here — see the `design-generation` skill's Phase 5 for how
 * the action is used in practice, and run-design-audit.spec.ts for the
 * sibling audit action's equivalent DB-free coverage split.
 */

import { describe, expect, it } from "vitest";

import {
  chromiumUnavailableReason,
  contrastRatio,
  isMissingBrowserError,
  parseRgbColor,
  relativeLuminance,
  requiredContrastRatio,
  resolveViewports,
} from "./take-design-screenshot.js";

// ---------------------------------------------------------------------------
// resolveViewports
// ---------------------------------------------------------------------------

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
    // Heights should scale with width, never zero or negative.
    for (const vp of viewports) {
      expect(vp.heightPx).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Chromium-unavailable classification + message
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// WCAG contrast math (module-scope copy used for testing; the in-page
// evaluate closure duplicates this exact logic — see the comment above it)
// ---------------------------------------------------------------------------

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
    // #d1d5db (Tailwind gray-300) on white is a classic low-contrast failure.
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
