import { describe, expect, it } from "vitest";

import {
  extractRenderedDesignSystemFromUrl,
  styleBriefFromRenderedDesign,
} from "./rendered-design.js";
import type { RenderedPageProvider } from "./rendered-page.js";

const renderedProvider: RenderedPageProvider = {
  async render() {
    return {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      title: "Example Studio",
      text: "",
      method: "local-playwright",
      rendered: true,
      warnings: [],
      extraction: {
        title: "Example Studio",
        text: "",
        assets: [
          { url: "https://example.com/logo.svg", kind: "image", role: "logo" },
        ],
        internalLinks: [],
        designTokens: {
          colors: ["rgb(12, 24, 48)", "rgb(45, 212, 191)"],
          typography: [
            {
              family: "Inter, sans-serif",
              size: "16px",
              weight: "400",
              lineHeight: "24px",
              letterSpacing: "0px",
            },
          ],
          spacing: ["24px"],
          radii: ["12px"],
          cssVariables: { "--brand-accent": "#2DD4BF" },
          semanticColors: {
            primary: "rgb(12, 24, 48)",
            accent: "rgb(45, 212, 191)",
            background: "rgb(255, 255, 255)",
            text: "rgb(12, 24, 48)",
          },
          shadows: ["rgba(12, 24, 48, 0.12) 0px 8px 24px"],
          components: [
            {
              role: "button",
              fontFamily: "Inter, sans-serif",
              fontSize: "14px",
              fontWeight: "600",
              color: "rgb(255, 255, 255)",
              backgroundColor: "rgb(12, 24, 48)",
              borderRadius: "999px",
              padding: "12px 18px",
            },
          ],
          layout: {
            contentWidth: "1120px",
            pagePadding: "32px",
            sectionGap: "48px",
          },
        },
      },
      screenshots: [
        {
          viewport: "desktop",
          width: 1440,
          height: 900,
          data: new Uint8Array([1]),
        },
        {
          viewport: "mobile",
          width: 390,
          height: 844,
          data: new Uint8Array([1, 2]),
        },
      ],
      confidence: 0.92,
      classification: "homepage",
      diagnostics: [],
      metadata: {},
    };
  },
};

describe("rendered design extraction", () => {
  it("projects real rendered signals into Brand Kit and design.md shapes", async () => {
    const result = await extractRenderedDesignSystemFromUrl("example.com", {
      provider: renderedProvider,
    });

    expect(result).toMatchObject({
      status: "complete",
      rendered: true,
      finalUrl: "https://example.com/",
      method: "local-playwright",
      brandKit: {
        colors: {
          accent: "rgb(45, 212, 191)",
        },
        logos: [{ url: "https://example.com/logo.svg" }],
      },
      screenshotEvidence: [
        { viewport: "desktop", bytes: 1 },
        { viewport: "mobile", bytes: 2 },
      ],
    });
    expect(result.designMd).toContain("real browser computed styles");
    expect(result.designMd).toContain("--brand-accent: #2DD4BF");
    expect(result.designMd).toContain("button:");

    expect(styleBriefFromRenderedDesign(result)).toMatchObject({
      sourceUrl: "https://example.com/",
      rendered: true,
      palette: ["rgb(12, 24, 48)", "rgb(45, 212, 191)"],
      cssVariables: { "--brand-accent": "#2DD4BF" },
    });
  });

  it("keeps a static fallback explicit and does not call it a complete render", async () => {
    const result = await extractRenderedDesignSystemFromUrl(
      "https://example.com",
      {
        provider: {
          async render() {
            return {
              ...(await renderedProvider.render()),
              method: "static-html" as const,
              rendered: false,
              warnings: ["Used the SSRF-safe static HTML fallback."],
              screenshots: [],
            };
          },
        },
      },
    );

    expect(result.status).toBe("partial");
    expect(result.rendered).toBe(false);
    expect(result.designMd).toContain("SSRF-safe static HTML fallback");
    expect(result.warnings).toEqual([
      "Used the SSRF-safe static HTML fallback.",
    ]);
  });

  it("preserves invalid URL and renderer failures as failed results", async () => {
    await expect(
      extractRenderedDesignSystemFromUrl("not a url", {
        provider: renderedProvider,
      }),
    ).resolves.toMatchObject({ status: "failed", rendered: false });

    const result = await extractRenderedDesignSystemFromUrl(
      "https://example.com",
      {
        provider: {
          async render() {
            throw new Error("browser unavailable");
          },
        },
      },
    );
    expect(result).toMatchObject({
      status: "failed",
      error: "browser unavailable",
      rendered: false,
    });
  });
});
