import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getAppProductionUrl,
  sendEmail,
  signEmbedSessionToken,
} from "@agent-native/core/server";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
} from "@agent-native/core/shared";

import type {
  DashboardFilter,
  FilterType,
  SqlDashboardConfig,
} from "../../app/pages/adhoc/sql-dashboard/types";
import {
  getReportDashboard,
  type AccessCtx,
  type DashboardReportSubscription,
} from "./dashboard-report-subscriptions";

type ReportSnapshot = {
  dashboardId: string;
  title: string;
  description?: string;
  filters: Record<string, string>;
  dashboardUrl: string;
  reportSettingsUrl: string;
  generatedAt: string;
  panelCount: number;
};

const DATE_FILTER_TYPES: ReadonlySet<FilterType> = new Set([
  "date",
  "date-range",
  "toggle-date",
]);
const DEFAULT_SERVERLESS_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";
const DASHBOARD_REPORT_SCREENSHOT_PARAM = "reportScreenshot";
const DASHBOARD_REPORT_SETTINGS_PARAM = "reportSettings";
const DASHBOARD_REPORT_CID = "dashboard-report-snapshot";
const DASHBOARD_REPORT_PANELS_PER_CHUNK = 8;
const LOCAL_SCREENSHOT_TIMEOUT_MS = 90_000;
const SERVERLESS_SCREENSHOT_TIMEOUT_MS = 90_000;
const SERVERLESS_SECOND_READY_TIMEOUT_MS = 45_000;
// Leave room under Netlify's 300s background-function limit for browser
// cleanup and delivery after a single complete chunked capture attempt.
const SERVERLESS_CHUNKED_ATTEMPT_TIMEOUT_MS = 240_000;
const BROWSER_CLEANUP_TIMEOUT_MS = 10_000;
const SCREENSHOT_VIEWPORT_PADDING = 64;

type DashboardScreenshotAttempt = {
  label: "chunked";
  viewport: { width: number; height: number };
  captureScale?: number;
  readyTimeout?: number;
  secondReadyTimeout?: number;
  totalTimeout?: number;
};

type LaunchedScreenshotBrowser = {
  browser: any;
  cleanup: () => Promise<void>;
  newPage: () => Promise<any>;
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function resolveDefault(raw: string | undefined, type: FilterType): string {
  if (!raw) return "";
  if (DATE_FILTER_TYPES.has(type)) {
    const m = /^(\d+)d$/.exec(raw);
    if (m) return daysAgo(parseInt(m[1], 10));
    if (raw === "today") return daysAgo(0);
  }
  return raw;
}

function defaultFilterValues(
  config: SqlDashboardConfig,
): Record<string, string> {
  const values: Record<string, string> = {};
  const filters = Array.isArray(config.filters) ? config.filters : [];
  for (const f of filters as DashboardFilter[]) {
    if (f.type === "date-range") {
      values[`f_${f.id}Start`] = resolveDefault(f.default, f.type);
      values[`f_${f.id}End`] = daysAgo(0);
    } else if (f.type !== "toggle" && f.type !== "toggle-date") {
      values[`f_${f.id}`] = resolveDefault(f.default, f.type);
    }
  }
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value)),
  );
}

function dashboardConfigFromRecord(raw: Record<string, unknown>) {
  return {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : "Untitled Dashboard",
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    filters: Array.isArray(raw.filters)
      ? (raw.filters as DashboardFilter[])
      : undefined,
    variables:
      raw.variables && typeof raw.variables === "object"
        ? (raw.variables as Record<string, string>)
        : undefined,
    columns: typeof raw.columns === "number" ? raw.columns : undefined,
    panels: Array.isArray(raw.panels) ? (raw.panels as any[]) : [],
  } satisfies SqlDashboardConfig;
}

function countReportablePanels(config: SqlDashboardConfig): number {
  return config.panels.filter((panel) => panel.chartType !== "section").length;
}

function dashboardBaseUrl(): string {
  return (
    process.env.DASHBOARD_REPORT_BASE_URL?.trim() ||
    getAppProductionUrl().replace(/\/+$/, "")
  );
}

function buildDashboardPath(
  dashboardId: string,
  filters: Record<string, string>,
  options?: {
    reportScreenshot?: boolean;
    reportSettings?: boolean;
  },
): string {
  const url = new URL(
    `/dashboards/${encodeURIComponent(dashboardId)}`,
    "https://agent-native.invalid/",
  );
  for (const [key, value] of Object.entries(filters)) {
    if (value) url.searchParams.set(key, value);
  }
  if (options?.reportScreenshot) {
    url.searchParams.set(DASHBOARD_REPORT_SCREENSHOT_PARAM, "1");
  }
  if (options?.reportSettings) {
    url.searchParams.set(DASHBOARD_REPORT_SETTINGS_PARAM, "1");
  }
  return `${url.pathname}${url.search}`;
}

function buildDashboardUrl(
  dashboardId: string,
  filters: Record<string, string>,
  options?: {
    reportScreenshot?: boolean;
    reportSettings?: boolean;
  },
): string {
  const path = buildDashboardPath(dashboardId, filters, options);
  const url = new URL(path, `${dashboardBaseUrl()}/`);
  return url.toString();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function collectReportSnapshot(
  sub: DashboardReportSubscription,
): Promise<ReportSnapshot> {
  const accessCtx: AccessCtx = {
    email: sub.ownerEmail,
    orgId: sub.orgId,
  };
  const dashboard = await getReportDashboard(sub.dashboardId, accessCtx);
  if (!dashboard) {
    throw Object.assign(new Error("Dashboard not found"), { statusCode: 404 });
  }

  const config = dashboardConfigFromRecord(dashboard.config);
  const filters = {
    ...defaultFilterValues(config),
    ...sub.filters,
  };

  return {
    dashboardId: sub.dashboardId,
    title: config.name || dashboard.title,
    description: config.description,
    filters,
    dashboardUrl: buildDashboardUrl(sub.dashboardId, filters),
    reportSettingsUrl: buildDashboardUrl(sub.dashboardId, filters, {
      reportSettings: true,
    }),
    generatedAt: new Date().toISOString(),
    panelCount: countReportablePanels(config),
  };
}

function isServerlessBrowserRuntime(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.AWS_EXECUTION_ENV)
  );
}

function localChromiumExecutablePath(): string | null {
  const configured =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROME_BIN ||
    process.env.CHROMIUM_PATH;
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function sweepStaleScreenshotProfiles(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(tmpdir());
  } catch {
    return;
  }
  const stale = entries
    .filter((entry) => entry.startsWith("dashboard-report-playwright-"))
    .slice(0, 8);
  for (const entry of stale) {
    const full = join(tmpdir(), entry);
    const info = await stat(full).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 30 * 60_000) {
      await rm(full, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function launchScreenshotBrowser(
  viewport: DashboardScreenshotAttempt["viewport"],
): Promise<LaunchedScreenshotBrowser> {
  const { chromium: playwright } = await import("playwright-core");
  const localExecutablePath = localChromiumExecutablePath();
  if (localExecutablePath) {
    const browser = await playwright.launch({
      executablePath: localExecutablePath,
      headless: true,
    });
    return {
      browser,
      cleanup: async () => {},
      newPage: () =>
        browser.newPage({
          viewport,
          deviceScaleFactor: 1,
        }),
    };
  }

  if (isServerlessBrowserRuntime()) {
    const { default: chromium } = await import("@sparticuz/chromium-min");
    chromium.setGraphicsMode = false;
    const packUrl =
      process.env.DASHBOARD_REPORT_CHROMIUM_PACK_URL?.trim() ||
      DEFAULT_SERVERLESS_CHROMIUM_PACK_URL;
    await sweepStaleScreenshotProfiles();
    const userDataDir = join(
      tmpdir(),
      `dashboard-report-playwright-${randomUUID()}`,
    );
    const cleanup = async () => {
      await rm(userDataDir, { recursive: true, force: true }).catch((err) => {
        console.error(
          "[dashboard-report] Failed to clean Chromium profile:",
          errorMessage(err),
        );
      });
    };

    try {
      const browser = await playwright.launchPersistentContext(userDataDir, {
        args: [
          ...chromium.args,
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--hide-scrollbars",
        ],
        deviceScaleFactor: 1,
        executablePath: await chromium.executablePath(packUrl),
        headless: true,
        viewport,
      });
      return {
        browser,
        cleanup,
        newPage: () => browser.newPage(),
      };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  const browser = await playwright.launch({ headless: true });
  return {
    browser,
    cleanup: async () => {},
    newPage: () =>
      browser.newPage({
        viewport,
        deviceScaleFactor: 1,
      }),
  };
}

function screenshotTimeoutMs(): number {
  const configured = positiveIntEnv("DASHBOARD_REPORT_SCREENSHOT_TIMEOUT_MS");
  if (configured) return configured;
  return isServerlessBrowserRuntime()
    ? SERVERLESS_SCREENSHOT_TIMEOUT_MS
    : LOCAL_SCREENSHOT_TIMEOUT_MS;
}

function secondReadyTimeoutMs(): number {
  const configured = positiveIntEnv("DASHBOARD_REPORT_SECOND_READY_TIMEOUT_MS");
  if (configured) return configured;
  return isServerlessBrowserRuntime()
    ? SERVERLESS_SECOND_READY_TIMEOUT_MS
    : screenshotTimeoutMs();
}

function positiveIntEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function waitForDashboardReportReady(
  page: any,
  timeout: number,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      `(() => {
        const root = document.querySelector("[data-dashboard-report-capture]");
        if (!root) return false;
        if (root.getAttribute("data-dashboard-report-ready") !== "true") {
          return false;
        }
        return !root.querySelector("[data-dashboard-report-loading='true']");
      })()`,
      undefined,
      { timeout },
    );
    await page.evaluate(`(async () => {
      await document.fonts?.ready;
    })()`);
    await page.waitForTimeout(750);
    return true;
  } catch (err: any) {
    const detail = await page
      .evaluate(`(() => {
        const root = document.querySelector("[data-dashboard-report-capture]");
        return {
          ready: root?.getAttribute("data-dashboard-report-ready") ?? null,
          loadingCount: root?.querySelectorAll("[data-dashboard-report-loading='true']").length ?? null,
          text: document.body?.innerText?.slice(0, 1000) ?? "",
          url: location.href,
        };
      })()`)
      .catch(() => null);
    const message = detail
      ? `${err?.message ?? String(err)}; dashboard state: ${JSON.stringify(detail)}`
      : `${err?.message ?? String(err)}; dashboard page was not inspectable`;
    throw new Error(message);
  }
}

async function scrollDashboardForLazyRendering(page: any): Promise<void> {
  await page.evaluate(`(async () => {
    const wait = (ms) =>
      new Promise((resolve) => window.setTimeout(resolve, ms));
    const maxY = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    );
    const step = Math.max(600, Math.floor(window.innerHeight * 0.75));
    for (let y = 0; y < maxY; y += step) {
      window.scrollTo(0, y);
      await wait(120);
    }
    window.scrollTo(0, 0);
  })()`);
}

async function fitViewportWidthToDashboardCapture(
  page: any,
  capture: any,
  viewport: { width: number; height: number },
): Promise<void> {
  const box = await capture.boundingBox();
  if (!box) return;

  const width = Math.max(
    viewport.width,
    Math.min(1800, Math.ceil(box.width + SCREENSHOT_VIEWPORT_PADDING)),
  );
  if (width === viewport.width) return;

  // Keep the render surface bounded. Playwright's locator screenshot captures
  // the full element beyond the viewport, while growing Chromium to the full
  // dashboard height can exhaust memory and close the browser on serverless
  // workers. Width-only fitting preserves the full dashboard without that
  // oversized render surface.
  await page.setViewportSize({ width, height: viewport.height });
  await page.waitForTimeout(250);
}

async function scaleDashboardCapture(
  page: any,
  scale: number | undefined,
): Promise<void> {
  if (!scale || scale >= 1) return;
  await page.evaluate(`(() => {
    const root = document.querySelector("[data-dashboard-report-capture]");
    if (root instanceof HTMLElement) root.style.zoom = "${scale}";
  })()`);
  await page.waitForTimeout(250);
}

async function runBoundedBrowserCleanup(
  label: string,
  operation: () => Promise<void>,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded cleanup timeout`)),
          BROWSER_CLEANUP_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    console.error(`[dashboard-report] ${label}:`, errorMessage(err));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const DIAGNOSTICS_PROBE_TIMEOUT_MS = 2_000;
const DIAGNOSTICS_MAX_LENGTH = 700;
const DIAGNOSTICS_COLLECTOR_LIMIT = 5;

// Best-effort page inspection used when the report surface never becomes
// visible, so failures carry enough state to tell wrong-page/wedged-renderer/
// auth-bounce apart. Must never throw and must stay bounded even if the page
// is hung.
async function collectPageDiagnostics(
  page: any,
  consoleErrors: string[],
  failedRequests: string[],
): Promise<string> {
  try {
    let responsive = true;
    let probeTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(page.evaluate("1")),
        new Promise((_, reject) => {
          probeTimeout = setTimeout(
            () => reject(new Error("diagnostics probe timed out")),
            DIAGNOSTICS_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      responsive = false;
    } finally {
      if (probeTimeout) clearTimeout(probeTimeout);
    }

    if (!responsive) {
      return `page unresponsive (renderer hung or crashed); consoleErrors=${JSON.stringify(
        consoleErrors,
      )} failedRequests=${JSON.stringify(failedRequests)}`.slice(
        0,
        DIAGNOSTICS_MAX_LENGTH,
      );
    }

    let url = "";
    try {
      url = page.url();
    } catch {
      // page may already be closed; leave url empty
    }

    let title = "";
    let bodyText = "";
    let detailsTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // page.evaluate ignores setDefaultTimeout, so race it like the probe —
      // a renderer that wedges after the probe must not stall diagnostics.
      const details = await Promise.race([
        Promise.resolve(
          page.evaluate(
            `(() => ({
              title: document.title,
              bodyText: document.body?.innerText?.slice(0, 240) ?? "",
            }))()`,
          ),
        ),
        new Promise<never>((_, reject) => {
          detailsTimeout = setTimeout(
            () => reject(new Error("diagnostics details timed out")),
            DIAGNOSTICS_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      title = (details as any)?.title ?? "";
      bodyText = (details as any)?.bodyText ?? "";
    } catch {
      // best effort; leave title/bodyText empty
    } finally {
      if (detailsTimeout) clearTimeout(detailsTimeout);
    }

    return `page state: ${JSON.stringify({
      url,
      title,
      bodyText,
      consoleErrors,
      failedRequests,
    })}`.slice(0, DIAGNOSTICS_MAX_LENGTH);
  } catch {
    return "diagnostics unavailable";
  }
}

function reportChunkOffsets(panelCount: number): number[] {
  if (panelCount === 0) return [0];
  return Array.from(
    { length: Math.ceil(panelCount / DASHBOARD_REPORT_PANELS_PER_CHUNK) },
    (_, index) => index * DASHBOARD_REPORT_PANELS_PER_CHUNK,
  );
}

function screenshotUrlForChunk(
  sub: DashboardReportSubscription,
  snapshot: ReportSnapshot,
  offset: number,
): { token: string; url: string } {
  const targetPath = buildDashboardPath(
    snapshot.dashboardId,
    snapshot.filters,
    { reportScreenshot: true },
  );
  const targetUrl = new URL(targetPath, "https://agent-native.invalid/");
  targetUrl.searchParams.set("reportPanelOffset", String(offset));
  targetUrl.searchParams.set(
    "reportPanelLimit",
    String(DASHBOARD_REPORT_PANELS_PER_CHUNK),
  );
  const signedTargetPath = `${targetUrl.pathname}${targetUrl.search}`;
  const token = signEmbedSessionToken({
    ownerEmail: sub.ownerEmail,
    orgId: sub.orgId,
    targetPath: signedTargetPath,
    scope: `dashboard-report-screenshot:${sub.id}`,
    ttlSeconds: 5 * 60,
  });
  const url = new URL(signedTargetPath, `${dashboardBaseUrl()}/`);
  url.searchParams.set(EMBED_MODE_QUERY_PARAM, "1");
  url.searchParams.set(EMBED_TOKEN_QUERY_PARAM, token);
  return { token, url: url.toString() };
}

async function captureDashboardChunk(
  page: any,
  attempt: DashboardScreenshotAttempt,
  token: string,
  screenshotUrl: string,
): Promise<Buffer> {
  const timeout = screenshotTimeoutMs();
  let captureStage = "pre-seeding the embed session";
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (msg: any) => {
    if (
      msg.type() !== "error" ||
      consoleErrors.length >= DIAGNOSTICS_COLLECTOR_LIMIT
    )
      return;
    consoleErrors.push(msg.text().slice(0, 160));
  });
  page.on("requestfailed", (req: any) => {
    if (failedRequests.length >= DIAGNOSTICS_COLLECTOR_LIMIT) return;
    failedRequests.push(
      `${req.method()} ${req.url().slice(0, 120)}: ${req.failure()?.errorText ?? "failed"}`,
    );
  });
  page.on("response", (res: any) => {
    if (
      res.status() < 400 ||
      failedRequests.length >= DIAGNOSTICS_COLLECTOR_LIMIT
    )
      return;
    failedRequests.push(
      `${res.request().method()} ${res.url().slice(0, 120)}: HTTP ${res.status()}`,
    );
  });
  try {
    try {
      await page.context().addCookies([
        {
          name: EMBED_SESSION_COOKIE,
          value: token,
          url: `${dashboardBaseUrl()}/`,
        },
      ]);
    } catch (err) {
      console.warn(
        "[dashboard-report] Failed to pre-seed embed session cookie:",
        errorMessage(err),
      );
    }
    page.setDefaultTimeout(timeout);
    await page.emulateMedia({ media: "screen", colorScheme: "light" });
    await page.addInitScript(() =>
      window.localStorage.setItem("theme", "light"),
    );
    captureStage = "navigating to the report chunk";
    await page.goto(screenshotUrl, { waitUntil: "domcontentloaded", timeout });
    const capture = page.locator("[data-dashboard-report-capture]");
    captureStage = "waiting for the report chunk surface";
    try {
      await capture.waitFor({ state: "visible", timeout });
    } catch (err) {
      const diagnostics = errorMessage(
        await collectPageDiagnostics(page, consoleErrors, failedRequests),
      );
      throw new Error(`${errorMessage(err)}; ${diagnostics}`);
    }
    captureStage = "waiting for report chunk queries";
    await waitForDashboardReportReady(page, attempt.readyTimeout ?? timeout);
    captureStage = "rendering lazy report chunk panels";
    await scrollDashboardForLazyRendering(page);
    captureStage = "waiting for lazy report chunk panels";
    await waitForDashboardReportReady(
      page,
      attempt.secondReadyTimeout ?? secondReadyTimeoutMs(),
    );
    captureStage = "sizing the report chunk";
    await fitViewportWidthToDashboardCapture(page, capture, attempt.viewport);
    await scaleDashboardCapture(page, attempt.captureScale);
    await capture.scrollIntoViewIfNeeded();
    captureStage = "rasterizing the report chunk PNG";
    const image = await capture.screenshot({
      type: "png",
      animations: "disabled",
    });
    if (!image?.length) throw new Error("Dashboard screenshot was empty");
    return Buffer.from(image);
  } catch (err) {
    throw new Error(`${captureStage}: ${errorMessage(err)}`);
  }
}

async function captureDashboardPngChunks(
  sub: DashboardReportSubscription,
  snapshot: ReportSnapshot,
): Promise<Buffer[]> {
  const serverless = isServerlessBrowserRuntime();
  const attempt: DashboardScreenshotAttempt = {
    label: "chunked",
    viewport: { width: 1200, height: 1400 },
    captureScale: 0.7,
    ...(serverless
      ? {
          readyTimeout: 35_000,
          secondReadyTimeout: 15_000,
          totalTimeout: SERVERLESS_CHUNKED_ATTEMPT_TIMEOUT_MS,
        }
      : {}),
  };
  let browser: any;
  let cleanup = async () => {};
  let launchPromise: Promise<LaunchedScreenshotBrowser> | undefined;
  let launchTimeout: ReturnType<typeof setTimeout> | undefined;
  let attemptTimedOut = false;
  const attemptTimeout = attempt.totalTimeout
    ? setTimeout(() => {
        attemptTimedOut = true;
        if (browser) void browser.close().catch(() => {});
      }, attempt.totalTimeout)
    : null;
  try {
    launchPromise = launchScreenshotBrowser(attempt.viewport);
    const launched = attempt.totalTimeout
      ? await Promise.race([
          launchPromise,
          new Promise<never>((_, reject) => {
            launchTimeout = setTimeout(
              () =>
                reject(
                  new Error(
                    `${attempt.label} browser launch exceeded ${attempt.totalTimeout}ms`,
                  ),
                ),
              attempt.totalTimeout,
            );
          }),
        ])
      : await launchPromise;
    browser = launched.browser;
    cleanup = launched.cleanup;
    const images: Buffer[] = [];
    for (const offset of reportChunkOffsets(snapshot.panelCount)) {
      if (attemptTimedOut)
        throw new Error(`capture exceeded ${attempt.totalTimeout}ms`);
      const page = await launched.newPage();
      try {
        const { token, url } = screenshotUrlForChunk(sub, snapshot, offset);
        images.push(await captureDashboardChunk(page, attempt, token, url));
      } finally {
        await runBoundedBrowserCleanup("Failed to close screenshot page", () =>
          page.close(),
        );
      }
    }
    return images;
  } catch (err) {
    if (attemptTimedOut) {
      throw new Error(
        `${attempt.label} capture exceeded ${attempt.totalTimeout}ms: ${errorMessage(err)}`,
      );
    }
    throw new Error(`${attempt.label}: ${errorMessage(err)}`);
  } finally {
    if (attemptTimeout) clearTimeout(attemptTimeout);
    if (launchTimeout) clearTimeout(launchTimeout);
    if (!browser && launchPromise) {
      void launchPromise.then(
        async (lateBrowser) => {
          await runBoundedBrowserCleanup(
            "Failed to close late screenshot browser",
            () => lateBrowser.browser.close(),
          );
          await runBoundedBrowserCleanup(
            "Failed to clean late Chromium profile",
            lateBrowser.cleanup,
          );
        },
        () => {},
      );
    }
    if (browser) {
      await runBoundedBrowserCleanup("Failed to close screenshot browser", () =>
        browser.close(),
      );
    }
    await runBoundedBrowserCleanup("Failed to clean Chromium profile", cleanup);
  }
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(
    new RegExp(`(${EMBED_TOKEN_QUERY_PARAM}=)[^&\\s]+`, "g"),
    "$1[REDACTED]",
  );
}

function storedAttemptError(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 400 ? `${normalized.slice(0, 399)}…` : normalized;
}

async function captureDashboardPngWithFallback(
  sub: DashboardReportSubscription,
  snapshot: ReportSnapshot,
): Promise<{
  pngs: Buffer[] | null;
  mode: "full" | "none";
  error?: string;
}> {
  try {
    return {
      pngs: await captureDashboardPngChunks(sub, snapshot),
      mode: "full",
    };
  } catch (err) {
    const error = storedAttemptError(errorMessage(err));
    console.error(
      `[dashboard-report] complete chunked screenshot failed for subscription ${sub.id}:`,
      error,
    );
    return { pngs: null, mode: "none", error };
  }
}

function reportDate(snapshot: ReportSnapshot): string {
  return new Date(snapshot.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function renderReportEmailHtml(
  snapshot: ReportSnapshot,
  options: {
    screenshotAttached: boolean;
    screenshotCount: number;
  },
): string {
  const title = escapeHtml(snapshot.title);
  const dashboardUrl = escapeHtml(snapshot.dashboardUrl);
  const reportSettingsUrl = escapeHtml(snapshot.reportSettingsUrl);
  const date = escapeHtml(reportDate(snapshot));
  const screenshotBlock = options.screenshotAttached
    ? Array.from(
        { length: options.screenshotCount },
        (
          _,
          index,
        ) => `<a href="${dashboardUrl}" style="display:block;text-decoration:none;">
      <img src="cid:${DASHBOARD_REPORT_CID}-${index + 1}" alt="${title}${options.screenshotCount > 1 ? ` (part ${index + 1})` : ""}" width="100%" style="display:block;width:100%;max-width:1280px;height:auto;border:0;outline:0;border-radius:0;" />
    </a>`,
      ).join("\n")
    : `<div style="margin:18px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;color:#374151;font-size:14px;line-height:1.5;">
      The dashboard image was unavailable for this run. Open the live dashboard to view the latest report.
    </div>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#171717;font-family:Inter,Arial,sans-serif;">
    <p style="margin:0 0 12px;font-size:15px;line-height:1.4;font-weight:600;">
      Here's your report of <a href="${dashboardUrl}" style="color:#2563eb;text-decoration:none;">${title}</a> for ${date}
    </p>
    ${screenshotBlock}
    <p style="margin:18px 0 0;color:#525866;font-size:13px;line-height:1.45;">
      <a href="${dashboardUrl}" style="color:#2563eb;text-decoration:none;">Open dashboard</a>
      <span style="color:#9ca3af;"> · </span>
      <a href="${reportSettingsUrl}" style="color:#2563eb;text-decoration:none;">Edit subscription settings</a>
    </p>
  </body>
</html>`;
}

function renderReportText(
  snapshot: ReportSnapshot,
  options: {
    screenshotAttached: boolean;
  },
): string {
  const lines = [
    `Daily dashboard report: ${snapshot.title}`,
    `Date: ${reportDate(snapshot)}`,
    `Open dashboard: ${snapshot.dashboardUrl}`,
    `Edit subscription settings: ${snapshot.reportSettingsUrl}`,
  ];
  if (!options.screenshotAttached) {
    lines.push("Dashboard image unavailable for this run.");
  }
  return lines.join("\n");
}

function reportFilename(title: string, part: number, total: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  const suffix = total > 1 ? `-part-${part}` : "";
  return `${slug || "dashboard"}-report${suffix}.png`;
}

export async function sendDashboardReportSubscription(
  sub: DashboardReportSubscription,
  options: {
    requireScreenshot?: boolean;
    skipEmailWithoutScreenshot?: boolean;
  } = {},
): Promise<{
  dashboardUrl: string;
  recipientCount: number;
  screenshotAttached: boolean;
  screenshotMode: "full" | "none";
  screenshotError?: string;
  emailsSent: boolean;
}> {
  const snapshot = await collectReportSnapshot(sub);
  const capture = await captureDashboardPngWithFallback(sub, snapshot);
  if (!capture.pngs && options.requireScreenshot) {
    throw new Error(
      capture.error
        ? `Dashboard screenshot unavailable: ${capture.error}`
        : "Dashboard screenshot unavailable",
    );
  }
  if (!capture.pngs && options.skipEmailWithoutScreenshot) {
    return {
      dashboardUrl: snapshot.dashboardUrl,
      recipientCount: sub.recipients.length,
      screenshotAttached: false,
      screenshotMode: capture.mode,
      emailsSent: false,
      ...(capture.error ? { screenshotError: capture.error } : {}),
    };
  }
  const screenshotAttached = Boolean(capture.pngs?.length);
  const html = renderReportEmailHtml(snapshot, {
    screenshotAttached,
    screenshotCount: capture.pngs?.length ?? 0,
  });
  const text = renderReportText(snapshot, {
    screenshotAttached,
  });
  const subject = `Daily dashboard: ${snapshot.title}`;

  for (const to of sub.recipients) {
    await sendEmail({
      to,
      subject,
      html,
      text,
      attachments: capture.pngs
        ? capture.pngs.map((png, index) => ({
            filename: reportFilename(
              snapshot.title,
              index + 1,
              capture.pngs!.length,
            ),
            content: png,
            contentType: "image/png",
            contentId: `${DASHBOARD_REPORT_CID}-${index + 1}`,
            disposition: "inline",
          }))
        : undefined,
    });
  }

  return {
    dashboardUrl: snapshot.dashboardUrl,
    recipientCount: sub.recipients.length,
    screenshotAttached,
    screenshotMode: capture.mode,
    emailsSent: true,
    ...(capture.error ? { screenshotError: capture.error } : {}),
  };
}
