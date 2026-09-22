import { existsSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/store.js";
import {
  OG_ARABIC_FONT_FAMILY,
  OG_FONT_FAMILY,
  resolveOgFontFiles,
} from "./og-fonts.js";
import {
  agentNativeOgImageResponseHeaders,
  isResvgRuntimeUnavailableError,
  renderAgentNativeOgImageSvg,
  resolveAgentNativeOgImageAppName,
} from "./social-og-image.js";

describe("social OG image", () => {
  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
  });

  it("bundles real font files so text renders without system fonts", () => {
    // Regression guard: Linux serverless runtimes ship neither Arial nor Inter,
    // so the OG text was rendering blank. resvg must get explicit font files.
    const fontFiles = resolveOgFontFiles();
    expect(fontFiles?.length).toBeGreaterThan(0);
    for (const file of fontFiles ?? []) {
      expect(file.endsWith(".ttf")).toBe(true);
      expect(existsSync(file)).toBe(true);
    }
    expect(fontFiles).toEqual(
      expect.arrayContaining([
        expect.stringContaining("NotoNaskhArabic-Variable.ttf"),
      ]),
    );
  });

  it("renders the title with the bundled font and a Bold-resolving weight", () => {
    const svg = renderAgentNativeOgImageSvg({
      appName: "Agent-Native Analytics",
      brand: "agent-native",
      title: "Agent-Native Analytics",
      accentText: "100% free and open source",
    });
    expect(svg).toContain("Agent-Native Analytics");
    expect(svg).toContain("100% free and open source");
    expect(svg).toContain(OG_FONT_FAMILY);
    // resvg's fontdb maps font-weight 850 to Regular, not Bold — the title must
    // not use it or the display title renders thin.
    expect(svg).not.toContain('font-weight="850"');
  });

  it("renders the shared branded background without a grid pattern", () => {
    const svg = renderAgentNativeOgImageSvg();

    expect(svg).toContain(
      '<image x="0" y="0" width="1200" height="630" href="data:image/png;base64,',
    );
    expect(svg).not.toContain("<pattern");
    expect(svg).not.toContain('fill="url(#grid)"');
  });

  it("renders Arabic titles with a bundled RTL font", () => {
    const svg = renderAgentNativeOgImageSvg({
      title: "الخطوات الأولى",
      accentText: "Agent-Native Docs",
    });
    expect(svg).toContain("الخطوات الأولى");
    expect(svg).toContain(OG_ARABIC_FONT_FAMILY);
    expect(svg).toContain('x="1120"');
    expect(svg).toContain('text-anchor="end" direction="rtl"');
    expect(svg).toContain('unicode-bidi="plaintext"');
  });

  it("places accent text below wrapped title lines", () => {
    const svg = renderAgentNativeOgImageSvg({
      title: "Workspace Connections For Multi App Provider Grants",
      accentText: "Agent-Native Docs",
    });
    const titleMatch = svg.match(
      /<text x="80" y="(\d+)"[\s\S]*?<tspan x="80" dy="0">[\s\S]*?<\/tspan><tspan x="80" dy="(\d+)">[\s\S]*?<\/tspan><\/text>/,
    );
    const accentMatch = svg.match(
      /<text x="84" y="(\d+)"[\s\S]*?<tspan x="84" dy="0">Agent-Native Docs<\/tspan><\/text>/,
    );

    expect(titleMatch).not.toBeNull();
    expect(accentMatch).not.toBeNull();

    const titleY = Number(titleMatch![1]);
    const secondLineDy = Number(titleMatch![2]);
    const accentY = Number(accentMatch![1]);
    expect(accentY).toBeGreaterThan(titleY + secondLineDy);
  });

  it("expands built-in app names before rendering the default title", () => {
    vi.stubEnv("APP_NAME", "Design");
    vi.stubEnv("npm_package_name", "design");
    expect(resolveAgentNativeOgImageAppName()).toBe("Agent-Native Design");
    const designSvg = renderAgentNativeOgImageSvg();
    expect(designSvg).toContain("Agent-Native Design");
    expect(designSvg).toContain("100% free and open source");
    expect(designSvg).toContain('<path d="M26.8789');

    vi.stubEnv("APP_NAME", "slides");
    vi.stubEnv("npm_package_name", "slides");
    resetAppConfigForTests();
    expect(resolveAgentNativeOgImageAppName()).toBe("Agent-Native Slides");
    expect(renderAgentNativeOgImageSvg()).toContain("Agent-Native Slides");
  });

  it("does not infer first-party branding from a custom display name", () => {
    vi.stubEnv("APP_NAME", "Analytics");
    vi.stubEnv("npm_package_name", "customer-analytics");

    const svg = renderAgentNativeOgImageSvg();

    expect(svg).toContain("Analytics");
    expect(svg).not.toContain("Agent-Native");
    expect(svg).not.toContain("100% free and open source");
    expect(svg).not.toContain('<path d="M26.8789');
    expect(renderAgentNativeOgImageSvg({ appName: "Analytics" })).not.toContain(
      "100% free and open source",
    );
  });

  it("preserves explicit custom app names in the default title", () => {
    vi.stubEnv("APP_NAME", "Acme Workspace");
    vi.stubEnv("APP_BASE_PATH", "/analytics");
    expect(resolveAgentNativeOgImageAppName()).toBe("Acme Workspace");
    const svg = renderAgentNativeOgImageSvg();
    expect(svg).toContain("Acme Workspace");
    expect(svg).not.toContain("Agent-Native");
    expect(svg).not.toContain("100% free and open source");
    expect(svg).not.toContain('<path d="M26.8789');
  });

  it("preserves a custom app-config name under a built-in path", () => {
    vi.stubEnv("APP_BASE_PATH", "/analytics");
    defineAppConfig({ app: { name: "Acme Configured" } });

    const svg = renderAgentNativeOgImageSvg();

    expect(svg).toContain("Acme Configured");
    expect(svg).not.toContain("Agent-Native");
  });

  it("uses a custom package name without framework branding", () => {
    vi.stubEnv("npm_package_name", "try-marisco");

    const svg = renderAgentNativeOgImageSvg();

    expect(svg).toContain("Try Marisco");
    expect(svg).not.toContain("Agent-Native");
    expect(svg).not.toContain("100% free and open source");
  });

  it("uses a custom logo instead of the framework mark", () => {
    vi.stubEnv("APP_NAME", "Acme Workspace");
    vi.stubEnv("APP_LOGO_URL", "https://cdn.example.com/acme.svg");

    const svg = renderAgentNativeOgImageSvg();

    expect(svg).toContain(
      '<image x="0" y="0" width="114" height="66" href="https://cdn.example.com/acme.svg"',
    );
    expect(svg).not.toContain('<path d="M26.8789');
    expect(svg).not.toContain("Agent-Native");

    expect(renderAgentNativeOgImageSvg({ appName: "Acme Override" })).toContain(
      '<image x="0" y="0" width="114" height="66" href="https://cdn.example.com/acme.svg"',
    );
    expect(
      renderAgentNativeOgImageSvg({ appName: "Acme Override", logoUrl: null }),
    ).not.toContain("https://cdn.example.com/acme.svg");
  });

  it("can return SVG fallback headers", () => {
    expect(
      agentNativeOgImageResponseHeaders(123, "image/svg+xml; charset=utf-8"),
    ).toMatchObject({
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Length": "123",
      "Cache-Control":
        "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600",
      "CDN-Cache-Control":
        "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600",
      "Netlify-CDN-Cache-Control":
        "public, durable, max-age=60, stale-while-revalidate=604800, stale-if-error=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });

  it("identifies missing resvg runtime errors", () => {
    expect(
      isResvgRuntimeUnavailableError(
        new Error(
          "Cannot find package '@resvg/resvg-js' imported from /var/task/_chunks/social-og-image.mjs",
        ),
      ),
    ).toBe(true);
    // workerd's wording when the package is externalized out of the
    // Cloudflare worker bundle.
    expect(
      isResvgRuntimeUnavailableError(
        new Error('No such module "@resvg/resvg-js".'),
      ),
    ).toBe(true);
    expect(isResvgRuntimeUnavailableError(new Error("invalid SVG"))).toBe(
      false,
    );
  });
});
