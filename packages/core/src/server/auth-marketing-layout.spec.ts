// Contract: the marketing panel's "New to <app>? Learn more" link, its
// top-right placement, and the shared two-panel auth treatment
// were deleted as dead code twice in one day. This spec renders the real
// onboarding HTML for every entry in BUILT_IN_AUTH_MARKETING and asserts the
// structural contract directly, so a future deletion fails a test instead of
// flipping a unit expectation.
import { afterEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import type { AuthPageProps } from "../client/auth/AuthPage.js";
import { BUILT_IN_AUTH_MARKETING } from "./auth-marketing.js";
import { getOnboardingHtml } from "./onboarding-html.js";

function readAuthPageData(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

describe("built-in auth marketing layout contract", () => {
  afterEach(() => {
    resetAppConfigForTests();
  });

  const entries = Object.entries(BUILT_IN_AUTH_MARKETING);

  it("has built-in apps to cover", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)(
    "renders the marketing contract for %s",
    (slug, marketing) => {
      const html = getOnboardingHtml({
        requestHost: `${slug}.agent-native.com`,
      });
      const props = readAuthPageData(html);

      // (a) the shared two-panel marketing shell is present
      expect(props.marketing?.appName).toBe(marketing.appName);
      expect(html).toContain('data-agent-native-marketing-home="true"');
      expect(html).toContain('class="marketing-panel"');
      expect(html).toContain('class="auth-marketing-visual"');
      expect(html).toContain('data-agent-native-starfield="true"');
      expect(html).not.toMatch(/<img[^>]*class="auth-marketing-screenshot"/);

      // (e) the layout background/wrapper classes the config depends on
      expect(html).toContain('<body class="has-marketing">');
      expect(html).toContain('class="split');
      expect(html).toContain('class="form-panel');

      // (b) the learn-more link renders with a non-empty href and text
      const linkMatch = html.match(
        /<a class="auth-marketing-learn-more"[^>]*href="([^"]+)"/,
      );
      expect(linkMatch?.[1]).toBeTruthy();
      const shortName = marketing.appName.replace(/^Agent-Native\s+/i, "");
      expect(html).toContain(`New to ${shortName}?`);
      expect(html).toContain(">Learn more<");
    },
  );

  it("declares the placement-class CSS rules and the auth background treatment", () => {
    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });

    // top-right placement of the learn-more link
    expect(html).toMatch(
      /\.auth-marketing-top-right\s*{[^}]*justify-content:\s*flex-end;[^}]*top:/,
    );
    expect(html).toMatch(
      /\.auth-marketing-home \.form-panel\s*{[^}]*flex:\s*1 1 50%;[^}]*max-width:\s*none;/,
    );
    const mobileStart = html.lastIndexOf("@media (max-width: 900px) {");
    const mobileEnd = html.indexOf("\n  }\n</style>", mobileStart);
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileEnd).toBeGreaterThan(mobileStart);
    const mobileCss = html.slice(mobileStart, mobileEnd);
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.auth-marketing-top-right\s*{[^}]*position:\s*sticky;[^}]*margin-block:/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.auth-marketing-layout\s*{[^}]*flex-direction:\s*column;/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.form-panel\s*{[^}]*order:\s*-1;/,
    );
    expect(html).toContain("overflow-x: clip;");
    expect(html).toContain("overflow: clip;");
    expect(html).toContain(
      "inset-inline-end: max(1.5rem, calc(env(safe-area-inset-right) + 0.5rem));",
    );
    expect(mobileCss).toContain(
      ':root[dir="rtl"] .auth-marketing-home .auth-marketing-top-right',
    );
    expect(mobileCss).toContain(
      "inset-inline-end: max(1.5rem, calc(env(safe-area-inset-left) + 0.5rem));",
    );
    expect(html).toContain("--b-hero-ocean-opacity: 0.32;");
    expect(html).toContain("--b-hero-shader-opacity: 0.15;");
    expect(html).toContain("--b-hero-ocean-opacity: 0.3;");
    expect(html).toContain("--b-hero-shader-opacity: 0.22;");
    expect(html).toMatch(
      /\[data-agent-native-starfield\]\s*{[^}]*opacity:\s*var\(--b-hero-shader-opacity,\s*0\.15\);/,
    );
    expect(html).toMatch(
      /\.auth-marketing-home \.auth-marketing-screenshot-wrap\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;/,
    );
    expect(html).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\[data-agent-native-starfield\]\s*{\s*opacity:\s*var\(--b-hero-shader-opacity,\s*0\.15\);/,
    );
  });

  it("keeps per-app screenshot paths unique and non-empty", () => {
    const screenshotPaths = entries
      .map(([, config]) => config.screenshotPath)
      .filter((path): path is string => path !== undefined);

    expect(screenshotPaths.length).toBeGreaterThan(0);
    for (const path of screenshotPaths) {
      expect(path.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(screenshotPaths).size).toBe(screenshotPaths.length);
  });
});
