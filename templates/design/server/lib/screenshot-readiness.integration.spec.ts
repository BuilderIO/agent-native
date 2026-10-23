import { readFile } from "node:fs/promises";

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
  it("loads native lazy images below the viewport before capture", async () => {
    const context = await browser.newContext({
      viewport: { width: 600, height: 800 },
    });
    try {
      const page = await context.newPage();
      await page.route("https://example.test/lazy.png", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        }),
      );
      await prepareScreenshotPage(
        page,
        '<html><body><div style="height:12000px"></div><img loading="lazy" src="https://example.test/lazy.png" width="1" height="1" alt="Footer artwork"></body></html>',
      );
      expect(
        await page.locator("img").evaluate((element) => {
          const image = element as HTMLImageElement;
          return {
            complete: image.complete,
            width: image.naturalWidth,
            belowViewport: image.getBoundingClientRect().top > innerHeight,
          };
        }),
      ).toEqual({ complete: true, width: 1, belowViewport: true });
    } finally {
      await context.close();
    }
  });

  it.each(["link", "import"])(
    "waits for a delayed %s stylesheet and its font declarations",
    async (kind) => {
      const context = await browser.newContext();
      const pendingRoutes: Promise<void>[] = [];
      try {
        const page = await context.newPage();
        const font = await readFile(
          new URL(
            import.meta
              .resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
          ),
        );
        await page.route("https://example.test/delayed.css", (route) => {
          const pending = new Promise<void>((resolve) =>
            setTimeout(resolve, 1_200),
          ).then(() =>
            route.fulfill({
              contentType: "text/css",
              body: '@font-face{font-family:ScreenshotReadiness;src:url("https://example.test/font.woff2")}h1{color:rgb(1,2,3);font-family:ScreenshotReadiness}',
            }),
          );
          pendingRoutes.push(pending);
          return pending;
        });
        await page.route("https://example.test/font.woff2", (route) => {
          const pending = new Promise<void>((resolve) =>
            setTimeout(resolve, 200),
          ).then(() =>
            route.fulfill({ contentType: "font/woff2", body: font }),
          );
          pendingRoutes.push(pending);
          return pending;
        });
        const stylesheet =
          kind === "link"
            ? '<link rel="stylesheet" href="https://example.test/delayed.css">'
            : '<style>@import url("https://example.test/delayed.css");</style>';
        await prepareScreenshotPage(
          page,
          `<html><head>${stylesheet}</head><body><h1>Ready styles</h1></body></html>`,
        );
        expect(
          await page.locator("h1").evaluate((heading) => ({
            color: getComputedStyle(heading).color,
            fontReady: document.fonts.check("24px ScreenshotReadiness"),
          })),
        ).toEqual({ color: "rgb(1, 2, 3)", fontReady: true });
      } finally {
        await Promise.all(pendingRoutes);
        await context.close();
      }
    },
  );

  it.each(["network", "http"])(
    "reports a failed %s stylesheet instead of capturing unstyled content",
    async (failure) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.route("https://example.test/failed.css", (route) =>
          failure === "network"
            ? route.abort()
            : route.fulfill({ status: 404, contentType: "text/css", body: "" }),
        );
        await expect(
          prepareScreenshotPage(
            page,
            '<html><head><link rel="stylesheet" href="https://example.test/failed.css"></head><body>Unstyled</body></html>',
          ),
        ).rejects.toMatchObject({ errorCode: "screenshot_styles_failed" });
      } finally {
        await context.close();
      }
    },
  );

  it("reports pending stylesheets when a stylesheet never finishes", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route("https://example.test/stalled.css", () => {});
      await expect(
        prepareScreenshotPage(
          page,
          '<html><head><link rel="stylesheet" href="https://example.test/stalled.css"></head><body>Unstyled</body></html>',
        ),
      ).rejects.toMatchObject({
        errorCode: "screenshot_styles_unready",
        details: { pendingStylesheets: ["https://example.test/stalled.css"] },
      });
    } finally {
      await context.close();
    }
  });

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
