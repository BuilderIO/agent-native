import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { PDFParse } from "pdf-parse";

import { comparePngs } from "../scripts/figma-fidelity/lib/compare";

interface CorpusEntry {
  name: string;
  title: string;
  width: number;
  height: number;
  sourcePath: string;
}

interface LocalImportedCorpusEntry {
  name: string;
  title: string;
  filename: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CORPUS_DIR = path.join(REPO_ROOT, ".tmp/figma-fidelity/ui-imports");
const CORPUS_MANIFEST = path.join(CORPUS_DIR, "manifest.json");
const ARTIFACT_DIR = path.join(
  REPO_ROOT,
  "templates/design/.tmp/design-export-parity/imported-html",
);
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  "event-story": { width: 1080, height: 1920 },
  "community-case-study-cover": { width: 1920, height: 1080 },
  "community-case-study-introduction": { width: 1920, height: 1080 },
  "community-case-study-principles": { width: 1920, height: 1080 },
  "wrenfield-type-specimen": { width: 1440, height: 1000 },
};
const STATIC_FIGMA_FIXTURES: CorpusEntry[] = [
  {
    name: "effects-transforms",
    title: "Effects and transforms",
    width: 1000,
    height: 1010,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/effects-transforms/screen.html",
    ),
  },
  {
    name: "image-scale-modes",
    title: "Image scale modes",
    width: 900,
    height: 640,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/image-scale-modes/screen.html",
    ),
  },
  {
    name: "layout-stress",
    title: "Layout stress",
    width: 1440,
    height: 900,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/layout-stress/screen.html",
    ),
  },
  {
    name: "media-cards",
    title: "Media cards",
    width: 1200,
    height: 800,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/media-cards/screen.html",
    ),
  },
  {
    name: "mobile-icons",
    title: "Mobile icons",
    width: 390,
    height: 844,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/mobile-icons/screen.html",
    ),
  },
  {
    name: "typography",
    title: "Typography",
    width: 900,
    height: 1200,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/typography/screen.html",
    ),
  },
  {
    name: "whole-screen-padded-body",
    title: "Whole screen with padded body",
    width: 600,
    height: 400,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/figma-fidelity/corpus/whole-screen-padded-body/screen.html",
    ),
  },
];

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("source server did not expose a port");
  }
  return address.port;
}

async function freePort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function closeServer(server: http.Server | null | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
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
    throw new Error(`${name} failed with status ${response.status()}`);
  }
  return response.json();
}

async function downloadPng(page: Page): Promise<Buffer> {
  const pngMenuItem = await openPngExport(page);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    pngMenuItem.click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("PNG download returned no bytes");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function downloadAllScreensPdf(page: Page): Promise<Buffer> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  await expect(exportMenu).toBeVisible();
  await exportMenu.hover();
  const pdfMenuItem = page.getByRole("menuitem", {
    name: "Download PDF (all screens)",
  });
  await expect(pdfMenuItem).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    pdfMenuItem.click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("all-screens PDF download returned no bytes");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function pdfPagesPng(
  pdf: Buffer,
  desiredWidth: number,
): Promise<Buffer[]> {
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

async function openPngExport(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  await expect(exportMenu).toBeVisible();
  await exportMenu.press("ArrowRight");
  const pngMenuItem = page.getByRole("menuitem", { name: "Download PNG" });
  await expect(pngMenuItem).toBeVisible();
  await expect(pngMenuItem).toBeEnabled();
  return pngMenuItem;
}

function safeError(error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return {
    name,
    message: message
      .replace(/https?:\/\/[^\s)"'<>]+/gi, "[URL]")
      .replace(
        /\b(api[_-]?key|token|secret|signature)=([^&\s]+)/gi,
        "$1=[redacted]",
      )
      .slice(0, 300),
  };
}

async function waitForLivePixels(html: Locator) {
  return await html.evaluate(async (element) => {
    const doc = element.ownerDocument;
    let fontTimeout: number | undefined;
    const fontReady = await Promise.race([
      doc.fonts.ready.then(() => true),
      new Promise<boolean>((resolve) => {
        fontTimeout = doc.defaultView!.setTimeout(() => resolve(false), 5_000);
      }),
    ]);
    if (fontTimeout !== undefined) {
      doc.defaultView?.clearTimeout(fontTimeout);
    }
    await Promise.all(
      Array.from(doc.images, async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
            setTimeout(() => resolve(), 10_000);
          });
        }
        if (image.naturalWidth > 0) await image.decode().catch(() => undefined);
      }),
    );

    const hasAsyncStyles = doc.querySelector(
      'link[rel~="stylesheet"],script[src],style[type="text/tailwindcss"]',
    );
    const startedAt = performance.now();
    const deadline = startedAt + 15_000;
    let previousRuleCount = -1;
    let stableFrames = 0;
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      let ruleCount = 0;
      for (const sheet of Array.from(doc.styleSheets)) {
        try {
          ruleCount += sheet.cssRules.length;
        } catch {
          ruleCount += 1;
        }
      }
      stableFrames = ruleCount === previousRuleCount ? stableFrames + 1 : 0;
      previousRuleCount = ruleCount;
      if (
        stableFrames >= 8 &&
        (!hasAsyncStyles || performance.now() - startedAt >= 1200)
      ) {
        break;
      }
    }
    if (performance.now() >= deadline) {
      throw new Error("source stylesheets did not settle");
    }
    return {
      width: Math.max(
        doc.documentElement.scrollWidth,
        doc.body?.scrollWidth ?? 0,
      ),
      height: Math.max(
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight ?? 0,
      ),
      fontErrors: Array.from(doc.fonts).filter(
        (font) => font.status === "error",
      ).length,
      loadingFonts: fontReady
        ? 0
        : Array.from(doc.fonts).filter((font) => font.status === "loading")
            .length,
      imageErrors: Array.from(doc.images).filter(
        (image) => image.complete && image.naturalWidth === 0,
      ).length,
    };
  });
}

test("imported and static Figma designs export pixel-identically through DesignEditor PNG download", async ({
  page: basePage,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("test baseURL is unavailable");
  const importedEntries = fs.existsSync(CORPUS_MANIFEST)
    ? (JSON.parse(
        fs.readFileSync(CORPUS_MANIFEST, "utf8"),
      ) as LocalImportedCorpusEntry[])
    : [];
  if (importedEntries.length > 0) {
    if (
      importedEntries.length !== Object.keys(VIEWPORTS).length ||
      importedEntries.some((entry) => !VIEWPORTS[entry.name])
    ) {
      throw new Error(
        "local imported HTML manifest does not match the five-case corpus",
      );
    }
  }
  const importedSources = importedEntries.map((entry) => {
    if (path.basename(entry.filename) !== entry.filename) {
      throw new Error("corpus manifest has an invalid source filename");
    }
    const candidates = [entry.filename, `${entry.name}.html`];
    const filename = candidates.find((candidate) =>
      fs.existsSync(path.join(CORPUS_DIR, candidate)),
    );
    if (!filename) throw new Error("local imported HTML corpus is incomplete");
    const viewport = VIEWPORTS[entry.name]!;
    return {
      ...entry,
      ...viewport,
      sourcePath: path.join(CORPUS_DIR, filename),
    };
  });
  const entries = [...importedSources, ...STATIC_FIGMA_FIXTURES];
  const caseFilter = process.env.DESIGN_EXPORT_CORPUS_CASE;
  const selectedEntries = caseFilter
    ? entries.filter((entry) => entry.name === caseFilter)
    : entries;
  if (selectedEntries.length === 0) {
    throw new Error("requested imported HTML corpus case is unavailable");
  }

  const sources = entries.map((entry) => ({ entry, filename: entry.name }));
  fs.mkdirSync(path.join(REPO_ROOT, "templates/design/.tmp"), {
    recursive: true,
  });
  const siteRoot = fs.mkdtempSync(
    path.join(REPO_ROOT, "templates/design/.tmp/design-export-corpus-site-"),
  );
  const sourcesByPath = new Map<string, string>();
  try {
    for (const { entry, filename } of sources) {
      const copiedName = `${entry.name}.html`;
      fs.copyFileSync(entry.sourcePath, path.join(siteRoot, copiedName));
      sourcesByPath.set(`/${entry.name}`, copiedName);
      sourcesByPath.set(`/${copiedName}`, copiedName);
      if (entry.name === "effects-transforms") {
        sourcesByPath.set(`/${entry.name}-pdf-second`, copiedName);
      }
    }
  } catch (error) {
    fs.rmSync(siteRoot, { recursive: true, force: true });
    throw error;
  }
  const sourceServer = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const filename = sourcesByPath.get(pathname);
    if (!filename) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(siteRoot, filename)).pipe(res);
  });

  let browserContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;
  let snapshotContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;
  let sourcePage: Page | null = null;
  let snapshotPage: Page | null = null;
  let bridge: DesignConnectBridge | null = null;
  let connection: {
    connectionId: string;
    bridgeToken: string;
    previewToken: string;
  } | null = null;
  const designIds: string[] = [];
  const outcomes: Array<Record<string, unknown>> = [];
  let cdp: { detach: () => Promise<void> } | null = null;
  let sourceServerStarted = false;

  try {
    const sourcePort = await listen(sourceServer);
    sourceServerStarted = true;
    const sourceUrl = `http://127.0.0.1:${sourcePort}`; // e2e-harness-ignore: ephemeral source server uses its own port.
    const bridgePort = await freePort();
    const bridgeManifest = await prepareDesignConnectManifest({
      root: siteRoot,
      url: sourceUrl,
      port: bridgePort,
    });
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    browserContext = await browser.newContext({
      storageState: await basePage.context().storageState(),
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const exportPage = await browserContext.newPage();
    let activeDiagnostics: string[] | null = null;
    let activeRenderSnapshotHtml: string | null = null;
    exportPage.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/_agent-native/ui-capability")) {
        activeDiagnostics?.push("UI capability request started");
      } else if (
        pathname.endsWith("/_agent-native/actions/render-export-png")
      ) {
        try {
          const body = JSON.parse(request.postData() ?? "{}") as {
            html?: unknown;
          };
          if (typeof body.html === "string") {
            activeRenderSnapshotHtml = body.html;
            activeDiagnostics?.push(
              `render request started (${new TextEncoder().encode(body.html).byteLength} bytes)`,
            );
            return;
          }
        } catch {
          // The safe diagnostic below records the request without its body.
        }
        activeDiagnostics?.push("render request started without snapshot HTML");
      } else if (pathname.includes("/_agent-native/actions/")) {
        const pathSegments = pathname.split("/").filter(Boolean);
        activeDiagnostics?.push(
          `action request ${request.method()} ${pathSegments[pathSegments.length - 1] ?? "unknown"}`,
        );
      }
    });
    exportPage.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.endsWith("/_agent-native/ui-capability")) {
        activeDiagnostics?.push(`UI capability response ${response.status()}`);
      } else if (
        pathname.endsWith("/_agent-native/actions/render-export-png")
      ) {
        activeDiagnostics?.push(
          `render response ${response.status()} ${response.headers()["content-type"] ?? "unknown"}`,
        );
      }
    });
    exportPage.on("requestfailed", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.endsWith("/_agent-native/ui-capability") ||
        pathname.endsWith("/_agent-native/actions/render-export-png")
      ) {
        activeDiagnostics?.push(
          `request failed ${request.failure()?.errorText ?? "unknown"}`,
        );
      }
    });
    exportPage.on("pageerror", (error) => {
      activeDiagnostics?.push(`page error: ${safeError(error).message}`);
    });
    exportPage.on("console", (message) => {
      if (message.type() === "error") {
        activeDiagnostics?.push(
          `console error: ${safeError(message.text()).message}`,
        );
      }
    });
    await exportPage.addInitScript(() => {
      const toasts: string[] = [];
      (window as Window & { __exportToasts?: string[] }).__exportToasts =
        toasts;
      const toastObserver = new MutationObserver(() => {
        document.querySelectorAll("[data-sonner-toast]").forEach((toast) => {
          const message = (toast.textContent || "")
            .replace(/https?:\/\/[^\s)"'<>]+/gi, "[URL]")
            .replace(
              /\b(api[_-]?key|token|secret|signature)=([^&\s]+)/gi,
              "$1=[redacted]",
            )
            .trim()
            .slice(0, 180);
          if (message && !toasts.includes(message)) toasts.push(message);
        });
      });
      toastObserver.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    const cdpSession = await browserContext.newCDPSession(exportPage);
    cdp = cdpSession;
    await cdpSession.send("Browser.grantPermissions", {
      origin: new URL(baseURL).origin,
      permissions: ["localNetworkAccess"],
    });

    sourcePage = await browserContext.newPage();
    snapshotContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    snapshotPage = await snapshotContext.newPage();
    const blockedSnapshotRequests: string[] = [];
    await snapshotPage.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url === "about:blank") {
        await route.continue();
        return;
      }
      blockedSnapshotRequests.push(url);
      await route.abort("blockedbyclient");
    });
    const caseFailures: string[] = [];
    for (const entry of selectedEntries) {
      const diagnostics: string[] = [];
      let snapshotResourceFailures: string[] = [];
      activeDiagnostics = diagnostics;
      const stage = { name: "setup" };
      let designId: string | null = null;
      try {
        const viewport = { width: entry.width, height: entry.height };
        const opened = (await postAction(request, baseURL, "open-visual-edit", {
          title: `Imported HTML export parity ${entry.name}`,
          devServerUrl: sourceUrl,
          bridgeUrl: bridgeManifest.bridgeUrl,
          rootPath: siteRoot,
          routeManifest: bridgeManifest,
          ...(connection ?? {}),
          routes: [
            {
              path: `/${entry.name}`,
              url: `${sourceUrl}/${entry.name}`,
              title: entry.title,
              sourceKind: "html",
              width: viewport.width,
              height: viewport.height,
            },
            ...(entry.name === "effects-transforms"
              ? [
                  {
                    path: `/${entry.name}-pdf-second`,
                    url: `${sourceUrl}/${entry.name}-pdf-second`,
                    title: `${entry.title} PDF copy`,
                    sourceKind: "html",
                    width: viewport.width,
                    height: viewport.height,
                  },
                ]
              : []),
          ],
          navigate: false,
          publicReadOnly: false,
        })) as {
          designId: string;
          connectionId: string;
          bridgeToken: string;
          previewToken: string;
        };
        designId = opened.designId;
        designIds.push(designId);
        connection ??= {
          connectionId: opened.connectionId,
          bridgeToken: opened.bridgeToken,
          previewToken: opened.previewToken,
        };
        bridge ??= await startDesignConnectBridge(bridgeManifest, {
          bridgeToken: opened.bridgeToken,
          previewToken: opened.previewToken,
          allowedOrigins: [new URL(baseURL).origin],
        });

        stage.name = "editor";
        await exportPage.goto(
          `${baseURL}/visual-edit/${designId}?editorView=overview`,
          { waitUntil: "domcontentloaded" },
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
        const preview = exportPage.locator(
          'iframe[data-design-preview-iframe][data-design-source-type="localhost"]',
        );
        await expect(preview).toHaveCount(1, { timeout: 30_000 });
        const previewFrame = preview.first().contentFrame();
        await expect
          .poll(() =>
            previewFrame.locator("[data-agent-native-node-id]").count(),
          )
          .toBeGreaterThan(0);
        const previewHtml = previewFrame.locator("html");
        const previewReadiness = await waitForLivePixels(previewHtml);
        stage.name = "source screenshot";
        await sourcePage.setViewportSize(viewport);
        await sourcePage.goto(`${sourceUrl}/${entry.name}`, {
          waitUntil: "domcontentloaded",
        });
        const referenceReadiness = await waitForLivePixels(
          sourcePage.locator("html"),
        );
        const referencePng = await sourcePage.screenshot({
          fullPage: true,
          animations: "disabled",
          omitBackground: true,
          timeout: 30_000,
        });
        const unsupportedMediaCount = await previewFrame
          .locator("video, audio[controls]")
          .count();
        if (unsupportedMediaCount > 0) {
          stage.name = "visible export rejection";
          const toastCount = await exportPage
            .locator("[data-sonner-toast]")
            .count();
          let downloadStarted = false;
          const onDownload = () => {
            downloadStarted = true;
          };
          exportPage.on("download", onDownload);
          try {
            const pngMenuItem = await openPngExport(exportPage);
            await pngMenuItem.click();
            await expect
              .poll(() => exportPage.locator("[data-sonner-toast]").count())
              .toBeGreaterThan(toastCount);
            expect(downloadStarted).toBe(false);
          } finally {
            exportPage.off("download", onDownload);
          }
          outcomes.push({
            name: entry.name,
            unsupported: ["visual-media"],
            unsupportedMediaCount,
            visiblyRejected: true,
            downloadStarted,
          });
          stage.name = "design cleanup";
          await postAction(request, baseURL, "delete-design", { id: designId });
          designIds.splice(designIds.indexOf(designId), 1);
          activeDiagnostics = null;
          continue;
        }

        stage.name = "PNG download";
        activeRenderSnapshotHtml = null;
        const exportedPng = await downloadPng(exportPage);
        const exportSnapshotHtml = activeRenderSnapshotHtml;
        if (!exportSnapshotHtml) {
          throw new Error("PNG renderer request did not include snapshot HTML");
        }
        snapshotResourceFailures =
          /data-agent-native-export-resource-failures=["']([^"']+)["']/i
            .exec(exportSnapshotHtml)?.[1]
            .split(",") ?? [];

        stage.name = "export snapshot screenshot";
        blockedSnapshotRequests.length = 0;
        await snapshotPage.setViewportSize(viewport);
        await snapshotPage.setContent(exportSnapshotHtml, {
          waitUntil: "load",
        });
        const snapshotReadiness = await snapshotPage.evaluate(async () => {
          await Promise.race([
            document.fonts.ready,
            new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
          ]);
          await Promise.all(
            Array.from(document.images, (image) =>
              image.decode().catch(() => undefined),
            ),
          );
          return {
            fontErrors: Array.from(document.fonts).filter(
              (font) => font.status === "error",
            ).length,
            loadingFonts: Array.from(document.fonts).filter(
              (font) => font.status === "loading",
            ).length,
            imageErrors: Array.from(document.images).filter(
              (image) => image.naturalWidth === 0,
            ).length,
          };
        });
        if (blockedSnapshotRequests.length > 0) {
          throw new Error("export snapshot requested an external resource");
        }
        const snapshotPng = await snapshotPage.screenshot({
          fullPage: true,
          animations: "disabled",
          timeout: 30_000,
        });
        const snapshotDiff = await comparePngs(
          browser,
          referencePng,
          snapshotPng,
          { threshold: 0 },
        );
        fs.writeFileSync(
          path.join(ARTIFACT_DIR, `${entry.name}-snapshot.png`),
          snapshotPng,
        );
        fs.writeFileSync(
          path.join(ARTIFACT_DIR, `${entry.name}-snapshot-diff.png`),
          snapshotDiff.diffPng,
        );
        console.info(
          `[imported-html-export-fidelity] ${entry.name} snapshot diffPixels=${snapshotDiff.diffPixels} diffRatio=${snapshotDiff.diffRatio}`,
        );

        const diff = await comparePngs(browser, referencePng, exportedPng, {
          threshold: 0,
        });
        let pdfPageComparisons:
          | Array<{
              page: number;
              reference: { width: number; height: number };
              candidate: { width: number; height: number };
              dimensionMismatch: boolean;
              diffPixels: number;
              comparedPixels: number;
              diffRatio: number;
              maxDelta: number;
              meanDelta: number;
            }>
          | undefined;
        if (entry.name === "effects-transforms") {
          stage.name = "all-screens PDF fidelity";
          const exportedPdf = await downloadAllScreensPdf(exportPage);
          fs.writeFileSync(
            path.join(ARTIFACT_DIR, `${entry.name}-all-screens.pdf`),
            exportedPdf,
          );
          const pdfPngs = await pdfPagesPng(exportedPdf, diff.reference.width);
          pdfPageComparisons = [];
          for (const [index, pdfPng] of pdfPngs.entries()) {
            const pageDiff = await comparePngs(browser, referencePng, pdfPng, {
              threshold: 0,
            });
            fs.writeFileSync(
              path.join(
                ARTIFACT_DIR,
                `${entry.name}-pdf-page-${index + 1}.png`,
              ),
              pdfPng,
            );
            fs.writeFileSync(
              path.join(
                ARTIFACT_DIR,
                `${entry.name}-pdf-page-${index + 1}-diff.png`,
              ),
              pageDiff.diffPng,
            );
            pdfPageComparisons.push({
              page: index + 1,
              reference: pageDiff.reference,
              candidate: pageDiff.candidate,
              dimensionMismatch: pageDiff.dimensionMismatch,
              diffPixels: pageDiff.diffPixels,
              comparedPixels: pageDiff.comparedPixels,
              diffRatio: pageDiff.diffRatio,
              maxDelta: pageDiff.maxDelta,
              meanDelta: pageDiff.meanDelta,
            });
            console.info(
              `[imported-html-export-fidelity] ${entry.name} PDF page ${index + 1} diffPixels=${pageDiff.diffPixels} diffRatio=${pageDiff.diffRatio}`,
            );
          }
        }
        const result = {
          name: entry.name,
          reference: diff.reference,
          exported: diff.candidate,
          dimensionMismatch: diff.dimensionMismatch,
          diffPixels: diff.diffPixels,
          diffRatio: diff.diffRatio,
          snapshotDiffPixels: snapshotDiff.diffPixels,
          snapshotDiffRatio: snapshotDiff.diffRatio,
          snapshotDimensionMismatch: snapshotDiff.dimensionMismatch,
          maxDelta: diff.maxDelta,
          meanDelta: diff.meanDelta,
          worstCells: diff.worstCells,
          ...(pdfPageComparisons
            ? {
                pdfPageCount: pdfPageComparisons.length,
                pdfPages: pdfPageComparisons,
              }
            : {}),
          previewFontErrors: previewReadiness.fontErrors,
          previewLoadingFonts: previewReadiness.loadingFonts,
          previewImageErrors: previewReadiness.imageErrors,
          referenceFontErrors: referenceReadiness.fontErrors,
          referenceLoadingFonts: referenceReadiness.loadingFonts,
          referenceImageErrors: referenceReadiness.imageErrors,
          snapshotFontErrors: snapshotReadiness.fontErrors,
          snapshotLoadingFonts: snapshotReadiness.loadingFonts,
          snapshotImageErrors: snapshotReadiness.imageErrors,
          snapshotResourceFailures,
          previewReadiness,
          sourceDocument: {
            width: referenceReadiness.width,
            height: referenceReadiness.height,
          },
        };
        outcomes.push(result);
        fs.writeFileSync(
          path.join(ARTIFACT_DIR, `${entry.name}-reference.png`),
          referencePng,
        );
        fs.writeFileSync(
          path.join(ARTIFACT_DIR, `${entry.name}-export.png`),
          exportedPng,
        );
        fs.writeFileSync(
          path.join(ARTIFACT_DIR, `${entry.name}-diff.png`),
          diff.diffPng,
        );
        stage.name = "design cleanup";
        await postAction(request, baseURL, "delete-design", { id: designId });
        designIds.splice(designIds.indexOf(designId), 1);
        activeDiagnostics = null;
      } catch (error) {
        const safe = safeError(error);
        caseFailures.push(`${entry.name}: ${stage.name} failed`);
        const toast = await exportPage
          .locator("[data-sonner-toast]")
          .allInnerTexts()
          .catch(() => [] as string[]);
        const toastHistory = await exportPage
          .evaluate(
            () =>
              (window as Window & { __exportToasts?: string[] })
                .__exportToasts ?? [],
          )
          .catch(() => [] as string[]);
        outcomes.push({
          name: entry.name,
          error: stage.name,
          exception: safe,
          toast: toast
            .join(" ")
            .replace(/https?:\/\/[^\s)"'<>]+/gi, "[URL]")
            .replace(
              /\b(api[_-]?key|token|secret|signature)=([^&\s]+)/gi,
              "$1=[redacted]",
            )
            .slice(0, 300),
          toastHistory,
          snapshotResourceFailures,
          diagnostics,
        });
        if (designId) {
          try {
            await postAction(request, baseURL, "delete-design", {
              id: designId,
            });
            const designIndex = designIds.indexOf(designId);
            if (designIndex >= 0) designIds.splice(designIndex, 1);
          } catch {
            // Keep the id for the final cleanup attempt.
          }
        }
        activeDiagnostics = null;
      }
    }

    fs.writeFileSync(
      path.join(
        ARTIFACT_DIR,
        caseFilter ? `${caseFilter}-metrics.json` : "metrics.json",
      ),
      `${JSON.stringify(outcomes, null, 2)}\n`,
    );
    console.info(
      `[imported-html-export-fidelity] ${JSON.stringify(
        outcomes.map((outcome) => ({
          name: outcome.name,
          diffPixels: outcome.diffPixels,
          diffRatio: outcome.diffRatio,
          snapshotDiffPixels: outcome.snapshotDiffPixels,
          snapshotDiffRatio: outcome.snapshotDiffRatio,
          error: outcome.error,
        })),
      )}`,
    );
    expect(caseFailures, "case-level browser/download failures").toEqual([]);
    const comparedOutcomes = outcomes.filter(
      (outcome) => typeof outcome.diffRatio === "number",
    );
    const minimumComparedOutcomes = caseFilter
      ? Number(STATIC_FIGMA_FIXTURES.some((entry) => entry.name === caseFilter))
      : STATIC_FIGMA_FIXTURES.length;
    expect(
      comparedOutcomes.length,
      "the run must compare its checked-in static fixtures against live pixels",
    ).toBeGreaterThanOrEqual(minimumComparedOutcomes);
    const fidelityFailures = outcomes
      .filter(
        (outcome) =>
          !outcome.unsupported &&
          (outcome.dimensionMismatch ||
            outcome.diffRatio !== 0 ||
            outcome.snapshotDimensionMismatch ||
            outcome.snapshotDiffPixels !== 0 ||
            outcome.previewFontErrors !== 0 ||
            outcome.previewLoadingFonts !== 0 ||
            outcome.previewImageErrors !== 0 ||
            outcome.referenceFontErrors !== 0 ||
            outcome.referenceLoadingFonts !== 0 ||
            outcome.referenceImageErrors !== 0 ||
            outcome.snapshotFontErrors !== 0 ||
            outcome.snapshotLoadingFonts !== 0 ||
            outcome.snapshotImageErrors !== 0 ||
            (Array.isArray(outcome.pdfPages) &&
              (outcome.pdfPageCount !== 2 ||
                outcome.pdfPages.some(
                  (page) =>
                    page.dimensionMismatch !== false || page.diffRatio !== 0,
                ))) ||
            (Array.isArray(outcome.snapshotResourceFailures) &&
              outcome.snapshotResourceFailures.length !== 0) ||
            outcome.error),
      )
      .map((outcome) => ({
        name: outcome.name,
        diffRatio: outcome.diffRatio,
        snapshotDiffRatio: outcome.snapshotDiffRatio,
        snapshotDimensionMismatch: outcome.snapshotDimensionMismatch,
        referenceFontErrors: outcome.referenceFontErrors,
        referenceImageErrors: outcome.referenceImageErrors,
        snapshotFontErrors: outcome.snapshotFontErrors,
        snapshotLoadingFonts: outcome.snapshotLoadingFonts,
        snapshotImageErrors: outcome.snapshotImageErrors,
        snapshotResourceFailures: outcome.snapshotResourceFailures,
        pdfPageCount: outcome.pdfPageCount,
        pdfPages: outcome.pdfPages,
        error: outcome.error,
      }));
    expect(
      fidelityFailures,
      "every rendered export must match the browser-rendered source at threshold 0",
    ).toEqual([]);
    expect(
      outcomes
        .filter((outcome) => outcome.unsupported)
        .every(
          (outcome) =>
            outcome.visiblyRejected === true &&
            outcome.downloadStarted === false,
        ),
      "unsupported visual media must fail visibly without downloading an image",
    ).toBe(true);
  } finally {
    for (const designId of designIds) {
      await postAction(request, baseURL, "delete-design", {
        id: designId,
      }).catch(() => undefined);
    }
    await snapshotContext?.close().catch(() => undefined);
    await sourcePage?.close().catch(() => undefined);
    if (cdp) await cdp.detach().catch(() => undefined);
    await browserContext?.close().catch(() => undefined);
    await closeServer(bridge?.server);
    if (sourceServerStarted) await closeServer(sourceServer);
    fs.rmSync(siteRoot, { recursive: true, force: true });
  }
});
