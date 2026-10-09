import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { chromium, type Browser, type Route } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RRWEB_RECORD_IFRAME_CDN_URL } from "../extensions/session-replay-iframe.js";
import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "../session-replay-iframe-protocol.js";

const RRWEB_RECORD_PATH = new URL(
  "../../node_modules/@rrweb/record/umd/record.min.js",
  import.meta.url,
);
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true });
  }
}

async function startHostServer(): Promise<ViteDevServer> {
  const server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    resolve: {
      alias: {
        "@": resolve(process.cwd(), "../../templates/design/app"),
      },
    },
    server: {
      fs: { allow: [resolve(process.cwd(), "../.."), process.cwd()] },
      host: "127.0.0.1",
      port: 0,
    },
    plugins: [
      {
        name: "session-replay-iframe-e2e",
        configureServer(devServer) {
          devServer.middlewares.use(
            "/__session-replay-iframe-e2e",
            (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(`<!doctype html>
<html>
  <head>
    <title>Session replay iframe E2E</title>
    <style>
      body { margin: 0; min-height: 1600px; }
      #root { width: 600px; height: 680px; }
      .session-replay-template-preview {
        position: relative;
        width: 600px;
        height: 680px;
        overflow: hidden;
      }
      .design-template-preview-frame {
        position: absolute;
        width: var(--design-template-width);
        height: var(--design-template-height);
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%) scale(var(--design-template-scale));
        border: 0;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/session-replay-iframe.e2e-host.tsx"></script>
  </body>
</html>`);
            },
          );
        },
      },
    ],
  });
  await server.listen();
  return server;
}

function serverUrl(server: ViteDevServer): string {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local URL");
  return new URL("/__session-replay-iframe-e2e", url).toString();
}

async function replayBody(route: Route): Promise<Record<string, unknown>> {
  const request = route.request();
  const body = request.postDataBuffer() ?? Buffer.alloc(0);
  const decoded =
    request.headers()["content-encoding"] === "gzip"
      ? gunzipSync(body).toString("utf8")
      : body.toString("utf8");
  return JSON.parse(decoded) as Record<string, unknown>;
}

describe("session replay iframe recording", () => {
  let server: ViteDevServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await startHostServer();
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([browser?.close(), server?.close()]);
  }, 60_000);

  it("records opaque extensions and same-origin email frames with masking", async () => {
    const page = await browser.newPage();
    const uploads: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.route("**/__session-replay-iframe-upload", async (route) => {
      uploads.push(await replayBody(route));
      await route.fulfill({ status: 202, body: "{}" });
    });
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.route(RRWEB_RECORD_IFRAME_CDN_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: readFileSync(RRWEB_RECORD_PATH),
      });
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

    await page.goto(serverUrl(server));
    await page.waitForFunction(() => window.__sessionReplayIframeE2E?.done, {
      timeout: 30_000,
    });
    const result = await page.evaluate(() => window.__sessionReplayIframeE2E);
    expect(result?.error).toBeUndefined();
    expect(errors).toEqual([]);
    expect(uploads.length).toBeGreaterThan(0);

    const serializedEvents = JSON.stringify(
      uploads.flatMap((upload) =>
        Array.isArray(upload.events) ? upload.events : [],
      ),
    );
    expect(serializedEvents).toContain("Inside recorded extension");
    expect(serializedEvents).toContain("Extension interaction recorded");
    expect(serializedEvents).toContain("Inside recorded email");
    expect(serializedEvents).not.toContain("super-secret-input");
    expect(serializedEvents).not.toContain("email-secret-input");

    const iframe = page.locator("iframe").first();
    expect(await iframe.getAttribute("data-agent-native-session-replay")).toBe(
      "",
    );
    expect(await iframe.getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    );

    await page.close();
  }, 60_000);

  it("records a built-in Design template preview in the parent replay", async () => {
    const page = await browser.newPage();
    const uploads: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.route("**/__session-replay-iframe-upload", async (route) => {
      uploads.push(await replayBody(route));
      await route.fulfill({ status: 202, body: "{}" });
    });
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.route(RRWEB_RECORD_IFRAME_CDN_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: readFileSync(RRWEB_RECORD_PATH),
      });
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

    const recorderResponse = page
      .waitForResponse(
        (response) => response.url() === RRWEB_RECORD_IFRAME_CDN_URL,
        { timeout: 30_000 },
      )
      .then(
        (response) => response,
        () => null,
      );
    await page.goto(`${serverUrl(server)}?surface=design-template`);
    try {
      await page.waitForSelector(`iframe[${SESSION_REPLAY_IFRAME_ATTRIBUTE}]`, {
        state: "visible",
        timeout: 30_000,
      });
    } catch (error) {
      console.error(
        "Design iframe E2E diagnostics",
        JSON.stringify({
          errors,
          url: page.url(),
          body: await page.locator("body").innerText(),
          state: await page.evaluate(() => window.__sessionReplayIframeE2E),
        }),
      );
      throw error;
    }
    const iframe = page.locator("iframe");
    expect(await page.locator("iframe").count()).toBe(1);
    expect(await iframe.getAttribute(SESSION_REPLAY_IFRAME_ATTRIBUTE)).toBe("");
    expect(await iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(await iframe.getAttribute("credentialless")).toBe("");
    expect((await recorderResponse)?.status()).toBe(200);
    expect(
      await page
        .locator(".session-replay-template-preview")
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBe(600);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(
      (attribute) => !document.querySelector(`iframe[${attribute}]`),
      SESSION_REPLAY_IFRAME_ATTRIBUTE,
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(
      (attribute) => document.querySelector(`iframe[${attribute}]`),
      SESSION_REPLAY_IFRAME_ATTRIBUTE,
      { timeout: 5_000 },
    );
    await iframe.evaluate((frame, attribute) => {
      frame.removeAttribute(attribute);
    }, SESSION_REPLAY_IFRAME_ATTRIBUTE);
    await page.waitForTimeout(50);
    await iframe.evaluate((frame, attribute) => {
      frame.setAttribute(attribute, "");
    }, SESSION_REPLAY_IFRAME_ATTRIBUTE);
    await page.waitForTimeout(250);
    await page.evaluate(async () => {
      await window.__sessionReplayIframeE2E?.stop?.();
    });
    await page.waitForFunction(() => window.__sessionReplayIframeE2E?.done, {
      timeout: 30_000,
    });

    expect(errors).toEqual([]);
    expect(uploads.length).toBeGreaterThan(0);
    const serializedEvents = JSON.stringify(
      uploads.flatMap((upload) =>
        Array.isArray(upload.events) ? upload.events : [],
      ),
    );
    expect(serializedEvents).toContain("Halcyon");
    expect(serializedEvents).toContain("Night");

    await page.close();
  }, 60_000);
});
