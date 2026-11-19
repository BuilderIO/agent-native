import { createRequire } from "node:module";
import path from "node:path";

import { chromium, type Browser } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const requireFromTemplate = createRequire(
  path.resolve(process.cwd(), "../../templates/chat/package.json"),
);
const { default: tailwindcss } = await import(
  requireFromTemplate.resolve("@tailwindcss/vite")
);

let server: ViteDevServer;
let browser: Browser;
beforeAll(async () => {
  server = await createServer({
    configFile: "./vitest.config.ts",
    plugins: [
      tailwindcss(),
      {
        name: "share-test",
        configureServer(s) {
          s.middlewares.use("/share-test", (_req, res) => {
            res.setHeader("content-type", "text/html");
            res.end(
              '<div id="root"></div><script type="module" src="/test/fixtures/ShareButton.browser.e2e-host.tsx"></script>',
            );
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "silent",
  });
  await server.listen();
  browser = process.env.SHARE_TEST_CDP_URL
    ? await chromium.connectOverCDP(process.env.SHARE_TEST_CDP_URL)
    : await chromium.launch({ channel: "chrome", headless: true });
});
afterAll(async () => {
  await browser.close();
  await server.close();
});
describe("share invite suggestions", () => {
  it.each([
    { width: 1440, height: 900 },
    { width: 360, height: 720 },
  ])(
    "keeps General access clickable at $width px while a long suggestion list is open",
    async (viewport) => {
      const page = await browser.newPage({ viewport });
      try {
        page.on("pageerror", (error) => console.error(error));
        const url = server.resolvedUrls?.local[0];
        if (!url) throw new Error("Missing test server URL");
        await page.goto(new URL("/share-test", url).toString());
        const input = page.getByRole("combobox", {
          name: "Add people by email",
        });
        const list = page.getByRole("listbox");
        await list.waitFor({ timeout: 7000 });
        expect(
          await input.evaluate((el) => document.activeElement === el),
        ).toBe(true);
        expect(
          await list.evaluate((el) => getComputedStyle(el).maxHeight),
        ).toBe("224px");
        expect(
          await list.evaluate((el) => el.scrollHeight > el.clientHeight),
        ).toBe(true);
        const panel = page
          .locator("[data-radix-popper-content-wrapper]")
          .first();
        const bounds = await panel.boundingBox();
        if (!bounds) throw new Error("Missing panel bounds");
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        await input.press("End");
        await input.press("ArrowUp");
        expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        await page
          .getByRole("combobox", { name: "General access" })
          .click({ timeout: 3000 });
        await page
          .getByRole("option", { name: "Anyone with the link" })
          .waitFor({ timeout: 3000 });
      } finally {
        await page.close();
      }
    },
  );
  it("selects and scrolls to a suggestion from the keyboard", async () => {
    const page = await browser.newPage();
    try {
      const url = server.resolvedUrls?.local[0];
      if (!url) throw new Error("Missing test server URL");
      await page.goto(new URL("/share-test", url).toString());
      const input = page.getByRole("combobox", { name: "Add people by email" });
      const list = page.getByRole("listbox");
      await list.waitFor();
      await input.press("ArrowUp");
      expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await input.press("Enter");
      expect(await input.inputValue()).toBe("person24@example.test");
      expect(await list.count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
