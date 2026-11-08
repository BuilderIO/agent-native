import { chromium, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("local Plan MDX in the browser", () => {
  let server: ViteDevServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "plan-mdx-browser-fixture",
          configureServer(devServer) {
            devServer.middlewares.use("/__plan-mdx-test", (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end("<!doctype html><html></html>");
            });
          },
        },
      ],
    });
    await server.listen();
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = await chromium.launch({ headless: true, channel: "chrome" });
    }
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("loads idless local plan content and preserves IDs on a subsequent parse", async () => {
    const page = await browser.newPage();
    try {
      const baseUrl = server.resolvedUrls?.local[0];
      if (!baseUrl) throw new Error("Vite did not expose a local URL");
      await page.goto(new URL("/__plan-mdx-test", baseUrl).href);
      await page.addScriptTag({
        type: "module",
        content: `
          window.planMdxResult = import("/server/plan-mdx.ts").then(async ({ parsePlanMdxFolder }) => {
            const folder = { "plan.mdx": "---\\ntitle: Test Plan\\n---\\n\\n# Hello\\n\\nThis is a local plan.\\n" };
            const first = await parsePlanMdxFolder(folder);
            const second = await parsePlanMdxFolder(folder, { validateAuthoringChangesAgainst: first });
            return { first: first.blocks, second: second.blocks };
          });
        `,
      });
      const result = await page.evaluate(async () => {
        return await (
          window as unknown as {
            planMdxResult: Promise<{ first: unknown[]; second: unknown[] }>;
          }
        ).planMdxResult;
      });
      expect(result.first.length).toBeGreaterThan(0);
      expect(result.second).toEqual(result.first);
    } finally {
      await page.close();
    }
  });
});
