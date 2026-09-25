// Contract: every built-in auth page keeps its marketing links and shared
// two-panel treatment. Render the real onboarding HTML so accidental deletion
// fails here instead of becoming a visual regression.
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
      expect(html.indexOf('class="form-panel')).toBeLessThan(
        html.indexOf('class="marketing-panel"'),
      );

      // (b) Learn more follows the description and precedes the GitHub badge
      const linkMatch = html.match(
        /<a class="auth-marketing-description-link"[^>]*href="([^"]+)"/,
      );
      expect(linkMatch?.[1]).toBeTruthy();
      expect(html.indexOf('class="auth-marketing-description"')).toBeLessThan(
        html.indexOf('class="auth-marketing-description-link"'),
      );
      expect(
        html.indexOf('class="auth-marketing-description-link"'),
      ).toBeLessThan(html.indexOf('class="oss-badge"'));
      expect(html).not.toContain("New to ");
      expect(html).toContain(">Learn more<");
      expect(html).toContain(
        '<a class="oss-badge" href="https://github.com/BuilderIO/agent-native" target="_blank" rel="noreferrer">',
      );
    },
  );

  it("declares the placement-class CSS rules and the auth background treatment", () => {
    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });

    expect(html).toMatch(
      /\.auth-marketing-home \.auth-marketing-layout\s*{[^}]*min-height:\s*100vh;[^}]*display:\s*flex;/,
    );
    expect(html).toMatch(/body\.has-marketing\s*{[^}]*padding:\s*0;/);
    expect(html).toMatch(
      /\.auth-marketing-home \.auth-marketing-description-link\s*{[^}]*text-decoration:\s*underline;/,
    );
    expect(html).toMatch(
      /\.auth-marketing-home \.form-panel\s*{[^}]*flex:\s*1 1 50%;[^}]*max-width:\s*none;/,
    );
    expect(html).toMatch(
      /\.auth-marketing-home \.marketing-panel\s*{[^}]*order:\s*1;/,
    );
    expect(html).toMatch(
      /\.auth-marketing-home \.form-panel\s*{[^}]*order:\s*2;/,
    );
    const mobileStart = html.lastIndexOf("@media (max-width: 900px) {");
    const mobileEnd = html.indexOf("\n  }\n</style>", mobileStart);
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileEnd).toBeGreaterThan(mobileStart);
    const mobileCss = html.slice(mobileStart, mobileEnd);
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.auth-marketing-layout\s*{[^}]*flex-direction:\s*column;/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home\s*{[^}]*min-height:\s*100vh;[^}]*min-height:\s*100svh;/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.form-panel\s*{[^}]*order:\s*1;[^}]*padding:\s*max\(1\.5rem, env\(safe-area-inset-top\)\) 1\.25rem max\(1\.5rem, env\(safe-area-inset-bottom\)\);/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.marketing-panel\s*{[^}]*display:\s*none;/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.card h1\s*{[^}]*font-size:\s*clamp\(1\.625rem, 6vw, 2rem\);/,
    );
    expect(mobileCss).toMatch(
      /\.auth-marketing-home \.card button\s*{[^}]*min-height:\s*2\.75rem;/,
    );
    expect(mobileCss).toMatch(
      /body\.has-marketing \.locale-trigger\s*{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/,
    );
    expect(html).not.toMatch(
      /\.auth-marketing-home \.form-panel\s*{[^}]*border-top:/,
    );
    expect(html).toContain("overflow-x: clip;");
    expect(html).toContain("overflow: clip;");
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
