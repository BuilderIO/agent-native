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
  type Browser,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { imageSize } from "image-size";
import { PDFParse } from "pdf-parse";

import { comparePngs } from "../scripts/design-export-validation/lib/compare";
import { redactExportDiagnostic } from "../scripts/design-export-validation/lib/redact-diagnostic";

// PNG preparation and rendering can take about 74s. The two PDF pages can each
// use about 124s of bounded readiness and rendering waits, plus PDF assembly.
const PNG_DOWNLOAD_EVENT_TIMEOUT_MS = 90_000;
const ALL_SCREENS_PDF_DOWNLOAD_EVENT_TIMEOUT_MS = 300_000;
const IMPORTED_HTML_EXPORT_CASE_TIMEOUT_MS = 8 * 60_000;
const MAX_EXPORT_DIAGNOSTICS = 80;

interface ExportDiagnostic {
  caseMs: number;
  export?: string;
  exportMs?: number;
  event: string;
}

interface ExportTimelineEvent {
  at: number;
  event: string;
}

interface ExportTimelineState {
  active: boolean;
  events: ExportTimelineEvent[];
  startedAt: number | null;
}

interface ExportTraceWindow extends Window {
  __exportToasts?: string[];
  __exportTimeline?: ExportTimelineState;
}

interface ExportTrace {
  begin(label: string): number;
  record(event: string, at?: number): void;
  finish(page: Page): Promise<void>;
}

interface CorpusEntry {
  name: string;
  title: string;
  width: number;
  height: number;
  sourcePath: string;
}

function expectedFixtureFrameMarker(entry: CorpusEntry): string | null {
  const sourceHtml = fs.readFileSync(entry.sourcePath, "utf8");
  const nodeIds = Array.from(
    sourceHtml.matchAll(/\bdata-agent-native-node-id\s*=\s*["']([^"']+)["']/gi),
    (match) => match[1],
  ).filter((nodeId): nodeId is string => Boolean(nodeId));
  return nodeIds.includes("frame") ? "frame" : null;
}

function submittedHtmlHasFixtureFrameMarker(
  page: Page,
  html: string,
  expectedFrameMarker: string,
): Promise<boolean> {
  return page.evaluate(
    ({ html, expectedFrameMarker }) => {
      const parsedSnapshot = new DOMParser().parseFromString(html, "text/html");
      return Array.from(
        parsedSnapshot.querySelectorAll("[data-agent-native-node-id]"),
      ).some(
        (element) =>
          element.getAttribute("data-agent-native-node-id") ===
          expectedFrameMarker,
      );
    },
    { html, expectedFrameMarker },
  );
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const STATIC_EXPORT_FIXTURES: CorpusEntry[] = [
  {
    name: "effects-transforms",
    title: "Effects and transforms",
    width: 1000,
    height: 1010,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/effects-transforms/screen.html",
    ),
  },
  {
    name: "image-scale-modes",
    title: "Image scale modes",
    width: 900,
    height: 640,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/image-scale-modes/screen.html",
    ),
  },
  {
    name: "layout-stress",
    title: "Layout stress",
    width: 1440,
    height: 900,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/layout-stress/screen.html",
    ),
  },
  {
    name: "media-cards",
    title: "Media cards",
    width: 1200,
    height: 800,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/media-cards/screen.html",
    ),
  },
  {
    name: "mobile-icons",
    title: "Mobile icons",
    width: 390,
    height: 844,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/mobile-icons/screen.html",
    ),
  },
  {
    name: "typography",
    title: "Typography",
    width: 900,
    height: 1200,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/typography/screen.html",
    ),
  },
  {
    name: "whole-screen-padded-body",
    title: "Whole screen with padded body",
    width: 600,
    height: 400,
    sourcePath: path.join(
      REPO_ROOT,
      "templates/design/scripts/design-export-validation/corpus/whole-screen-padded-body/screen.html",
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

async function downloadFromMenuItem(
  page: Page,
  menuItem: Locator,
  label: string,
  timeoutMs: number,
  trace: ExportTrace,
): Promise<Buffer> {
  const startedAt = trace.begin(label);
  const enabledBeforeClick = await menuItem.isEnabled().catch(() => false);
  trace.record(`menu item enabled before click=${enabledBeforeClick}`);
  try {
    await page.evaluate(
      ({ label: exportLabel, startedAt: exportStartedAt }) => {
        const timeline = (window as ExportTraceWindow).__exportTimeline;
        if (!timeline) return;
        timeline.events = [];
        timeline.startedAt = exportStartedAt;
        timeline.active = true;
        timeline.events.push({
          at: Date.now(),
          event: `${exportLabel} browser event capture started`,
        });
      },
      { label, startedAt },
    );
    await expect(menuItem).toBeEnabled();
    trace.record("menu item enabled at click");
    trace.record(`download event waiter armed timeoutMs=${timeoutMs}`);
    const downloadPromise = page.waitForEvent("download", {
      timeout: timeoutMs,
    });
    trace.record("locator click started");
    const clickPromise = menuItem.click({ timeout: 15_000 }).then(
      () => trace.record("locator click completed"),
      (error: unknown) => {
        trace.record(
          `locator click rejected name=${error instanceof Error ? error.name : "unknown"}`,
        );
        throw error;
      },
    );
    let download: Awaited<typeof downloadPromise>;
    try {
      [download] = await Promise.all([downloadPromise, clickPromise]);
    } catch (error) {
      trace.record(
        `click/download wait rejected name=${error instanceof Error ? error.name : "unknown"}`,
      );
      throw error;
    }
    const extension = path.extname(download.suggestedFilename()).slice(0, 12);
    trace.record(`download event observed extension=${extension || "unknown"}`);

    const stream = await download.createReadStream();
    if (!stream) throw new Error(`${label} returned no bytes`);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } finally {
    await trace.finish(page);
  }
}

async function downloadPng(page: Page, trace: ExportTrace): Promise<Buffer> {
  const pngMenuItem = await openPngExport(page);
  return downloadFromMenuItem(
    page,
    pngMenuItem,
    "PNG",
    PNG_DOWNLOAD_EVENT_TIMEOUT_MS,
    trace,
  );
}

async function downloadAllScreensPdf(
  page: Page,
  trace: ExportTrace,
): Promise<Buffer> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  await expect(exportMenu).toBeVisible();
  await exportMenu.hover();
  const pdfMenuItem = page.getByRole("menuitem", {
    name: "Download PDF (all screens)",
  });
  await expect(pdfMenuItem).toBeVisible();
  return downloadFromMenuItem(
    page,
    pdfMenuItem,
    "all-screens PDF",
    ALL_SCREENS_PDF_DOWNLOAD_EVENT_TIMEOUT_MS,
    trace,
  );
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
  return pngMenuItem;
}

function isTransientPreviewNavigation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /execution context was destroyed|frame was detached/i.test(message);
}

async function reportTrustedPreviewRoute(
  page: Page,
  preview: Locator,
  screenId: string,
  reportedRoutePath: string,
  expectedTargetPath: string,
  marker: string,
): Promise<string | null> {
  await page.evaluate(
    ({ screenId, marker }) => {
      const routeProbeWindow = window as Window & {
        __designRouteProbe?: {
          marker: string;
          onMessage: (event: MessageEvent) => void;
          result: string | null | undefined;
        };
      };
      const previousProbe = routeProbeWindow.__designRouteProbe;
      if (previousProbe) {
        window.removeEventListener("message", previousProbe.onMessage);
      }
      const getPreview = () =>
        document.querySelector<HTMLIFrameElement>(
          `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screenId)}"]`,
        );
      const probe = {
        marker,
        result: undefined as string | null | undefined,
        onMessage: (_event: MessageEvent) => {},
      };
      probe.onMessage = (event: MessageEvent) => {
        const iframe = getPreview();
        if (
          event.source !== iframe?.contentWindow ||
          event.data?.type !== "agent-native:live-route-path" ||
          event.data?.__routeProbeMarker !== marker
        ) {
          return;
        }
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const currentIframe = getPreview();
            if (event.source !== currentIframe?.contentWindow) return;
            try {
              const iframeUrl = new URL(
                currentIframe.src,
                window.location.href,
              );
              const targetUrl = iframeUrl.searchParams.get("url");
              probe.result = targetUrl
                ? new URL(targetUrl).pathname
                : iframeUrl.pathname;
            } catch {
              probe.result = null;
            }
          });
        });
      };
      routeProbeWindow.__designRouteProbe = probe;
      window.addEventListener("message", probe.onMessage);
    },
    { screenId, marker },
  );

  try {
    await expect
      .poll(
        async () => {
          try {
            await preview
              .contentFrame()
              .locator("html")
              .evaluate(
                (_, { routePath: reportedPath, marker: probeMarker }) => {
                  window.parent.postMessage(
                    {
                      type: "agent-native:live-route-path",
                      routePath: reportedPath,
                      __routeProbeMarker: probeMarker,
                    },
                    "*",
                  );
                },
                { routePath: reportedRoutePath, marker },
              );
          } catch (error) {
            if (isTransientPreviewNavigation(error)) return null;
            throw error;
          }
          return page.evaluate(
            ({ marker: probeMarker }) => {
              const routeProbeWindow = window as Window & {
                __designRouteProbe?: {
                  marker: string;
                  result: string | null | undefined;
                };
              };
              const probe = routeProbeWindow.__designRouteProbe;
              if (probe?.marker !== probeMarker) {
                throw new Error("preview route receipt was not armed");
              }
              return probe.result ?? null;
            },
            { marker },
          );
        },
        {
          timeout: 10_000,
          message:
            "the loaded preview reports its trusted route after navigation",
        },
      )
      .toBe(expectedTargetPath);
    return page.evaluate(
      ({ marker: probeMarker }) => {
        const probe = (
          window as Window & {
            __designRouteProbe?: {
              marker: string;
              result: string | null | undefined;
            };
          }
        ).__designRouteProbe;
        return probe?.marker === probeMarker ? (probe.result ?? null) : null;
      },
      { marker },
    );
  } finally {
    await page
      .evaluate(
        ({ marker: probeMarker }) => {
          const routeProbeWindow = window as Window & {
            __designRouteProbe?: {
              marker: string;
              onMessage: (event: MessageEvent) => void;
            };
          };
          const probe = routeProbeWindow.__designRouteProbe;
          if (probe?.marker !== probeMarker) return;
          window.removeEventListener("message", probe.onMessage);
          delete routeProbeWindow.__designRouteProbe;
        },
        { marker },
      )
      .catch(() => undefined);
  }
}

function safeError(error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return {
    name,
    message: redactExportDiagnostic(message).slice(0, 300),
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

async function waitForPreviewLivePixels(preview: Locator) {
  const result: { readiness?: Awaited<ReturnType<typeof waitForLivePixels>> } =
    {};
  await expect
    .poll(
      async () => {
        try {
          const previewFrame = preview.contentFrame();
          const nodeCount = await previewFrame
            .locator("[data-agent-native-node-id]")
            .count();
          if (nodeCount === 0) return false;
          result.readiness = await waitForLivePixels(
            previewFrame.locator("html"),
          );
          return true;
        } catch (error) {
          if (isTransientPreviewNavigation(error)) return false;
          throw error;
        }
      },
      {
        timeout: 20_000,
        message:
          "the preview document keeps its content through navigation and becomes pixel ready",
      },
    )
    .toBe(true);
  if (!result.readiness)
    throw new Error("preview pixel readiness was not recorded");
  return result.readiness;
}

async function runStaticDesignExportCase(
  {
    page: basePage,
    browser,
    request,
    baseURL,
  }: {
    page: Page;
    browser: Browser;
    request: APIRequestContext;
    baseURL: string | undefined;
  },
  testInfo: TestInfo,
  entry: CorpusEntry,
  exportMode: "png" | "pdf",
): Promise<void> {
  test.setTimeout(IMPORTED_HTML_EXPORT_CASE_TIMEOUT_MS);
  if (!baseURL) throw new Error("test baseURL is unavailable");
  const selectedEntries = [entry];

  // Keep the same complete source root and bridge manifest used by the
  // combined corpus run, even when this worker exports one selected fixture.
  const sources = STATIC_EXPORT_FIXTURES.map((entry) => ({
    entry,
    filename: entry.name,
  }));
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
    const artifactDir = testInfo.outputPath(
      "imported-html-export",
      entry.name,
      exportMode,
    );
    fs.mkdirSync(artifactDir, { recursive: true });
    browserContext = await browser.newContext({
      storageState: await basePage.context().storageState(),
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const exportPage = await browserContext.newPage();
    let activeDiagnostics: ExportDiagnostic[] | null = null;
    let diagnosticsDropped = 0;
    let activeDiagnosticCaseStartedAt = Date.now();
    let activeExport: { label: string; startedAt: number } | null = null;
    let activeRenderSnapshotHtml: string | null = null;
    let activeExpectedFrameMarker: string | null = null;
    let activeRenderFrameMarkerPresent: Promise<boolean> | null = null;
    const recordDiagnostic = (event: string, at = Date.now()) => {
      if (!activeDiagnostics) return;
      if (activeDiagnostics.length >= MAX_EXPORT_DIAGNOSTICS) {
        diagnosticsDropped += 1;
        return;
      }
      const safeEvent = redactExportDiagnostic(event).slice(0, 180);
      activeDiagnostics.push({
        caseMs: Math.max(0, Math.round(at - activeDiagnosticCaseStartedAt)),
        ...(activeExport
          ? {
              export: activeExport.label,
              exportMs: Math.max(0, Math.round(at - activeExport.startedAt)),
            }
          : {}),
        event: safeEvent,
      });
    };
    const exportTrace: ExportTrace = {
      begin(label) {
        const startedAt = Date.now();
        activeExport = { label, startedAt };
        recordDiagnostic(`${label} menu export flow began`, startedAt);
        return startedAt;
      },
      record: recordDiagnostic,
      async finish(page) {
        const timelineEvents = await page
          .evaluate(() => {
            const timeline = (window as ExportTraceWindow).__exportTimeline;
            if (!timeline) return [];
            timeline.active = false;
            return timeline.events;
          })
          .catch(() => [] as ExportTimelineEvent[]);
        for (const timelineEvent of timelineEvents) {
          recordDiagnostic(timelineEvent.event, timelineEvent.at);
        }
        activeExport = null;
      },
    };
    exportPage.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/_agent-native/ui-capability")) {
        recordDiagnostic("UI capability request started");
      } else if (
        pathname.endsWith("/_agent-native/actions/render-export-png")
      ) {
        try {
          const body = JSON.parse(request.postData() ?? "{}") as {
            html?: unknown;
          };
          if (typeof body.html === "string") {
            activeRenderSnapshotHtml = body.html;
            activeRenderFrameMarkerPresent = activeExpectedFrameMarker
              ? submittedHtmlHasFixtureFrameMarker(
                  exportPage,
                  body.html,
                  activeExpectedFrameMarker,
                )
              : null;
            recordDiagnostic(
              `render request started bodyBytes=${new TextEncoder().encode(body.html).byteLength}`,
            );
            return;
          }
        } catch {
          // The safe diagnostic below records the request without its body.
        }
        recordDiagnostic("render request started without snapshot HTML");
      } else if (pathname.includes("/_agent-native/actions/")) {
        const pathSegments = pathname.split("/").filter(Boolean);
        recordDiagnostic(
          `action request ${request.method()} ${pathSegments[pathSegments.length - 1] ?? "unknown"}`,
        );
      }
    });
    exportPage.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.endsWith("/_agent-native/ui-capability")) {
        recordDiagnostic(`UI capability response ${response.status()}`);
      } else if (
        pathname.endsWith("/_agent-native/actions/render-export-png")
      ) {
        recordDiagnostic(
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
        recordDiagnostic(
          `request failed ${request.failure()?.errorText ?? "unknown"}`,
        );
      }
    });
    exportPage.on("pageerror", (error) => {
      recordDiagnostic(`page error: ${safeError(error).message}`);
    });
    exportPage.on("console", (message) => {
      if (message.type() === "error") {
        recordDiagnostic(`console error: ${safeError(message.text()).message}`);
      }
    });
    await exportPage.addInitScript(() => {
      const toasts: string[] = [];
      const traceWindow = window as ExportTraceWindow;
      const timeline: ExportTimelineState = {
        active: false,
        events: [],
        startedAt: null,
      };
      traceWindow.__exportToasts = toasts;
      traceWindow.__exportTimeline = timeline;
      const observedToastMessages = new WeakMap<Element, string>();
      const recordTimelineEvent = (event: string) => {
        if (!timeline.active || timeline.events.length >= 24) {
          return;
        }
        timeline.events.push({
          at: Date.now(),
          event: event.slice(0, 180),
        });
      };
      document.addEventListener(
        "click",
        (event) => {
          const target =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>('[role="menuitem"]')
              : null;
          if (!target) return;
          const label =
            (target.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80) || "unlabeled";
          recordTimelineEvent(
            `DOM click target=menuitem label=${label} aria-disabled=${target.getAttribute("aria-disabled") ?? "false"}`,
          );
        },
        true,
      );
      const toastObserver = new MutationObserver(() => {
        document.querySelectorAll("[data-sonner-toast]").forEach((toast) => {
          const message = (toast.textContent || "").trim().slice(0, 180);
          if (message && observedToastMessages.get(toast) !== message) {
            observedToastMessages.set(toast, message);
            recordTimelineEvent(`toast ${message}`);
            if (!toasts.includes(message) && toasts.length < 20) {
              toasts.push(message);
            }
          }
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
    const blockedSnapshotRequests: string[] = [];
    if (exportMode === "png") {
      snapshotContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
        javaScriptEnabled: false,
        serviceWorkers: "block",
      });
      snapshotPage = await snapshotContext.newPage();
      await snapshotPage.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.startsWith("data:") || url === "about:blank") {
          await route.continue();
          return;
        }
        blockedSnapshotRequests.push(url);
        await route.abort("blockedbyclient");
      });
    }
    const caseFailures: string[] = [];
    for (const entry of selectedEntries) {
      const diagnostics: ExportDiagnostic[] = [];
      let snapshotResourceFailures: string[] = [];
      activeDiagnosticCaseStartedAt = Date.now();
      activeExport = null;
      activeDiagnostics = diagnostics;
      diagnosticsDropped = 0;
      const expectedFrameMarker = expectedFixtureFrameMarker(entry);
      activeExpectedFrameMarker = expectedFrameMarker;
      activeRenderFrameMarkerPresent = null;
      const stage = { name: "setup" };
      let designId: string | null = null;
      try {
        const viewport = { width: entry.width, height: entry.height };
        const opened = (await postAction(request, baseURL, "open-visual-edit", {
          newDesign: true,
          title: `Imported HTML export ${entry.name}`,
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
          screens: Array<{ id: string; path: string }>;
        };
        designId = opened.designId;
        designIds.push(designId);
        const previewScreenId = opened.screens.find(
          (screen) => screen.path === `/${entry.name}`,
        )?.id;
        if (!previewScreenId) {
          throw new Error(`created design has no screen for /${entry.name}`);
        }
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
          `iframe[data-design-preview-iframe][data-design-source-type="localhost"][data-screen-iframe-id="${previewScreenId}"]`,
        );
        await expect(preview).toHaveCount(1, { timeout: 30_000 });
        stage.name = "preview readiness";
        recordDiagnostic("preview iframe readiness started");
        const previewReadiness = await waitForPreviewLivePixels(preview);
        recordDiagnostic("preview iframe readiness completed");
        if (entry.name === "effects-transforms") {
          stage.name = "preview route report";
          recordDiagnostic("preview route report started");
          const routeAfterStartupReport = await reportTrustedPreviewRoute(
            exportPage,
            preview,
            previewScreenId,
            "srcdoc",
            `/${entry.name}`,
            `route-probe-${designId}`,
          );
          expect(routeAfterStartupReport).toBe(`/${entry.name}`);
          recordDiagnostic("preview route report completed");
        }
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
        const unsupportedMediaCount = await preview
          .contentFrame()
          .locator("video, audio[controls]")
          .count();
        if (unsupportedMediaCount > 0 && exportMode === "png") {
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

        if (exportMode === "png") {
          stage.name = "PNG download";
          activeRenderSnapshotHtml = null;
          activeRenderFrameMarkerPresent = null;
          const exportedPng = await downloadPng(exportPage, exportTrace);
          const exportSnapshotHtml = activeRenderSnapshotHtml;
          if (!exportSnapshotHtml) {
            throw new Error(
              "PNG renderer request did not include snapshot HTML",
            );
          }
          if (expectedFrameMarker) {
            expect(
              activeRenderFrameMarkerPresent
                ? await activeRenderFrameMarkerPresent
                : false,
              `PNG request HTML for ${entry.name} must retain fixture marker ${expectedFrameMarker}`,
            ).toBe(true);
          }
          snapshotResourceFailures =
            /data-agent-native-export-resource-failures=["']([^"']+)["']/i
              .exec(exportSnapshotHtml)?.[1]
              .split(",")
              .map((failure) => redactExportDiagnostic(failure)) ?? [];

          const activeSnapshotPage = snapshotPage;
          if (!activeSnapshotPage) {
            throw new Error("PNG snapshot page is unavailable");
          }
          stage.name = "export snapshot screenshot";
          blockedSnapshotRequests.length = 0;
          await activeSnapshotPage.setViewportSize(viewport);
          await activeSnapshotPage.setContent(exportSnapshotHtml, {
            waitUntil: "load",
          });
          const snapshotReadiness = await activeSnapshotPage.evaluate(
            async () => {
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
            },
          );
          if (blockedSnapshotRequests.length > 0) {
            throw new Error("export snapshot requested an external resource");
          }
          const snapshotPng = await activeSnapshotPage.screenshot({
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
            path.join(artifactDir, `${entry.name}-snapshot.png`),
            snapshotPng,
          );
          fs.writeFileSync(
            path.join(artifactDir, `${entry.name}-snapshot-diff.png`),
            snapshotDiff.diffPng,
          );
          console.info(
            `[imported-html-export] ${entry.name} snapshot diffPixels=${snapshotDiff.diffPixels} diffRatio=${snapshotDiff.diffRatio}`,
          );

          const diff = await comparePngs(browser, referencePng, exportedPng, {
            threshold: 0,
          });
          outcomes.push({
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
          });
          fs.writeFileSync(
            path.join(artifactDir, `${entry.name}-reference.png`),
            referencePng,
          );
          fs.writeFileSync(
            path.join(artifactDir, `${entry.name}-export.png`),
            exportedPng,
          );
          fs.writeFileSync(
            path.join(artifactDir, `${entry.name}-diff.png`),
            diff.diffPng,
          );
        } else {
          stage.name = "all-screens PDF export";
          const exportedPdf = await downloadAllScreensPdf(
            exportPage,
            exportTrace,
          );
          fs.writeFileSync(
            path.join(artifactDir, `${entry.name}-all-screens.pdf`),
            exportedPdf,
          );
          const pdfPngs = await pdfPagesPng(
            exportedPdf,
            imageSize(referencePng).width,
          );
          const pdfPageComparisons: Array<{
            page: number;
            reference: { width: number; height: number };
            candidate: { width: number; height: number };
            dimensionMismatch: boolean;
            diffPixels: number;
            comparedPixels: number;
            diffRatio: number;
            maxDelta: number;
            meanDelta: number;
          }> = [];
          for (const [index, pdfPng] of pdfPngs.entries()) {
            const pageDiff = await comparePngs(browser, referencePng, pdfPng, {
              threshold: 0,
            });
            fs.writeFileSync(
              path.join(artifactDir, `${entry.name}-pdf-page-${index + 1}.png`),
              pdfPng,
            );
            fs.writeFileSync(
              path.join(
                artifactDir,
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
              `[imported-html-export] ${entry.name} PDF page ${index + 1} diffPixels=${pageDiff.diffPixels} diffRatio=${pageDiff.diffRatio}`,
            );
          }
          outcomes.push({
            name: entry.name,
            pdfPageCount: pdfPageComparisons.length,
            pdfPages: pdfPageComparisons,
            previewFontErrors: previewReadiness.fontErrors,
            previewLoadingFonts: previewReadiness.loadingFonts,
            previewImageErrors: previewReadiness.imageErrors,
            referenceFontErrors: referenceReadiness.fontErrors,
            referenceLoadingFonts: referenceReadiness.loadingFonts,
            referenceImageErrors: referenceReadiness.imageErrors,
            previewReadiness,
            sourceDocument: {
              width: referenceReadiness.width,
              height: referenceReadiness.height,
            },
          });
          fs.writeFileSync(
            path.join(artifactDir, `${entry.name}-reference.png`),
            referencePng,
          );
        }
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
          toast: redactExportDiagnostic(toast.join(" ")).slice(0, 300),
          toastHistory: toastHistory.map((message) =>
            redactExportDiagnostic(message).slice(0, 300),
          ),
          snapshotResourceFailures,
          diagnosticsDropped,
          diagnostics: [...diagnostics].sort(
            (left, right) => left.caseMs - right.caseMs,
          ),
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
      path.join(artifactDir, "metrics.json"),
      `${JSON.stringify(outcomes, null, 2)}\n`,
    );
    const failureDetails = outcomes
      .filter((outcome) => typeof outcome.error === "string")
      .map((outcome) => ({
        name: outcome.name,
        stage: outcome.error,
        exception: outcome.exception,
        toast: outcome.toast,
        toastHistory: Array.isArray(outcome.toastHistory)
          ? outcome.toastHistory.map((message) => safeError(message).message)
          : [],
        diagnostics: outcome.diagnostics,
        diagnosticsDropped: outcome.diagnosticsDropped,
      }));
    if (failureDetails.length > 0) {
      await testInfo.attach("imported-html-export-failures.json", {
        body: JSON.stringify(failureDetails, null, 2),
        contentType: "application/json",
      });
    }
    console.info(
      `[imported-html-export] ${JSON.stringify({
        outcomes: outcomes.map((outcome) => ({
          name: outcome.name,
          diffPixels: outcome.diffPixels,
          diffRatio: outcome.diffRatio,
          snapshotDiffPixels: outcome.snapshotDiffPixels,
          snapshotDiffRatio: outcome.snapshotDiffRatio,
          error: outcome.error,
        })),
        failures: failureDetails,
      })}`,
    );
    expect(caseFailures, "case-level browser/download failures").toEqual([]);
    expect(outcomes).toHaveLength(1);
    if (exportMode === "png") {
      expect(
        outcomes.some((outcome) => typeof outcome.diffRatio === "number"),
        "the case must compare its checked-in source document with the PNG export",
      ).toBe(true);
    } else {
      expect(
        outcomes.some((outcome) => Array.isArray(outcome.pdfPages)),
        "the PDF case must compare both exported pages",
      ).toBe(true);
    }
    const exportFailures = outcomes
      .filter(
        (outcome) =>
          !outcome.unsupported &&
          ((exportMode === "png" &&
            (outcome.dimensionMismatch ||
              outcome.diffRatio !== 0 ||
              outcome.snapshotDimensionMismatch ||
              outcome.snapshotDiffPixels !== 0 ||
              outcome.snapshotFontErrors !== 0 ||
              outcome.snapshotLoadingFonts !== 0 ||
              outcome.snapshotImageErrors !== 0)) ||
            (exportMode === "pdf" &&
              (!Array.isArray(outcome.pdfPages) ||
                outcome.pdfPageCount !== 2 ||
                outcome.pdfPages.some(
                  (page) =>
                    page.dimensionMismatch !== false || page.diffRatio !== 0,
                ))) ||
            outcome.previewFontErrors !== 0 ||
            outcome.previewLoadingFonts !== 0 ||
            outcome.previewImageErrors !== 0 ||
            outcome.referenceFontErrors !== 0 ||
            outcome.referenceLoadingFonts !== 0 ||
            outcome.referenceImageErrors !== 0 ||
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
      exportFailures,
      "every rendered export must preserve the browser-rendered source at threshold 0",
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
}

const caseFilter = process.env.DESIGN_EXPORT_CORPUS_CASE;
const selectedFixtures = caseFilter
  ? STATIC_EXPORT_FIXTURES.filter((entry) => entry.name === caseFilter)
  : STATIC_EXPORT_FIXTURES;

if (selectedFixtures.length === 0) {
  test("requested imported HTML corpus case is available", () => {
    throw new Error("requested imported HTML corpus case is unavailable");
  });
} else {
  for (const entry of selectedFixtures) {
    test(`static Design document ${entry.name} retains its rendered pixels through PNG export`, async ({
      page,
      browser,
      request,
      baseURL,
    }, testInfo) => {
      await runStaticDesignExportCase(
        { page, browser, request, baseURL },
        testInfo,
        entry,
        "png",
      );
    });
  }

  const pdfEntry = selectedFixtures.find(
    (entry) => entry.name === "effects-transforms",
  );
  if (pdfEntry) {
    test(`static Design document ${pdfEntry.name} retains its rendered pixels through all-screens PDF export`, async ({
      page,
      browser,
      request,
      baseURL,
    }, testInfo) => {
      await runStaticDesignExportCase(
        { page, browser, request, baseURL },
        testInfo,
        pdfEntry,
        "pdf",
      );
    });
  }
}
