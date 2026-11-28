import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { expect, it } from "vitest";

it("keeps absolutely positioned main content from scrolling the outer surface", async () => {
  const executablePath = existsSync(chromium.executablePath())
    ? undefined
    : existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    await page.setContent(`
      <div class="agent-sidebar-main-surface" style="display: flex; flex-direction: column; width: 400px; height: 240px; overflow: auto">
        <header style="height: 40px; flex: none">Header</header>
        <main class="agent-native-app-main" style="flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain">
          <div style="height: 600px">Content</div>
          <div id="overlay" style="position: absolute; top: 500px; right: 0; width: 20px; height: 20px"></div>
        </main>
      </div>
    `);
    await page.addStyleTag({
      path: fileURLToPath(new URL("./agent-native.css", import.meta.url)),
    });

    const result = await page.evaluate(() => {
      const outer = document.querySelector<HTMLElement>(
        ".agent-sidebar-main-surface",
      );
      const main = document.querySelector<HTMLElement>(
        ".agent-native-app-main",
      );
      const overlay = document.querySelector<HTMLElement>("#overlay");
      if (!outer || !main || !overlay)
        throw new Error("Missing scroll fixture");
      const overlayTop =
        overlay.getBoundingClientRect().top - main.getBoundingClientRect().top;
      const overlayRight =
        main.getBoundingClientRect().right -
        overlay.getBoundingClientRect().right;
      main.scrollTop = 100;
      outer.scrollTop = 100;
      return {
        mainScrollTop: main.scrollTop,
        outerScrollTop: outer.scrollTop,
        outerOverflow: outer.scrollHeight - outer.clientHeight,
        overlayTop,
        overlayRight,
      };
    });

    expect(result.outerScrollTop).toBe(0);
    expect(result.outerOverflow).toBe(0);
    expect(result.mainScrollTop).toBe(100);
    expect(result.overlayTop).toBe(500);
    expect(result.overlayRight).toBe(0);
  } finally {
    await browser.close();
  }
});
