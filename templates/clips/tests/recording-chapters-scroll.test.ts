import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../app/global.css"), "utf8");

describe("recording chapter scrolling", () => {
  let browser: Browser | undefined;

  // One Chrome for every case. A cold launch on a loaded CI runner can take
  // most of a test's 30 s budget by itself, and a hook only gets 10 s.
  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CI ? { channel: "chrome" } : {}),
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  }, 60_000);

  it.each([680, 900])(
    "reaches the last chapter at %spx height",
    async (height) => {
      if (!browser) throw new Error("beforeAll did not launch Chrome");
      const page = await browser.newPage({
        viewport: { width: 1440, height },
      });
      try {
        await page.setContent(`
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; }
          .recording { height: 100vh; display: grid; grid-template-columns: 1fr 360px;
            grid-template-rows: minmax(0, 1fr); overflow: hidden; }
          .clips-recording-player-column { display: flex; flex-direction: column;
            min-height: 0; overflow: hidden; padding: 20px; }
          [data-clips-scroll-content] { display: flex; min-height: 0; flex: 1;
            flex-direction: column; gap: 16px; }
          .player { height: 480px; flex-shrink: 0; }
          .chapters { height: 600px; flex-shrink: 0; }
          ${css}
        </style>
        <main class="recording">
          <div class="clips-recording-player-column">
            <div data-clips-scroll-content>
              <div class="player"></div>
              <div class="chapters"><button style="margin-top: 560px">Last chapter</button></div>
            </div>
          </div>
          <aside>Comments</aside>
        </main>
      `);
        await page.mouse.move(300, 500);
        await page.mouse.wheel(0, 2000);
        // The wheel scroll can still be animating when it first moves, so wait
        // for the end state. The timeout only bounds a broken page.
        await expect
          .poll(
            () =>
              page
                .getByRole("button", { name: "Last chapter" })
                .evaluate((button) => {
                  const chapter = button.getBoundingClientRect();
                  const column = button.closest(
                    ".clips-recording-player-column",
                  );
                  if (!column) return false;
                  const bounds = column.getBoundingClientRect();
                  return (
                    chapter.top >= bounds.top && chapter.bottom <= bounds.bottom
                  );
                }),
            { timeout: 10_000 },
          )
          .toBe(true);
        expect(
          await page
            .locator(".clips-recording-player-column")
            .evaluate((el) => el.scrollTop),
        ).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
  );
});
