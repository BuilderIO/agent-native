import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import {
  startDesignConnectBridge,
  prepareDesignConnectManifest,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";
import { PDFParse } from "pdf-parse";

import { comparePngs } from "../scripts/figma-fidelity/lib/compare";

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @font-face {
        font-family: "Parity Inter";
        font-style: normal;
        font-weight: 100 900;
        font-display: swap;
        src: url("/inter.woff2") format("woff2");
      }
      html, body { box-sizing: border-box; width: 360px; height: 240px; margin: 0; overflow: hidden; }
      html { background: linear-gradient(135deg, #fef3c7 0 50%, #dbeafe 50% 100%); }
      body { background: transparent; }
      body { color: #182230; font: 400 16px/1.65 "Parity Inter", sans-serif; }
      main { box-sizing: border-box; width: 360px; height: 240px; padding: 20px; }
      h1 { margin: 0 0 8px; font-size: 25px; font-weight: 700; line-height: 1.24; letter-spacing: -0.55px; }
      p { margin: 0 0 7px; }
      .two-line { width: 304px; font-size: 16px; line-height: 1.8; }
      .small { font-size: 12px; font-weight: 600; letter-spacing: 0.2px; }
      .asset-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
      .asset-row img, .background-image { width: 24px; height: 24px; }
      .background-image { background-image: url("/pattern.svg"); background-size: 24px 24px; }
      .fragment-background { width: 24px; height: 24px; background-size: 24px 24px; background-image: url("data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%228%22 height%3D%228%22%3E%3Cdefs%3E%3Cfilter id%3D%22n%22%3E%3CfeGaussianBlur stdDeviation%3D%220%22%2F%3E%3C%2Ffilter%3E%3C%2Fdefs%3E%3Cpath filter%3D%22url(%23n)%22 fill%3D%22%237c3aed%22 d%3D%22M0 0h4v4H0z%22%2F%3E%3C%2Fsvg%3E"); }
    </style>
    <title>Cross-origin export font parity</title>
  </head>
  <body>
    <main>
      <h1>Wide Willow &amp; Wrenfield</h1>
      <p class="two-line">Sphinx of black quartz, judge my vow. Fonts change line wraps and the space between these two lines.</p>
      <p class="small">AV 0123456789 · office · affine · fjord</p>
      <div class="asset-row"><img src="/parity-image.svg" alt="Four-color parity asset" /><div class="background-image"></div><div class="fragment-background"></div></div>
    </main>
    <script>
      document.fonts.ready.then(() => {
        document.documentElement.dataset.exportFontReady = String(document.fonts.check('400 16px "Parity Inter"'));
      });
    </script>
  </body>
</html>`;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a local port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function downloadBytes(page: Page, click: () => Promise<unknown>) {
  const browserErrors: string[] = [];
  const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
    if (message.type() === "error") browserErrors.push(message.text());
  };
  const onPageError = (error: Error) => browserErrors.push(error.message);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  let download: Download;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      click(),
    ]);
  } catch (error) {
    const toasts = await page
      .locator("[data-sonner-toast]")
      .allTextContents()
      .catch(() => []);
    const exportState = await page
      .evaluate(() => {
        const win = window as Window & {
          __exportReadyDocumentId?: string;
          __exportMessages?: Array<Record<string, unknown>>;
          __exportSnapshots?: Array<{
            documentId: string;
            readinessRequestId: number | null;
            html: string;
          }>;
        };
        return {
          readyDocumentId: win.__exportReadyDocumentId ?? null,
          messages: win.__exportMessages ?? [],
          snapshots: (win.__exportSnapshots ?? []).map((snapshot) => ({
            documentId: snapshot.documentId,
            readinessRequestId: snapshot.readinessRequestId,
            htmlLength: snapshot.html.length,
          })),
          screens: Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-screen-iframe-id]",
            ),
          ).map((frame) => ({
            id: frame.dataset.screenIframeId ?? null,
            sourceType: frame.dataset.designSourceType ?? null,
          })),
        };
      })
      .catch(() => null);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; browser errors=${browserErrors.join(" | ")}; toasts=${toasts.join(" | ")}; exportState=${JSON.stringify(exportState)}`,
    );
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  const stream = await download.createReadStream();
  if (!stream) throw new Error(`${download.suggestedFilename()} had no bytes`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function downloadPng(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  await expect(exportMenu).toBeVisible();
  await exportMenu.press("ArrowRight");
  const pngMenuItem = page.getByRole("menuitem", { name: "Download PNG" });
  await expect(pngMenuItem).toBeVisible();
  return downloadBytes(page, () => pngMenuItem.click());
}

async function downloadAllScreensPdf(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  await expect(exportMenu).toBeVisible();
  await exportMenu.hover();
  const pdfMenuItem = page.getByRole("menuitem", {
    name: "Download PDF (all screens)",
  });
  await expect(pdfMenuItem).toBeVisible();
  return downloadBytes(page, () => pdfMenuItem.click());
}

async function pdfPagesPng(pdf: Buffer, desiredWidth: number) {
  const parser = new PDFParse({ data: pdf });
  try {
    const rendered = await parser.getScreenshot({
      desiredWidth,
      partial: [1, 2],
      imageBuffer: true,
      imageDataUrl: false,
    });
    const pages = rendered.pages.map((page) => page.data);
    if (pages.length !== 2 || pages.some((page) => !page)) {
      throw new Error("all-screens PDF did not contain two rasterized pages");
    }
    return pages.map((page) => Buffer.from(page!));
  } finally {
    await parser.destroy();
  }
}

test("cross-origin localhost PNG and PDF preserve the live custom font pixels", async ({
  page: basePage,
  browser,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("test baseURL is unavailable");
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "design-export-font-"),
  );
  const publicPath = path.join(rootPath, "public");
  fs.mkdirSync(publicPath);
  fs.writeFileSync(path.join(rootPath, "index.html"), HTML);
  const interFontPath = path.resolve(
    process.cwd(),
    "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  );
  fs.copyFileSync(interFontPath, path.join(publicPath, "inter.woff2"));
  fs.writeFileSync(
    path.join(publicPath, "parity-image.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#ef4444" d="M0 0h12v12H0z"/><path fill="#22c55e" d="M12 0h12v12H12z"/><path fill="#3b82f6" d="M0 12h12v12H0z"/><path fill="#f59e0b" d="M12 12h12v12H12z"/></svg>',
  );
  fs.writeFileSync(
    path.join(publicPath, "pattern.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#7c3aed" d="M0 0h4v4H0z"/><path fill="#f0abfc" d="M4 4h4v4H4z"/></svg>',
  );
  fs.writeFileSync(
    path.join(rootPath, "vite.config.ts"),
    "export default { server: { cors: true } };\n",
  );

  const targetPort = await freePort();
  const targetUrl = `http://127.0.0.1:${targetPort}`; // e2e-harness-ignore: ephemeral source server uses its own port.
  let browserContext: BrowserContext | null = null;
  let vite: ReturnType<typeof spawn> | null = null;
  let bridge: DesignConnectBridge | null = null;
  let designId: string | null = null;
  let cdp: { detach: () => Promise<void> } | null = null;
  let sourcePage: Page | null = null;
  let serverRenderPage: Page | null = null;
  const artifactPath = path.resolve(
    process.cwd(),
    ".tmp/design-export-parity/cross-origin-font",
  );

  try {
    const viteEntrypoint = path.resolve(
      path.dirname(createRequire(import.meta.url).resolve("vite")),
      "../../bin/vite.js",
    );
    vite = spawn(
      process.execPath,
      [
        viteEntrypoint,
        "--host",
        "127.0.0.1",
        "--port",
        String(targetPort),
        "--strictPort",
      ],
      { cwd: rootPath, stdio: ["ignore", "pipe", "pipe"] },
    );
    let viteError = "";
    vite.stderr?.on("data", (chunk) => (viteError += String(chunk)));
    await expect
      .poll(
        async () => {
          if (vite?.exitCode !== null) {
            throw new Error(`Vite exited with ${vite?.exitCode}: ${viteError}`);
          }
          return (await fetch(targetUrl).catch(() => null))?.ok ?? false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const bridgePort = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: targetUrl,
      port: bridgePort,
    });
    const opened = (await postAction(request, baseURL, "open-visual-edit", {
      title: "Cross-origin export font parity",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      routes: [
        {
          path: "/",
          url: targetUrl,
          title: "Font screen",
          width: 360,
          height: 240,
        },
        {
          path: "/",
          url: `${targetUrl}/?screen=second`,
          title: "Font screen second",
          width: 360,
          height: 240,
        },
      ],
      navigate: false,
      publicReadOnly: false,
    })) as { designId: string; bridgeToken: string; previewToken: string };
    designId = opened.designId;
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });

    browserContext = await browser.newContext({
      storageState: await basePage.context().storageState(),
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
    });
    const exportPage = await browserContext.newPage();
    const browserErrors: string[] = [];
    exportPage.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    exportPage.on("pageerror", (error) => browserErrors.push(error.message));
    await exportPage.addInitScript(() => {
      const win = window as Window & {
        __exportReadyDocumentId?: string;
        __exportMessages?: Array<Record<string, unknown>>;
        __exportSnapshots?: Array<{
          documentId: string;
          html: string;
          readinessRequestId: number | null;
        }>;
      };
      win.__exportSnapshots = [];
      win.__exportMessages = [];
      window.addEventListener("message", (event) => {
        const type = event.data?.type;
        if (
          type === "test:design-export-runtime-message" &&
          event.data.message
        ) {
          const frame = Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-screen-iframe-id]",
            ),
          ).find((candidate) => candidate.contentWindow === event.source);
          win.__exportMessages?.push({
            ...event.data.message,
            screenId: frame?.dataset.screenIframeId ?? null,
            direction: "to-frame",
          });
          return;
        }
        if (
          window.parent !== window &&
          (type === "request-runtime-layer-snapshot" ||
            type === "grant-runtime-layer-snapshot-reservation")
        ) {
          const payload = event.data;
          window.parent.postMessage(
            {
              type: "test:design-export-runtime-message",
              message: {
                type,
                readinessRequestId: Number.isSafeInteger(
                  payload.readinessRequestId,
                )
                  ? payload.readinessRequestId
                  : null,
                requestId: Number.isSafeInteger(payload.requestId)
                  ? payload.requestId
                  : null,
                documentId:
                  typeof payload.documentId === "string"
                    ? payload.documentId
                    : null,
              },
            },
            "*",
          );
        }
        if (
          typeof type === "string" &&
          (type === "agent-native:editor-chrome-ready" ||
            type === "agent-native:runtime-layer-snapshot" ||
            type === "agent-native:runtime-layer-snapshot-error" ||
            type === "agent-native:runtime-layer-snapshot-unchanged")
        ) {
          const payload = event.data.payload;
          const frame = Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-screen-iframe-id]",
            ),
          ).find((candidate) => candidate.contentWindow === event.source);
          win.__exportMessages?.push({
            type,
            screenId: frame?.dataset.screenIframeId ?? null,
            documentId: String(
              event.data.documentId ?? payload?.documentId ?? "",
            ),
            readinessRequestId: Number.isSafeInteger(
              payload?.readinessRequestId,
            )
              ? payload.readinessRequestId
              : null,
            reason: typeof payload?.reason === "string" ? payload.reason : null,
          });
        }
        if (
          type === "agent-native:editor-chrome-ready" &&
          typeof event.data.documentId === "string"
        ) {
          win.__exportReadyDocumentId = event.data.documentId;
        }
        if (event.data?.type === "agent-native:runtime-layer-snapshot") {
          const payload = event.data.payload;
          if (typeof payload?.html !== "string") return;
          win.__exportSnapshots?.push({
            documentId: String(payload.documentId ?? ""),
            html: payload.html,
            readinessRequestId: Number.isSafeInteger(payload.readinessRequestId)
              ? payload.readinessRequestId
              : null,
          });
        }
      });
    });
    const cdpSession = await browserContext.newCDPSession(exportPage);
    cdp = cdpSession;
    await cdpSession.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });
    await exportPage.goto(
      `${baseURL}/visual-edit/${designId}?editorView=overview`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await expect(exportPage.locator("[data-design-editor]")).toBeVisible({
      timeout: 45_000,
    });
    const allowLocalAccess = exportPage.getByRole("button", {
      name: "Allow local access",
    });
    if (await allowLocalAccess.isVisible().catch(() => false)) {
      await allowLocalAccess.click();
    }

    const frames = exportPage.locator(
      'iframe[data-design-preview-iframe][data-design-source-type="localhost"]',
    );
    await expect(frames).toHaveCount(1, { timeout: 30_000 });
    const iframe = frames.first();
    const frame = iframe.contentFrame();
    await expect
      .poll(() => frame.locator("html").getAttribute("data-export-font-ready"))
      .toBe("true");

    sourcePage = await browserContext.newPage();
    await sourcePage.setViewportSize({ width: 360, height: 240 });
    await sourcePage.goto(targetUrl);
    await expect
      .poll(() =>
        sourcePage!.locator("html").getAttribute("data-export-font-ready"),
      )
      .toBe("true");
    await sourcePage.waitForLoadState("networkidle");
    await sourcePage.evaluate(async () => {
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    const liveSource = await sourcePage.locator("html").screenshot({
      animations: "disabled",
      omitBackground: true,
    });
    try {
      await exportPage.waitForFunction(
        () => {
          const win = window as Window & {
            __exportReadyDocumentId?: string;
            __exportSnapshots?: Array<{
              documentId: string;
              readinessRequestId: number | null;
            }>;
          };
          return Boolean(
            win.__exportReadyDocumentId &&
            win.__exportSnapshots?.some(
              (snapshot) => snapshot.documentId === win.__exportReadyDocumentId,
            ),
          );
        },
        undefined,
        { timeout: 15_000 },
      );
    } catch (error) {
      const messages = await exportPage.evaluate(() => {
        const win = window as Window & {
          __exportMessages?: Array<Record<string, unknown>>;
          __exportReadyDocumentId?: string;
        };
        return {
          readyDocumentId: win.__exportReadyDocumentId ?? null,
          messages: win.__exportMessages ?? [],
        };
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; readiness=${JSON.stringify(messages)}; browser errors=${browserErrors.join(" | ")}`,
      );
    }
    const snapshotHtml = await exportPage.evaluate(() => {
      const win = window as Window & {
        __exportReadyDocumentId?: string;
        __exportSnapshots?: Array<{
          documentId: string;
          html: string;
          readinessRequestId: number | null;
        }>;
      };
      return (
        win.__exportSnapshots
          ?.slice()
          .reverse()
          .find(
            (snapshot) => snapshot.documentId === win.__exportReadyDocumentId,
          )?.html ?? ""
      );
    });
    expect(snapshotHtml.includes("Parity Inter")).toBe(true);
    expect(snapshotHtml.includes("@font-face")).toBe(true);
    expect(snapshotHtml).toContain("data:font/");
    expect(snapshotHtml).toContain("data:image/svg+xml");
    expect(snapshotHtml).not.toContain("/inter.woff2");
    expect(snapshotHtml).not.toContain("/parity-image.svg");
    expect(snapshotHtml).not.toContain("/pattern.svg");

    serverRenderPage = await browserContext.newPage();
    await serverRenderPage.setViewportSize({ width: 360, height: 240 });
    await serverRenderPage.setContent(snapshotHtml, { waitUntil: "load" });
    await serverRenderPage.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    const serverScreenshot = await serverRenderPage
      .locator("html")
      .screenshot({ animations: "disabled", omitBackground: true });
    const snapshotLayout = await serverRenderPage.evaluate(() => ({
      fonts: {
        status: document.fonts.status,
        failed: Array.from(document.fonts).filter(
          (font) => font.status === "error",
        ).length,
      },
      brokenImages: Array.from(document.images).filter(
        (image) => image.naturalWidth === 0,
      ).length,
    }));
    expect(snapshotLayout).toEqual({
      fonts: { status: "loaded", failed: 0 },
      brokenImages: 0,
    });
    fs.mkdirSync(artifactPath, { recursive: true });
    fs.writeFileSync(
      path.join(artifactPath, "runtime-snapshot.html"),
      snapshotHtml,
    );

    const serializedSnapshot = await sourcePage.evaluate(async (html) => {
      const frame = document.createElement("iframe");
      frame.id = "snapshot-diagnostic";
      frame.style.cssText =
        "position:fixed;left:0;top:0;width:360px;height:240px;border:0";
      document.body.append(frame);
      await new Promise<void>((resolve, reject) => {
        frame.addEventListener("load", () => resolve(), { once: true });
        frame.addEventListener(
          "error",
          () => reject(new Error("snapshot iframe failed")),
          { once: true },
        );
        frame.srcdoc = html;
      });
      const doc = frame.contentDocument!;
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images, (image) => image.decode()));
      return true;
    }, snapshotHtml);
    expect(serializedSnapshot).toBe(true);
    const serializedSnapshotPng = await sourcePage
      .locator("#snapshot-diagnostic")
      .screenshot({ animations: "disabled", omitBackground: true });
    await sourcePage
      .locator("#snapshot-diagnostic")
      .evaluate((frame) => frame.remove());

    const exportedPng = await downloadPng(exportPage);
    const exportedPdf = await downloadAllScreensPdf(exportPage);
    const readinessSnapshots = await exportPage.evaluate(() => {
      const win = window as Window & {
        __exportSnapshots?: Array<{ readinessRequestId: number | null }>;
      };
      return win.__exportSnapshots?.filter(
        (snapshot) => snapshot.readinessRequestId !== null,
      ).length;
    });
    expect(readinessSnapshots).toBeGreaterThan(0);
    const expected = Buffer.from(liveSource);
    const pdfPagePngs = await pdfPagesPng(exportedPdf, 720);

    fs.mkdirSync(artifactPath, { recursive: true });
    fs.writeFileSync(path.join(artifactPath, "live-source.png"), expected);
    fs.writeFileSync(
      path.join(artifactPath, "serialized-snapshot.png"),
      serializedSnapshotPng,
    );
    fs.writeFileSync(
      path.join(artifactPath, "self-contained-server-screenshot.png"),
      serverScreenshot,
    );
    fs.writeFileSync(path.join(artifactPath, "downloaded.png"), exportedPng);
    fs.writeFileSync(path.join(artifactPath, "downloaded.pdf"), exportedPdf);
    pdfPagePngs.forEach((png, index) => {
      fs.writeFileSync(
        path.join(artifactPath, `pdf-page-${index + 1}.png`),
        png,
      );
    });

    const pngDiff = await comparePngs(browser, expected, exportedPng, {
      threshold: 0,
    });
    const snapshotDiff = await comparePngs(
      browser,
      expected,
      serializedSnapshotPng,
      { threshold: 0 },
    );
    const serverScreenshotDiff = await comparePngs(
      browser,
      expected,
      serverScreenshot,
      { threshold: 0 },
    );
    const pdfDiffs = await Promise.all(
      pdfPagePngs.map((png) =>
        comparePngs(browser, expected, png, { threshold: 0 }),
      ),
    );
    fs.writeFileSync(path.join(artifactPath, "png-diff.png"), pngDiff.diffPng);
    fs.writeFileSync(
      path.join(artifactPath, "snapshot-diff.png"),
      snapshotDiff.diffPng,
    );
    fs.writeFileSync(
      path.join(artifactPath, "server-screenshot-diff.png"),
      serverScreenshotDiff.diffPng,
    );
    pdfDiffs.forEach((diff, index) => {
      fs.writeFileSync(
        path.join(artifactPath, `pdf-page-${index + 1}-diff.png`),
        diff.diffPng,
      );
    });
    console.info(
      `[export-fidelity] png=${JSON.stringify({ diffRatio: pngDiff.diffRatio, diffPixels: pngDiff.diffPixels, maxDelta: pngDiff.maxDelta })} snapshot=${JSON.stringify({ diffRatio: snapshotDiff.diffRatio, diffPixels: snapshotDiff.diffPixels, maxDelta: snapshotDiff.maxDelta })} serverScreenshot=${JSON.stringify({ diffRatio: serverScreenshotDiff.diffRatio, diffPixels: serverScreenshotDiff.diffPixels, maxDelta: serverScreenshotDiff.maxDelta })} pdfPages=${JSON.stringify(pdfDiffs.map(({ diffRatio, diffPixels, maxDelta }) => ({ diffRatio, diffPixels, maxDelta })))}`,
    );
    expect(pngDiff.dimensionMismatch).toBe(false);
    expect(snapshotDiff.dimensionMismatch).toBe(false);
    expect(snapshotDiff.diffRatio).toBe(0);
    expect(serverScreenshotDiff.dimensionMismatch).toBe(false);
    expect(serverScreenshotDiff.diffRatio).toBe(0);
    expect(pngDiff.diffRatio).toBe(0);
    for (const pdfDiff of pdfDiffs) {
      expect(pdfDiff.dimensionMismatch).toBe(false);
      expect(pdfDiff.diffRatio).toBe(0);
    }
  } finally {
    await sourcePage?.close().catch(() => undefined);
    await serverRenderPage?.close().catch(() => undefined);
    if (cdp) await cdp.detach().catch(() => undefined);
    await browserContext?.close().catch(() => undefined);
    await bridge?.server.close();
    if (vite && vite.exitCode === null) {
      vite.kill();
      await new Promise<void>((resolve) => vite?.once("exit", () => resolve()));
    }
    if (designId) {
      await postAction(request, baseURL, "delete-design", {
        id: designId,
      }).catch(() => undefined);
    }
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
