import { existsSync } from "node:fs";

import {
  getAppProductionUrl,
  sendEmail,
  signEmbedSessionToken,
} from "@agent-native/core/server";
import {
  EMBED_MODE_QUERY_PARAM,
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
const SERVERLESS_SCREENSHOT_TIMEOUT_MS = 60_000;
const SERVERLESS_SECOND_READY_TIMEOUT_MS = 30_000;
const MAX_SCREENSHOT_VIEWPORT_HEIGHT = 30_000;
const SCREENSHOT_VIEWPORT_PADDING = 64;

type DashboardScreenshotAttempt = {
  label: "full" | "full-lightweight";
  viewport: { width: number; height: number };
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

async function launchScreenshotBrowser() {
  const { chromium: playwright } = await import("playwright-core");
  const localExecutablePath = localChromiumExecutablePath();
  if (localExecutablePath) {
    return playwright.launch({
      executablePath: localExecutablePath,
      headless: true,
    });
  }

  if (isServerlessBrowserRuntime()) {
    const { default: chromium } = await import("@sparticuz/chromium-min");
    chromium.setGraphicsMode = false;
    const packUrl =
      process.env.DASHBOARD_REPORT_CHROMIUM_PACK_URL?.trim() ||
      DEFAULT_SERVERLESS_CHROMIUM_PACK_URL;
    return playwright.launch({
      args: [
        ...chromium.args,
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
      executablePath: await chromium.executablePath(packUrl),
      headless: true,
    });
  }

  return playwright.launch({ headless: true });
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

async function fitViewportToDashboardCapture(
  page: any,
  capture: any,
  minViewport: { width: number; height: number },
): Promise<void> {
  const box = await capture.boundingBox();
  if (!box) return;

  const size = {
    width: Math.max(
      minViewport.width,
      Math.min(1800, Math.ceil(box.width + SCREENSHOT_VIEWPORT_PADDING)),
    ),
    height: Math.max(
      minViewport.height,
      Math.min(
        MAX_SCREENSHOT_VIEWPORT_HEIGHT,
        Math.ceil(box.height + SCREENSHOT_VIEWPORT_PADDING),
      ),
    ),
  };
  await page.setViewportSize(size);
  await page.waitForTimeout(250);

  const resizedBox = await capture.boundingBox();
  if (!resizedBox) return;
  const resizedHeight = Math.ceil(
    resizedBox.height + SCREENSHOT_VIEWPORT_PADDING,
  );
  if (resizedHeight > size.height) {
    await page.setViewportSize({
      width: size.width,
      height: Math.min(MAX_SCREENSHOT_VIEWPORT_HEIGHT, resizedHeight),
    });
    await page.waitForTimeout(250);
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

  const browser = await launchScreenshotBrowser();
  try {
    const timeout = screenshotTimeoutMs();
    const page = await browser.newPage({
      viewport: attempt.viewport,
      deviceScaleFactor: 1,
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

    const capture = page.locator("[data-dashboard-report-capture]");
    await capture.waitFor({ state: "visible", timeout });
    await waitForDashboardReportReady(page, timeout);
    await scrollDashboardForLazyRendering(page);
    await waitForDashboardReportReady(page, secondReadyTimeoutMs());

    await fitViewportToDashboardCapture(page, capture, attempt.viewport);
    await capture.scrollIntoViewIfNeeded();
    const image = await capture.screenshot({
      type: "png",
      animations: "disabled",
    });
    if (!image?.length) {
      throw new Error("Dashboard screenshot was empty");
    }
    return Buffer.from(image);
  } finally {
    await browser.close();
  }
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(
    new RegExp(`(${EMBED_TOKEN_QUERY_PARAM}=)[^&\\s]+`, "g"),
    "$1[REDACTED]",
  );
}

async function captureDashboardPngWithFallback(
  sub: DashboardReportSubscription,
  snapshot: ReportSnapshot,
): Promise<{
  png: Buffer | null;
  mode: "full" | "full-lightweight" | "none";
  error?: string;
}> {
  const attempts: DashboardScreenshotAttempt[] = [
    { label: "full", viewport: { width: 1440, height: 1800 } },
    { label: "full-lightweight", viewport: { width: 1200, height: 1400 } },
  ];
  let lastError: string | undefined;

  for (const attempt of attempts) {
    try {
      return {
        png: await captureDashboardPng(sub, snapshot, attempt),
        mode: attempt.label,
      };
    } catch (err) {
      lastError = errorMessage(err);
      console.error(
        `[dashboard-report] ${attempt.label} screenshot failed for subscription ${sub.id}:`,
        lastError,
      );
    }
  }

  return { png: null, mode: "none", error: lastError };
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
  options: { screenshotAttached: boolean },
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
  options: { screenshotAttached: boolean },
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
  options: { requireScreenshot?: boolean } = {},
): Promise<{
  dashboardUrl: string;
  recipientCount: number;
  screenshotAttached: boolean;
  screenshotMode: "full" | "full-lightweight" | "none";
  screenshotError?: string;
}> {
  const snapshot = await collectReportSnapshot(sub);
  const capture = await captureDashboardPngWithFallback(sub, snapshot);
  if (!capture.png && options.requireScreenshot) {
    throw new Error(
      capture.error
        ? `Dashboard screenshot unavailable: ${capture.error}`
        : "Dashboard screenshot unavailable",
    );
  }
  const screenshotAttached = Boolean(capture.png);
  const html = renderReportEmailHtml(snapshot, { screenshotAttached });
  const text = renderReportText(snapshot, { screenshotAttached });
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
    ...(capture.error ? { screenshotError: capture.error } : {}),
  };
}
