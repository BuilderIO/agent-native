import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentNativeOgImageResponseHeaders,
  isResvgRuntimeUnavailableError,
  renderAgentNativeOgImageSvg,
  resolveAgentNativeOgImageAppName,
} from "./social-og-image.js";
import { OG_FONT_FAMILY, resolveOgFontFiles } from "./og-fonts.js";

describe("social OG image", () => {
  afterEach(() => {
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
  });

  it("renders the title with the bundled font and a Bold-resolving weight", () => {
    const svg = renderAgentNativeOgImageSvg({
      appName: "Agent-Native Analytics",
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

  it("expands built-in app names before rendering the default title", () => {
    vi.stubEnv("APP_NAME", "Design");
    expect(resolveAgentNativeOgImageAppName()).toBe("Agent-Native Design");
    expect(renderAgentNativeOgImageSvg()).toContain("Agent-Native Design");

    vi.stubEnv("APP_NAME", "slides");
    expect(resolveAgentNativeOgImageAppName()).toBe("Agent-Native Slides");
    expect(renderAgentNativeOgImageSvg()).toContain("Agent-Native Slides");
  });

  it("preserves explicit custom app names in the default title", () => {
    vi.stubEnv("APP_NAME", "Acme Workspace");
    expect(resolveAgentNativeOgImageAppName()).toBe("Acme Workspace");
    expect(renderAgentNativeOgImageSvg()).toContain("Acme Workspace");
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
