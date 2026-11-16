import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { getOnboardingHtml } from "./onboarding-html.js";

describe("sign-in pending indicator", () => {
  it("animates the loader unless reduced motion is requested", async () => {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage();
      const html = getOnboardingHtml({
        renderSignInPage: () =>
          '<button class="btn-google"><svg class="animate-spin" aria-hidden="true"></svg></button>',
      });
      await page.setContent(html);
      const loader = page.locator(".btn-google .animate-spin");
      const normal = await loader.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          name: style.animationName,
          duration: style.animationDuration,
          state: style.animationPlayState,
        };
      });
      expect(normal.name).not.toBe("none");
      expect(parseFloat(normal.duration)).toBeGreaterThan(0);
      expect(normal.state).toBe("running");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await loader.evaluate(
          (element) => getComputedStyle(element).animationName,
        ),
      ).toBe("none");
    } finally {
      await browser.close();
    }
  });
});
