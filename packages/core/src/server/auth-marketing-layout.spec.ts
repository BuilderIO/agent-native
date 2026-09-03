// Contract: the marketing panel's "New to <app>? Learn more" link, its
// top-right/bottom-right placement class, and the product-screenshot
// blur/opacity treatment were deleted as dead code twice in one day, and
// AuthPage.spec.tsx was then edited to assert their ABSENCE so CI stayed
// green. This spec renders the real onboarding HTML for every entry in
// BUILT_IN_AUTH_MARKETING and asserts the structural contract directly, so a
// future deletion fails a test instead of flipping a unit expectation. A
// change that removes an element covered here must update the marketing
// config in auth-marketing.ts or the renderer in AuthPage.tsx — never relax
// an assertion below to make a deletion pass.
import { existsSync } from "node:fs";

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

/** The class attribute of the `<main data-agent-native-marketing-home>` root, not the <style> text (which always mentions every placement class regardless of which one is active). */
function marketingHomeClassAttr(html: string): string {
  const match = html.match(
    /<main class="([^"]*)" data-agent-native-marketing-home="true">/,
  );
  if (!match) throw new Error("marketing home root is missing");
  return match[1]!;
}

const templateScreenshotFile = (slug: string, screenshotPath: string) =>
  new URL(
    `../../../../templates/${slug}/public${screenshotPath}`,
    import.meta.url,
  );

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

      // (a) the marketing panel root element is present
      expect(props.marketing?.appName).toBe(marketing.appName);
      expect(html).toContain('data-agent-native-marketing-home="true"');
      expect(html).toContain('class="marketing-panel"');

      // (e) the layout background/wrapper classes the config depends on
      expect(html).toContain('<body class="has-marketing">');
      expect(html).toContain('class="split');
      expect(html).toContain('class="form-panel');

      // (b) the learn-more link renders with a non-empty href/text, and only
      // carries the bottom-right placement class when the config asks for it
      expect(props.marketing?.learnMorePlacement).toBe(
        marketing.learnMorePlacement,
      );
      const linkMatch = html.match(
        /<a class="auth-marketing-learn-more"[^>]*href="([^"]+)"/,
      );
      expect(linkMatch?.[1]).toBeTruthy();
      const shortName = marketing.appName.replace(/^Agent-Native\s+/i, "");
      expect(html).toContain(`New to ${shortName}?`);
      expect(html).toContain(">Learn more<");

      const homeClass = marketingHomeClassAttr(html);
      expect(homeClass.includes("has-bottom-right-learn-more")).toBe(
        marketing.learnMorePlacement === "bottom-right",
      );

      // (d) the marketing screenshot resolves to a file that exists on disk
      if (marketing.screenshotPath) {
        expect(html).toContain(`src="${marketing.screenshotPath}"`);
        expect(
          existsSync(templateScreenshotFile(slug, marketing.screenshotPath)),
        ).toBe(true);
      }
    },
  );

  it("declares the placement-class CSS rules and the screenshot blur/opacity treatment", () => {
    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
    });

    // default (top-right) placement of the learn-more link
    expect(html).toMatch(
      /\.auth-marketing-top-right\s*{[^}]*justify-content:\s*flex-end;/,
    );
    // all marketing links use the bottom-right placement
    expect(html).toMatch(/\.auth-marketing-top-right\s*{[^}]*bottom:/);
    // the product-screenshot dim/blur treatment used by the marketing panel
    expect(html).toMatch(
      /\.auth-marketing-home\.has-product-screenshot \.auth-marketing-screenshot\s*{\s*filter:\s*blur\([^)]+\);\s*opacity:\s*0\.8;/,
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
