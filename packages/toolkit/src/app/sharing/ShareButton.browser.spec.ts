import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
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

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let cacheDir: string;
beforeAll(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "share-browser-vite-"));
  server = await createServer({
    cacheDir,
    optimizeDeps: {
      entries: ["src/app/__fixtures__/ShareButton.browser.e2e-host.tsx"],
    },
    configFile: "./vitest.config.ts",
    plugins: [
      tailwindcss(),
      {
        name: "share-test",
        configureServer(s) {
          s.middlewares.use("/_agent-native/avatar", (_req, res) => {
            res.statusCode = 204;
            res.end();
          });
          s.middlewares.use("/favicon.ico", (_req, res) => {
            res.statusCode = 204;
            res.end();
          });
          s.middlewares.use("/share-test", (_req, res) => {
            res.setHeader("content-type", "text/html");
            res.end(
              '<div id="root"></div><script type="module" src="/src/app/__fixtures__/ShareButton.browser.e2e-host.tsx"></script>',
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
    : await chromium.launch({ headless: true });
});
afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    try {
      await server?.close();
    } finally {
      if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
async function setupPage(page: import("playwright").Page) {
  await page.route(
    "**/_agent-native/actions/get-localization-preference",
    (route) => route.fulfill({ json: {} }),
  );
  await page.route("**/_agent-native/application-state/localization", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/_agent-native/auth/session", (route) =>
    route.fulfill({ json: { user: { email: "owner@example.test" } } }),
  );
  await page.route(
    "**/_agent-native/actions/list-resource-access-requests**",
    (route) => route.fulfill({ json: { requests: [], hasMore: false } }),
  );
  await page.route("**/_agent-native/actions/list-resource-shares**", (route) =>
    route.fulfill({
      json: {
        ownerEmail: "owner@example.test",
        orgId: null,
        visibility: "private",
        role: "owner",
        shares: [],
      },
    }),
  );
  await page.route("**/_agent-native/org/members**", (route) =>
    route.fulfill({
      json: {
        members: Array.from({ length: 25 }, (_, i) => ({
          email: `person${i}@example.test`,
          name: `Person ${i}`,
          role: "member",
        })),
        hasMore: false,
        nextOffset: null,
      },
    }),
  );
}

describe("share invite suggestions", () => {
  it.each([
    { width: 1440, height: 900 },
    { width: 360, height: 720 },
    { width: 360, height: 400 },
  ])(
    "keeps General access clickable at $width × $height while a long suggestion list is open",
    async (viewport) => {
      if (!server || !browser) throw new Error("Share fixture did not start");
      const page = await browser.newPage({ viewport });
      try {
        await setupPage(page);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 400)
            errors.push(`${response.status()} ${response.url()}`);
        });
        const url = server.resolvedUrls?.local[0];
        if (!url) throw new Error("Missing test server URL");
        await page.goto(new URL("/share-test", url).toString());
        const input = page.getByRole("combobox", {
          name: "Add people by email",
        });
        const list = page.getByRole("listbox");
        try {
          await list.waitFor({ timeout: 7000 });
        } catch (error) {
          console.error("Share fixture state:", {
            body: await page.locator("body").innerText(),
            errors,
            url: page.url(),
          });
          throw error;
        }
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
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        await input.press("End");
        await input.press("ArrowUp");
        expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        await page
          .getByRole("combobox", { name: "General access" })
          .click({ timeout: 3000 });
        await page
          .getByRole("option", { name: "Anyone with the link" })
          .waitFor({ timeout: 3000 });
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
  );
  it("selects and scrolls to a suggestion from the keyboard", async () => {
    if (!server || !browser) throw new Error("Share fixture did not start");
    const page = await browser.newPage();
    try {
      await setupPage(page);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400)
          errors.push(`${response.status()} ${response.url()}`);
      });
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
      await input.fill("");
      await list.waitFor();
      await input.press("ArrowUp");
      expect(await input.getAttribute("aria-activedescendant")).not.toBeNull();
      await input.press("Escape");
      expect(await list.count()).toBe(0);
      expect(await input.getAttribute("aria-activedescendant")).toBeNull();
      expect(await input.isVisible()).toBe(true);
      expect(
        await page
          .getByRole("combobox", { name: "General access" })
          .isVisible(),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
