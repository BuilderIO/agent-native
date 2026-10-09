import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser, type Route } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RRWEB_RECORD_IFRAME_CDN_URL } from "../extensions/session-replay-iframe.js";
import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "../session-replay-iframe-protocol.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const AUDIT_MODULE_URL = pathToFileURL(
  resolve(
    REPO_ROOT,
    "templates/analytics/scripts/journey-capture-iframe-audit.ts",
  ),
).href;
const RRWEB_RECORD_PATH = new URL(
  "../../node_modules/@rrweb/record/umd/record.min.js",
  import.meta.url,
);

function serializedAuditSource(): string {
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { auditReplayIframeContent } from ${JSON.stringify(AUDIT_MODULE_URL)}; process.stdout.write(auditReplayIframeContent.toString());`,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}
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
      tailwindcss(),
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
      () => {
        const frame = document.querySelector("iframe");
        if (!frame) return false;
        const bounds = frame.getBoundingClientRect();
        return bounds.bottom <= 0 || bounds.top >= window.innerHeight;
      },
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(900);
    expect(await iframe.getAttribute(SESSION_REPLAY_IFRAME_ATTRIBUTE)).toBe("");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(
      () => {
        const frame = document.querySelector("iframe");
        if (!frame) return false;
        const bounds = frame.getBoundingClientRect();
        return bounds.bottom > 0 && bounds.top < window.innerHeight;
      },
      undefined,
      { timeout: 5_000 },
    );
    expect(await iframe.getAttribute(SESSION_REPLAY_IFRAME_ATTRIBUTE)).toBe("");
    await page
      .frameLocator("iframe")
      .locator("h1.title")
      .evaluate((element) => {
        element.textContent = "Post-reentry capture marker";
      });
    await page.waitForTimeout(100);
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
    expect(serializedEvents).toContain("Post-reentry capture marker");

    await page.close();
  }, 60_000);

  it("uses the CSS containing block when zoom changes offsetParent", async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><iframe id="replay" style="width:300px;height:200px;border:0"></iframe>',
    );
    await page.locator("#replay").evaluate((replayFrame) => {
      const replayDocument = replayFrame.contentDocument!;
      replayDocument.body.style.margin = "0";

      const containingBlock = replayDocument.createElement("div");
      containingBlock.id = "containing-block";
      containingBlock.style.cssText =
        "position:relative;width:300px;height:200px";
      replayDocument.body.append(containingBlock);

      const offsetParentClip = replayDocument.createElement("div");
      offsetParentClip.id = "offset-parent-clip";
      offsetParentClip.style.cssText =
        "container-type:inline-size;overflow:hidden;width:20px;height:20px";
      containingBlock.append(offsetParentClip);

      const target = replayDocument.createElement("iframe");
      target.id = "zoomed-target";
      target.style.cssText =
        "position:absolute;left:40px;top:40px;width:20px;height:20px;zoom:2;border:0";
      target.srcdoc = "<!doctype html><html><body>target</body></html>";
      offsetParentClip.append(target);

      const clippingBlock = replayDocument.createElement("div");
      clippingBlock.id = "clipping-block";
      clippingBlock.style.cssText =
        "position:relative;overflow:hidden;width:20px;height:20px;margin-top:30px";
      containingBlock.append(clippingBlock);

      const clipped = replayDocument.createElement("iframe");
      clipped.id = "clipped-control";
      clipped.style.cssText =
        "position:absolute;left:40px;top:40px;width:20px;height:20px;border:0";
      clipped.srcdoc = "<!doctype html><html><body>clipped</body></html>";
      clippingBlock.append(clipped);
    });
    await page.waitForFunction(() => {
      const replayDocument = (
        document.querySelector("#replay") as HTMLIFrameElement
      )?.contentDocument;
      const frames = Array.from(
        replayDocument?.querySelectorAll("iframe") ?? [],
      );
      return (
        frames.length === 2 &&
        frames.every(
          (frame) => frame.contentDocument?.readyState === "complete",
        )
      );
    });

    const result = await page.evaluate((auditSource) => {
      const replayFrame = document.querySelector(
        "#replay",
      ) as HTMLIFrameElement;
      const replayDocument = replayFrame.contentDocument!;
      const target = replayDocument.querySelector(
        "#zoomed-target",
      ) as HTMLIFrameElement;
      const clipped = replayDocument.querySelector(
        "#clipped-control",
      ) as HTMLIFrameElement;
      const ids = new Map<Element, number>([
        [target, 1],
        [clipped, 2],
      ]);
      (
        window as typeof window & { __anJourneyCapture?: unknown }
      ).__anJourneyCapture = {
        replayer: {
          getMirror: () => ({ getId: (element: Element) => ids.get(element) }),
          iframe: replayFrame,
        },
      };
      const audit = new Function(`return (${auditSource})`)() as (
        input: unknown,
      ) => unknown;
      return {
        targetOffsetParent: target.offsetParent?.id ?? null,
        targetHitTest: replayDocument.elementFromPoint(85, 85) === target,
        clippedControlHitTest:
          replayDocument.elementFromPoint(45, 75) === clipped,
        audit: audit({
          dimensions: { width: 300, height: 200 },
          recordedIframeParentIds: [],
        }),
      };
    }, serializedAuditSource());

    expect(result.targetOffsetParent).toBe("offset-parent-clip");
    expect(result.targetHitTest).toBe(true);
    expect(result.clippedControlHitTest).toBe(false);
    expect(result.audit).toEqual({
      visibleIframeCount: 1,
      unavailableIframeCount: 1,
    });
    await page.close();
  }, 30_000);

  it("ignores rotated frames whose bounds only overlap an empty viewport corner", async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><iframe id="replay" style="width:300px;height:200px;border:0"></iframe>',
    );
    await page.locator("#replay").evaluate((replayFrame) => {
      const replayDocument = replayFrame.contentDocument!;
      replayDocument.body.style.cssText = "margin:0;position:relative";

      const outside = replayDocument.createElement("iframe");
      outside.id = "outside-corner";
      outside.style.cssText =
        "position:absolute;left:-20px;top:-20px;width:20px;height:20px;transform:rotate(45deg);transform-origin:center;border:0";
      outside.srcdoc = "<!doctype html><html><body>frame</body></html>";
      replayDocument.body.append(outside);

      const transformedHost = replayDocument.createElement("div");
      transformedHost.style.cssText =
        "position:absolute;left:-5px;top:-5px;width:20px;height:20px;transform:rotate(45deg);transform-origin:center";
      const visible = replayDocument.createElement("iframe");
      visible.id = "visible-corner";
      visible.style.cssText =
        "position:absolute;left:0;top:0;width:20px;height:20px;border:0";
      visible.srcdoc = "<!doctype html><html><body>frame</body></html>";
      transformedHost.append(visible);
      replayDocument.body.append(transformedHost);
    });
    await page.waitForFunction(() => {
      const replayDocument = (
        document.querySelector("#replay") as HTMLIFrameElement
      )?.contentDocument;
      const frames = Array.from(
        replayDocument?.querySelectorAll("iframe") ?? [],
      );
      return (
        frames.length === 2 &&
        frames.every(
          (frame) => frame.contentDocument?.readyState === "complete",
        )
      );
    });

    const result = await page.evaluate((auditSource) => {
      const replayFrame = document.querySelector(
        "#replay",
      ) as HTMLIFrameElement;
      const replayDocument = replayFrame.contentDocument!;
      const outside = replayDocument.querySelector(
        "#outside-corner",
      ) as HTMLIFrameElement;
      const visible = replayDocument.querySelector(
        "#visible-corner",
      ) as HTMLIFrameElement;
      const ids = new Map<Element, number>([
        [outside, 1],
        [visible, 2],
      ]);
      (
        window as typeof window & { __anJourneyCapture?: unknown }
      ).__anJourneyCapture = {
        replayer: {
          getMirror: () => ({ getId: (element: Element) => ids.get(element) }),
          iframe: replayFrame,
        },
      };
      const audit = new Function(`return (${auditSource})`)() as (
        input: unknown,
      ) => unknown;
      return {
        outsideBounds: outside.getBoundingClientRect().toJSON(),
        outsideHitTest: replayDocument.elementFromPoint(2, 2) === outside,
        visibleHitTest: replayDocument.elementFromPoint(2, 2) === visible,
        audit: audit({
          dimensions: { width: 300, height: 200 },
          recordedIframeParentIds: [],
        }),
      };
    }, serializedAuditSource());

    expect(result.outsideBounds.right).toBeGreaterThan(0);
    expect(result.outsideBounds.bottom).toBeGreaterThan(0);
    expect(result.outsideHitTest).toBe(false);
    expect(result.visibleHitTest).toBe(true);
    expect(result.audit).toEqual({
      visibleIframeCount: 1,
      unavailableIframeCount: 1,
    });
    await page.close();
  }, 30_000);

  it("reports unverifiable for a 3D frame whose bounds only touch the viewport", async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><iframe id="replay" style="width:300px;height:200px;border:0"></iframe>',
    );
    await page.locator("#replay").evaluate((replayFrame) => {
      const replayDocument = replayFrame.contentDocument!;
      replayDocument.body.style.cssText = "margin:0;position:relative";

      const target = replayDocument.createElement("iframe");
      target.id = "unverifiable-3d-frame";
      target.style.cssText =
        "position:absolute;left:-20px;top:-20px;width:20px;height:20px;transform:perspective(300px) rotateX(30deg) rotateZ(45deg);border:0";
      target.srcdoc = "<!doctype html><html><body>frame</body></html>";
      replayDocument.body.append(target);
    });
    await page.waitForFunction(() => {
      const replayDocument = (
        document.querySelector("#replay") as HTMLIFrameElement
      )?.contentDocument;
      const target = replayDocument?.querySelector(
        "#unverifiable-3d-frame",
      ) as HTMLIFrameElement | null;
      return target?.contentDocument?.readyState === "complete";
    });

    const result = await page.evaluate((auditSource) => {
      const replayFrame = document.querySelector(
        "#replay",
      ) as HTMLIFrameElement;
      const replayDocument = replayFrame.contentDocument!;
      const target = replayDocument.querySelector(
        "#unverifiable-3d-frame",
      ) as HTMLIFrameElement;
      const recordedMirrorId = 41;
      const ids = new Map<Element, number>([[target, recordedMirrorId]]);
      (
        window as typeof window & { __anJourneyCapture?: unknown }
      ).__anJourneyCapture = {
        replayer: {
          getMirror: () => ({ getId: (element: Element) => ids.get(element) }),
          iframe: replayFrame,
        },
      };
      const audit = new Function(`return (${auditSource})`)() as (
        input: unknown,
      ) => unknown;
      const bounds = target.getBoundingClientRect();
      let hasHit = false;
      const left = Math.max(0, bounds.left);
      const top = Math.max(0, bounds.top);
      const right = Math.min(300, bounds.right);
      const bottom = Math.min(200, bounds.bottom);
      for (let row = 0; row < 25; row += 1) {
        const y = top + ((row + 0.5) / 25) * (bottom - top);
        for (let column = 0; column < 25; column += 1) {
          const x = left + ((column + 0.5) / 25) * (right - left);
          if (replayDocument.elementsFromPoint(x, y).includes(target)) {
            hasHit = true;
          }
        }
      }
      return {
        bounds: bounds.toJSON(),
        hasHit,
        audit: audit({
          dimensions: { width: 300, height: 200 },
          recordedIframeParentIds: [recordedMirrorId],
        }),
      };
    }, serializedAuditSource());

    expect(result.bounds.right).toBeGreaterThan(0);
    expect(result.bounds.bottom).toBeGreaterThan(0);
    expect(result.bounds.left).toBeLessThan(300);
    expect(result.bounds.top).toBeLessThan(200);
    expect(result.hasHit).toBe(false);
    expect(result.audit).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
    await page.close();
  }, 30_000);

  it("reports a visible perspective frame as unverifiable without descending into it", async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><iframe id="replay" style="width:300px;height:200px;border:0"></iframe>',
    );
    await page.locator("#replay").evaluate((replayFrame) => {
      const replayDocument = replayFrame.contentDocument!;
      replayDocument.body.style.cssText = "margin:0;position:relative";

      const target = replayDocument.createElement("iframe");
      target.id = "visible-perspective-frame";
      target.style.cssText =
        "position:absolute;left:90px;top:60px;width:120px;height:80px;transform:perspective(300px) rotateX(15deg) rotateY(15deg);border:0";
      target.srcdoc =
        '<!doctype html><html><body style="margin:0"></body></html>';
      replayDocument.body.append(target);
    });
    await page.waitForFunction(() => {
      const replayDocument = (
        document.querySelector("#replay") as HTMLIFrameElement
      )?.contentDocument;
      const target = replayDocument?.querySelector(
        "#visible-perspective-frame",
      ) as HTMLIFrameElement | null;
      return target?.contentDocument?.readyState === "complete";
    });
    await page.locator("#replay").evaluate((replayFrame) => {
      const target = replayFrame.contentDocument!.querySelector(
        "#visible-perspective-frame",
      ) as HTMLIFrameElement;
      const childDocument = target.contentDocument!;
      const nested = childDocument.createElement("iframe");
      nested.id = "nested-recorded-frame";
      nested.style.cssText =
        "position:absolute;left:5px;top:5px;width:24px;height:20px;border:0";
      nested.srcdoc = "<!doctype html><html><body>nested frame</body></html>";
      childDocument.body.append(nested);
    });
    await page.waitForFunction(() => {
      const replayDocument = (
        document.querySelector("#replay") as HTMLIFrameElement
      )?.contentDocument;
      const target = replayDocument?.querySelector(
        "#visible-perspective-frame",
      ) as HTMLIFrameElement | null;
      const nested = target?.contentDocument?.querySelector(
        "#nested-recorded-frame",
      ) as HTMLIFrameElement | null;
      return nested?.contentDocument?.readyState === "complete";
    });

    const result = await page.evaluate((auditSource) => {
      const replayFrame = document.querySelector(
        "#replay",
      ) as HTMLIFrameElement;
      const replayDocument = replayFrame.contentDocument!;
      const target = replayDocument.querySelector(
        "#visible-perspective-frame",
      ) as HTMLIFrameElement;
      const nested = target.contentDocument!.querySelector(
        "#nested-recorded-frame",
      ) as HTMLIFrameElement;
      const targetMirrorId = 51;
      const nestedMirrorId = 52;
      const ids = new Map<Element, number>([
        [target, targetMirrorId],
        [nested, nestedMirrorId],
      ]);
      (
        window as typeof window & { __anJourneyCapture?: unknown }
      ).__anJourneyCapture = {
        replayer: {
          getMirror: () => ({ getId: (element: Element) => ids.get(element) }),
          iframe: replayFrame,
        },
      };
      const audit = new Function(`return (${auditSource})`)() as (
        input: unknown,
      ) => unknown;
      const bounds = target.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        hitTest: replayDocument
          .elementsFromPoint(
            (bounds.left + bounds.right) / 2,
            (bounds.top + bounds.bottom) / 2,
          )
          .includes(target),
        audit: audit({
          dimensions: { width: 300, height: 200 },
          recordedIframeParentIds: [targetMirrorId, nestedMirrorId],
        }),
      };
    }, serializedAuditSource());

    expect(result.bounds.left).toBeGreaterThan(0);
    expect(result.bounds.top).toBeGreaterThan(0);
    expect(result.bounds.right).toBeLessThan(300);
    expect(result.bounds.bottom).toBeLessThan(200);
    expect(result.hitTest).toBe(true);
    expect(result.audit).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
      unverifiableIframeCount: 1,
    });
    await page.close();
  }, 30_000);

  it("ignores a hidden backface iframe with no hit-test points", async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<!doctype html><iframe id="replay" style="width:300px;height:200px;border:0"></iframe>',
    );
    await page.locator("#replay").evaluate((replayFrame) => {
      const replayDocument = replayFrame.contentDocument!;
      replayDocument.body.style.cssText = "margin:0;position:relative";

      const hidden = replayDocument.createElement("iframe");
      hidden.id = "hidden-backface-frame";
      hidden.style.cssText =
        "position:absolute;left:50px;top:50px;width:20px;height:20px;transform:perspective(300px) rotateY(180deg);backface-visibility:hidden;border:0";
      hidden.srcdoc = "<!doctype html><html><body>frame</body></html>";
      replayDocument.body.append(hidden);
    });
    await page.waitForFunction(() => {
      const replayDocument = (
        document.querySelector("#replay") as HTMLIFrameElement
      )?.contentDocument;
      const hidden = replayDocument?.querySelector(
        "#hidden-backface-frame",
      ) as HTMLIFrameElement | null;
      return hidden?.contentDocument?.readyState === "complete";
    });

    const result = await page.evaluate((auditSource) => {
      const replayFrame = document.querySelector(
        "#replay",
      ) as HTMLIFrameElement;
      const replayDocument = replayFrame.contentDocument!;
      const hidden = replayDocument.querySelector(
        "#hidden-backface-frame",
      ) as HTMLIFrameElement;
      const recordedMirrorId = 42;
      const ids = new Map<Element, number>([[hidden, recordedMirrorId]]);
      (
        window as typeof window & { __anJourneyCapture?: unknown }
      ).__anJourneyCapture = {
        replayer: {
          getMirror: () => ({ getId: (element: Element) => ids.get(element) }),
          iframe: replayFrame,
        },
      };
      const audit = new Function(`return (${auditSource})`)() as (
        input: unknown,
      ) => unknown;
      const bounds = hidden.getBoundingClientRect();
      let hasHit = false;
      for (let row = 0; row < 25; row += 1) {
        const y = bounds.top + ((row + 0.5) / 25) * bounds.height;
        for (let column = 0; column < 25; column += 1) {
          const x = bounds.left + ((column + 0.5) / 25) * bounds.width;
          if (replayDocument.elementsFromPoint(x, y).includes(hidden)) {
            hasHit = true;
          }
        }
      }
      return {
        backfaceVisibility:
          replayDocument.defaultView!.getComputedStyle(hidden)
            .backfaceVisibility,
        hasHit,
        audit: audit({
          dimensions: { width: 300, height: 200 },
          recordedIframeParentIds: [recordedMirrorId],
        }),
      };
    }, serializedAuditSource());

    expect(result.backfaceVisibility).toBe("hidden");
    expect(result.hasHit).toBe(false);
    expect(result.audit).toEqual({
      visibleIframeCount: 0,
      unavailableIframeCount: 0,
    });
    await page.close();
  }, 30_000);
});
