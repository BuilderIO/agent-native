import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHubSpotEmailPreview } from "./hubspot-email-preview.js";
import { prepareScreenshotPage } from "./screenshot-readiness.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ chromiumSandbox: true });
});
afterAll(async () => {
  await browser?.close();
});

describe("screenshot readiness in Chromium", () => {
  it("captures ready content while an unrelated network request remains open", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      let pendingRequest = false;
      await page.route("https://example.test/keep-open", () => {
        pendingRequest = true;
      });
      await prepareScreenshotPage(
        page,
        '<html><body><script>fetch("https://example.test/keep-open")</script><h1>Ready email</h1></body></html>',
      );
      expect(pendingRequest).toBe(true);
      expect(await page.locator("h1").textContent()).toBe("Ready email");
      const png = await page.screenshot({ timeout: 2_000 });
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await context.close();
    }
  });

  it("removes literal token overflow in a 375px sample preview while preserving genuine fixed-width overflow", async () => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    try {
      const page = await context.newPage();
      const source =
        '<html><body style="margin:0;font:24px Arial"><table width="100%" cellpadding="16"><tr><td style="white-space:nowrap;font:20px Arial">{{ site_settings.company_street_address_1 }}</td></tr></table></body></html>';
      await prepareScreenshotPage(page, source);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeGreaterThan(375);
      const preview = createHubSpotEmailPreview(source);
      await prepareScreenshotPage(page, preview.html);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(375);
      const png = await page.screenshot({ timeout: 2_000 });
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      await prepareScreenshotPage(
        page,
        createHubSpotEmailPreview(source.replace('width="100%"', 'width="600"'))
          .html,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeGreaterThanOrEqual(600);
    } finally {
      await context.close();
    }
  });

  it("keeps a settled failed image inspectable in the rendered capture", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route("https://example.test/missing.png", (route) =>
        route.abort(),
      );
      await prepareScreenshotPage(
        page,
        '<html><body><img src="https://example.test/missing.png" alt="Hero"></body></html>',
      );
      const brokenImages = await page.evaluate(() =>
        Array.from(document.images)
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.getAttribute("src")),
      );
      expect(brokenImages).toEqual(["https://example.test/missing.png"]);
      const png = await page.screenshot({ timeout: 2_000 });
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await context.close();
    }
  });

  it("renders recipient samples and exposes real long-name overflow without modifying raw HTML", async () => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    try {
      const page = await context.newPage();
      const source = `<html><body style="margin:0"><p style="white-space:nowrap;font:20px monospace">{{ personalization_token('contact.firstname', 'there') }}</p></body></html>`;
      for (const samples of [
        undefined,
        [{ field: "contact.firstname", value: "Alex" }],
        [{ field: "contact.firstname", value: "A".repeat(80) }],
      ]) {
        await prepareScreenshotPage(
          page,
          createHubSpotEmailPreview(source, samples).html,
        );
        expect(await page.locator("p").textContent()).toBe(
          samples?.[0].value ?? "there",
        );
        const width = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        if (samples?.[0].value.length === 80)
          expect(width).toBeGreaterThan(375);
        else expect(width).toBe(375);
      }
      await prepareScreenshotPage(page, source);
      expect(await page.locator("p").textContent()).toContain(
        "personalization_token('contact.firstname', 'there')",
      );
    } finally {
      await context.close();
    }
  });
});
