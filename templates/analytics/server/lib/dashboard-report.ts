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
const LOCAL_SCREENSHOT_TIMEOUT_MS = 90_000;
const SERVERLESS_SCREENSHOT_TIMEOUT_MS = 90_000;
const SERVERLESS_SECOND_READY_TIMEOUT_MS = 45_000;
// Keep enough room under Netlify's 300s background-function limit for the
// bounded browser-close/profile-cleanup steps after each failed attempt and
// for the final email send. The three attempts total 225s; cleanup can spend
// up to 60s, leaving a small delivery buffer.
const SERVERLESS_FULL_ATTEMPT_TIMEOUT_MS = 110_000;
const SERVERLESS_LIGHTWEIGHT_ATTEMPT_TIMEOUT_MS = 70_000;
const BROWSER_CLEANUP_TIMEOUT_MS = 10_000;
const SCREENSHOT_VIEWPORT_PADDING = 64;

type DashboardScreenshotAttempt = {
  label: "full" | "full-lightweight" | "limited";
  viewport: { width: number; height: number };
  captureScale?: number;
  readyTimeout?: number;
  secondReadyTimeout?: number;
  totalTimeout?: number;
  reportPanelLimit?: number;
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
): Promise<void> {
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

async function captureDashboardPng(
  sub: DashboardReportSubscription,
  snapshot: ReportSnapshot,
  attempt: DashboardScreenshotAttempt,
): Promise<Buffer> {
  const targetPath = buildDashboardPath(
    snapshot.dashboardId,
    snapshot.filters,
    {
      reportScreenshot: true,
    },
  );
  const token = signEmbedSessionToken({
    ownerEmail: sub.ownerEmail,
    orgId: sub.orgId,
    targetPath,
    scope: `dashboard-report-screenshot:${sub.id}`,
    ttlSeconds: 5 * 60,
  });
  const screenshotUrl = new URL(targetPath, `${dashboardBaseUrl()}/`);
  screenshotUrl.searchParams.set(EMBED_MODE_QUERY_PARAM, "1");
  screenshotUrl.searchParams.set(EMBED_TOKEN_QUERY_PARAM, token);
  if (attempt.reportPanelLimit) {
    screenshotUrl.searchParams.set(
      "reportPanelLimit",
      String(attempt.reportPanelLimit),
    );
  }

  let browser: any;
  let cleanup = async () => {};
  let newPage = async (): Promise<any> => {
    throw new Error("Screenshot browser did not provide a page factory");
  };
  let launchPromise: Promise<LaunchedScreenshotBrowser> | undefined;
  let launchTimeout: ReturnType<typeof setTimeout> | undefined;
  let captureStage = "launching the screenshot browser";
  let attemptTimedOut = false;
  let lastDiagnostics: string | null = null;
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
            launchTimeout = setTimeout(() => {
              attemptTimedOut = true;
              reject(
                new Error(
                  `${attempt.label} browser launch exceeded ${attempt.totalTimeout}ms`,
                ),
              );
            }, attempt.totalTimeout);
          }),
        ])
      : await launchPromise;
    browser = launched.browser;
    cleanup = launched.cleanup;
    newPage = launched.newPage;
    if (attemptTimedOut) {
      throw new Error("Screenshot browser launch exceeded attempt timeout");
    }

    const timeout = screenshotTimeoutMs();
    const page = await newPage();

    // Belt-and-braces auth: the query token authenticates only after the
    // client-side bootstrap harvests it from the URL, which gives the
    // stripped-down serverless browser several ways to end up session-less.
    // Seeding the same signed token as a cookie authenticates every request
    // server-side with no client cooperation. Never abort the capture over
    // this — the query token path still exists.
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

    // Bounded diagnostics collectors so a failed wait carries evidence of
    // wrong-page/wedged-renderer/auth-bounce instead of a bare timeout.
    const consoleErrors: string[] = [];
    page.on("console", (msg: any) => {
      if (msg.type() !== "error") return;
      if (consoleErrors.length >= DIAGNOSTICS_COLLECTOR_LIMIT) return;
      consoleErrors.push(msg.text().slice(0, 160));
    });
    const failedRequests: string[] = [];
    page.on("requestfailed", (req: any) => {
      if (failedRequests.length >= DIAGNOSTICS_COLLECTOR_LIMIT) return;
      failedRequests.push(
        `${req.method()} ${req.url().slice(0, 120)}: ${req.failure()?.errorText ?? "failed"}`,
      );
    });
    page.on("response", (res: any) => {
      if (res.status() < 400) return;
      if (failedRequests.length >= DIAGNOSTICS_COLLECTOR_LIMIT) return;
      failedRequests.push(
        `${res.request().method()} ${res.url().slice(0, 120)}: HTTP ${res.status()}`,
      );
    });

    page.setDefaultTimeout(timeout);
    await page.emulateMedia({ media: "screen", colorScheme: "light" });
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "light");
    });
    await page.goto(screenshotUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout,
    });

    captureStage = "waiting for the report surface";
    const capture = page.locator("[data-dashboard-report-capture]");
    try {
      await capture.waitFor({ state: "visible", timeout });
    } catch (err) {
      lastDiagnostics = errorMessage(
        await collectPageDiagnostics(page, consoleErrors, failedRequests),
      );
      throw new Error(`${errorMessage(err)}; ${lastDiagnostics}`);
    }
    captureStage = "waiting for dashboard queries";
    await waitForDashboardReportReady(page, attempt.readyTimeout ?? timeout);
    captureStage = "rendering lazy dashboard panels";
    await scrollDashboardForLazyRendering(page);
    captureStage = "waiting for lazy dashboard panels";
    await waitForDashboardReportReady(
      page,
      attempt.secondReadyTimeout ?? secondReadyTimeoutMs(),
    );

    captureStage = "sizing the dashboard capture";
    await fitViewportWidthToDashboardCapture(page, capture, attempt.viewport);
    await scaleDashboardCapture(page, attempt.captureScale);
    await capture.scrollIntoViewIfNeeded();
    captureStage = "rasterizing the dashboard PNG";
    const image = await capture.screenshot({
      type: "png",
      animations: "disabled",
    });
    if (!image?.length) {
      throw new Error("Dashboard screenshot was empty");
    }
    return Buffer.from(image);
  } catch (err) {
    if (attemptTimedOut) {
      throw new Error(
        `${attempt.label} capture exceeded ${attempt.totalTimeout}ms while ${captureStage}` +
          (lastDiagnostics ? `; ${lastDiagnostics}` : ""),
      );
    }
    throw new Error(`${captureStage}: ${errorMessage(err)}`);
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
        () => {
          // The launch rejection was already handled by the race above.
        },
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
  options?: { includeLimitedFallback?: boolean },
): Promise<{
  png: Buffer | null;
  mode: "full" | "full-lightweight" | "limited" | "none";
  error?: string;
}> {
  const serverless = isServerlessBrowserRuntime();
  const attempts: DashboardScreenshotAttempt[] = [
    {
      label: "full",
      viewport: { width: 1440, height: 1800 },
      captureScale: 0.85,
      ...(serverless
        ? {
            secondReadyTimeout: 25_000,
            totalTimeout: SERVERLESS_FULL_ATTEMPT_TIMEOUT_MS,
          }
        : {}),
    },
    {
      label: "full-lightweight",
      viewport: { width: 1200, height: 1400 },
      captureScale: 0.7,
      ...(serverless
        ? {
            readyTimeout: 55_000,
            secondReadyTimeout: 15_000,
            totalTimeout: SERVERLESS_LIGHTWEIGHT_ATTEMPT_TIMEOUT_MS,
          }
        : {}),
    },
  ];
  if (options?.includeLimitedFallback) {
    // Only added on the final sweep after the 1-hour retry window, when the
    // alternative is a no-image fallback email. All three serverless attempt
    // totalTimeouts sum to 225s, leaving room for bounded cleanup and email
    // delivery under the 300s Netlify background-function timeout.
    attempts.push({
      label: "limited",
      viewport: { width: 1200, height: 1400 },
      captureScale: 0.7,
      reportPanelLimit: 8,
      ...(serverless
        ? {
            readyTimeout: 40_000,
            secondReadyTimeout: 10_000,
            totalTimeout: 45_000,
          }
        : {}),
    });
  }
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const png = await captureDashboardPng(sub, snapshot, attempt);
      return {
        png,
        mode: attempt.label,
        ...(errors.length ? { error: errors.join(" | ") } : {}),
      };
    } catch (err) {
      const attemptError = errorMessage(err);
      errors.push(`${attempt.label}: ${storedAttemptError(attemptError)}`);
      console.error(
        `[dashboard-report] ${attempt.label} screenshot failed for subscription ${sub.id}:`,
        attemptError,
      );
    }
  }

  return {
    png: null,
    mode: "none",
    ...(errors.length ? { error: errors.join(" | ") } : {}),
  };
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
    screenshotMode: "full" | "full-lightweight" | "limited" | "none";
  },
): string {
  const title = escapeHtml(snapshot.title);
  const dashboardUrl = escapeHtml(snapshot.dashboardUrl);
  const reportSettingsUrl = escapeHtml(snapshot.reportSettingsUrl);
  const date = escapeHtml(reportDate(snapshot));
  const screenshotBlock = options.screenshotAttached
    ? `<a href="${dashboardUrl}" style="display:block;text-decoration:none;">
      <img src="cid:${DASHBOARD_REPORT_CID}" alt="${title}" width="100%" style="display:block;width:100%;max-width:1280px;height:auto;border:0;outline:0;border-radius:0;" />
    </a>`
    : `<div style="margin:18px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;color:#374151;font-size:14px;line-height:1.5;">
      The dashboard image was unavailable for this run. Open the live dashboard to view the latest report.
    </div>`;
  const limitedScreenshotNotice =
    options.screenshotMode === "limited"
      ? `<div style="margin:12px 0 0;padding:12px 14px;border:1px solid #f3c46b;border-radius:8px;background:#fff8e6;color:#6b4f14;font-size:13px;line-height:1.45;">
      This is a limited fallback image and may omit some dashboard panels. <a href="${dashboardUrl}" style="color:#2563eb;text-decoration:none;">Open the full dashboard</a> to see every panel.
    </div>`
      : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff;color:#171717;font-family:Inter,Arial,sans-serif;">
    <p style="margin:0 0 12px;font-size:15px;line-height:1.4;font-weight:600;">
      Here's your report of <a href="${dashboardUrl}" style="color:#2563eb;text-decoration:none;">${title}</a> for ${date}
    </p>
    ${screenshotBlock}
    ${limitedScreenshotNotice}
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
    screenshotMode: "full" | "full-lightweight" | "limited" | "none";
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
  if (options.screenshotMode === "limited") {
    lines.push(
      `This is a limited fallback image and may omit some dashboard panels. Open the full dashboard: ${snapshot.dashboardUrl}`,
    );
  }
  return lines.join("\n");
}

function reportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `${slug || "dashboard"}-report.png`;
}

export async function sendDashboardReportSubscription(
  sub: DashboardReportSubscription,
  options: {
    requireScreenshot?: boolean;
    skipEmailWithoutScreenshot?: boolean;
    allowLimitedFallback?: boolean;
  } = {},
): Promise<{
  dashboardUrl: string;
  recipientCount: number;
  screenshotAttached: boolean;
  screenshotMode: "full" | "full-lightweight" | "limited" | "none";
  screenshotError?: string;
  emailsSent: boolean;
}> {
  const snapshot = await collectReportSnapshot(sub);
  const capture = await captureDashboardPngWithFallback(sub, snapshot, {
    includeLimitedFallback: options?.allowLimitedFallback,
  });
  if (!capture.png && options.requireScreenshot) {
    throw new Error(
      capture.error
        ? `Dashboard screenshot unavailable: ${capture.error}`
        : "Dashboard screenshot unavailable",
    );
  }
  if (!capture.png && options.skipEmailWithoutScreenshot) {
    return {
      dashboardUrl: snapshot.dashboardUrl,
      recipientCount: sub.recipients.length,
      screenshotAttached: false,
      screenshotMode: capture.mode,
      emailsSent: false,
      ...(capture.error ? { screenshotError: capture.error } : {}),
    };
  }
  const screenshotAttached = Boolean(capture.png);
  const html = renderReportEmailHtml(snapshot, {
    screenshotAttached,
    screenshotMode: capture.mode,
  });
  const text = renderReportText(snapshot, {
    screenshotAttached,
    screenshotMode: capture.mode,
  });
  const subject = `Daily dashboard: ${snapshot.title}`;

  for (const to of sub.recipients) {
    await sendEmail({
      to,
      subject,
      html,
      text,
      attachments: capture.png
        ? [
            {
              filename: reportFilename(snapshot.title),
              content: capture.png,
              contentType: "image/png",
              contentId: DASHBOARD_REPORT_CID,
              disposition: "inline",
            },
          ]
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
