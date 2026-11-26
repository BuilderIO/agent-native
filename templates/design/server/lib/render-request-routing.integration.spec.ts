import http from "node:http";
import type { AddressInfo } from "node:net";

import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { routeAllowedRenderRequests } from "./design-to-figma-svg.js";

const isAllowed = async (url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol === "about:" || parsed.protocol === "data:") return true;
  return parsed.hostname === "localhost";
};

const localSafeFetch: typeof ssrfSafeFetch = (url, init, options) =>
  ssrfSafeFetch(url, init, {
    ...options,
    allowedPrivateOrigins: [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
    ],
  });

let browser: Browser;
let server: http.Server;
let port: number;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/to-blocked") {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/blocked` });
      res.end();
      return;
    }
    if (req.url === "/to-allowed") {
      res.writeHead(302, { Location: "/final" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<p id="served">served ${req.url}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits.length = 0;
});

async function render(html: string) {
  const context = await browser.newContext();
  await routeAllowedRenderRequests(context, isAllowed, localSafeFetch);
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  return { context, page };
}

describe("routeAllowedRenderRequests", () => {
  it("stops a redirect from an allowed URL to a blocked one", async () => {
    const { context, page } = await render(
      `<iframe src="http://localhost:${port}/to-blocked"></iframe>` +
        `<img src="http://localhost:${port}/to-blocked">`,
    );
    try {
      expect(hits).not.toContain("/blocked");
      expect(page.frames().map((frame) => frame.url())).not.toContain(
        `http://127.0.0.1:${port}/blocked`,
      );
    } finally {
      await context.close();
    }
  });

  it("follows a redirect between allowed URLs", async () => {
    const { context, page } = await render(
      `<iframe src="http://localhost:${port}/to-allowed"></iframe>`,
    );
    try {
      expect(hits).toEqual(["/to-allowed", "/final"]);
      await expect(
        page.frameLocator("iframe").locator("#served").textContent(),
      ).resolves.toBe("served /final");
    } finally {
      await context.close();
    }
  });

  it("refuses to navigate the page away and reports it", async () => {
    const context = await browser.newContext();
    const requests = await routeAllowedRenderRequests(
      context,
      isAllowed,
      localSafeFetch,
    );
    const page = await context.newPage();
    try {
      await page.setContent(
        `<script>location.href = "http://localhost:${port}/elsewhere";</script>`,
        { waitUntil: "load" },
      );
      // fixed-sleep-ok: proving a navigation never reached the server needs a bounded wait
      await page.waitForTimeout(500);
      expect(hits).not.toContain("/elsewhere");
      expect(requests.blockedNavigations).toEqual([
        `http://localhost:${port}/elsewhere`,
      ]);
    } finally {
      await context.close();
    }
  });
});
