import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../app/global.css"), "utf8");

describe("recording chapter scrolling", () => {
  it.each([680, 900])(
    "reaches the last chapter at %spx height",
    async (height) => {
      const browser = await chromium.launch({
        headless: true,
        ...(process.env.CI ? { channel: "chrome" } : {}),
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height },
        });
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
        await expect
          .poll(async () =>
            page
              .locator(".clips-recording-player-column")
              .evaluate((el) => el.scrollTop),
          )
          .toBeGreaterThan(0);
        const lastVisible = await page
          .getByRole("button", { name: "Last chapter" })
          .evaluate((button) => {
            const chapter = button.getBoundingClientRect();
            const column = button
              .closest(".clips-recording-player-column")!
              .getBoundingClientRect();
            return chapter.top >= column.top && chapter.bottom <= column.bottom;
          });
        expect(lastVisible).toBe(true);
      } finally {
        await browser.close();
      }
    },
  );
});
