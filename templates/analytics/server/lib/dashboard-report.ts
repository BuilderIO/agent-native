import { getAppProductionUrl, sendEmail } from "@agent-native/core/server";

import { listReportablePanelIds } from "../../app/pages/adhoc/sql-dashboard/report-panel-window";
import type {
  DashboardFilter,
  FilterType,
  SqlDashboardConfig,
} from "../../app/pages/adhoc/sql-dashboard/types";
import {
  fetchReportPanelData,
  renderReportEmail,
  type ReportSnapshot,
} from "./dashboard-report-render";
import {
  getReportDashboard,
  normalizeDashboardReportRecipients,
  type AccessCtx,
  type DashboardReportCaptureOutcome,
  type DashboardReportSubscription,
} from "./dashboard-report-subscriptions";
import { ANALYTICS_DASHBOARD_REPORT_EMAIL_ID } from "./emails";

const DATE_FILTER_TYPES: ReadonlySet<FilterType> = new Set([
  "date",
  "date-range",
  "toggle-date",
]);
const DASHBOARD_REPORT_SETTINGS_PARAM = "reportSettings";
const DASHBOARD_REPORT_EMAIL_TIMEOUT_MS = 10_000;
const DASHBOARD_REPORT_EMAIL_OVERHEAD_RESERVE_MS = 5_000;

export type DashboardReportMode = "complete" | "degraded";

export type DashboardReportResult = {
  dashboardUrl: string;
  recipientCount: number;
  reportMode: DashboardReportMode;
  degradedPanelIds: string[];
  reportError?: string;
  emailsSent: boolean;
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

function buildDashboardUrl(
  dashboardId: string,
  filters: Record<string, string>,
  options?: { reportSettings?: boolean },
): string {
  const url = new URL(
    `/dashboards/${encodeURIComponent(dashboardId)}`,
    "https://agent-native.invalid/",
  );
  for (const [key, value] of Object.entries(filters)) {
    if (value) url.searchParams.set(key, value);
  }
  if (options?.reportSettings) {
    url.searchParams.set(DASHBOARD_REPORT_SETTINGS_PARAM, "1");
  }
  return new URL(
    `${url.pathname}${url.search}`,
    `${dashboardBaseUrl()}/`,
  ).toString();
}

export async function collectReportSnapshot(
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
    panelIds: listReportablePanelIds(config.panels),
    panels: config.panels,
    variables: config.variables,
  };
}

function reportDeliveryReserveMs(recipientCount: number): number {
  return (
    recipientCount * DASHBOARD_REPORT_EMAIL_TIMEOUT_MS +
    DASHBOARD_REPORT_EMAIL_OVERHEAD_RESERVE_MS
  );
}

async function runWithinReportDeadline<T>(
  label: string,
  operation: () => Promise<T>,
  deadlineAt?: number,
): Promise<T> {
  if (!deadlineAt) return operation();
  const timeoutMs = deadlineAt - Date.now();
  if (timeoutMs <= 0)
    throw new Error(`${label} exceeded the report delivery deadline`);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`${label} exceeded the report delivery deadline`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function reportDate(snapshot: ReportSnapshot): string {
  return new Date(snapshot.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * Renders and emails one dashboard report entirely on the server: each panel's
 * query runs through the same source dispatcher the UI uses, charts are drawn
 * as SVG and rasterized, and everything else becomes real email HTML.
 *
 * There is deliberately no headless browser here. The previous implementation
 * screenshotted the live React dashboard in 4-panel chunks inside one
 * serverless invocation, so a single slow panel abandoned every later chunk and
 * shipped an email full of "image part N was unavailable" placeholders. Do not
 * reintroduce a browser, a chunk loop, or a mode that emails a report the
 * caller cannot tell apart from a complete one.
 */
export async function sendDashboardReportSubscription(
  sub: DashboardReportSubscription,
  options: {
    skipEmailWhenDegraded?: boolean;
    deadlineAt?: number;
    onCaptureOutcome?: (
      outcome: DashboardReportCaptureOutcome,
    ) => Promise<void>;
  } = {},
): Promise<DashboardReportResult> {
  const recipients = normalizeDashboardReportRecipients(sub.recipients);
  const snapshot = await runWithinReportDeadline(
    "Dashboard report snapshot",
    () => collectReportSnapshot(sub),
    options.deadlineAt,
  );

  const emailReserveMs = reportDeliveryReserveMs(recipients.length);
  const panelData = await fetchReportPanelData({
    ownerEmail: sub.ownerEmail,
    orgId: sub.orgId,
    snapshot,
    ...(options.deadlineAt
      ? { deadlineAt: options.deadlineAt - emailReserveMs }
      : {}),
  });

  // Only panels that were actually queried can vote on total failure. Counting
  // never-queryable panels (extensions) as survivors would let a dashboard of
  // pure placeholders pass this guard and ship as "complete".
  const attemptedPanelIds = [...panelData.keys()].filter(
    (panelId) => panelData.get(panelId)?.status !== "not-emailable",
  );
  const failedPanelIds = attemptedPanelIds.filter((panelId) => {
    const data = panelData.get(panelId);
    return (
      data?.status === "query-failed" || data?.status === "missing-credential"
    );
  });
  if (
    attemptedPanelIds.length > 0 &&
    failedPanelIds.length === attemptedPanelIds.length
  ) {
    const firstError = failedPanelIds
      .map((panelId) => {
        const data = panelData.get(panelId);
        return data && "message" in data ? data.message : "";
      })
      .find(Boolean);
    await options.onCaptureOutcome?.({
      mode: "none",
      error: `every dashboard panel failed to load: ${firstError ?? "unknown error"}`,
    });
    throw new Error(
      `Dashboard report has no usable data: every one of ${attemptedPanelIds.length} panels failed (${firstError ?? "unknown error"})`,
    );
  }

  const rendered = await runWithinReportDeadline(
    "Dashboard report rendering",
    () => renderReportEmail({ snapshot, panelData }),
    options.deadlineAt ? options.deadlineAt - emailReserveMs : undefined,
  );
  // A dashboard whose only reportable panels are extensions renders nothing but
  // "open the dashboard" links. Nothing failed, so degradedPanelIds is empty —
  // but the report is not backed by data and must not claim to be complete. A
  // section-only dashboard (panelData empty) has nothing to render and is fine.
  const noPanelBackedByData =
    panelData.size > 0 && attemptedPanelIds.length === 0;
  const reportMode: DashboardReportMode =
    rendered.degradedPanelIds.length || noPanelBackedByData
      ? "degraded"
      : "complete";
  const reportError = rendered.degradedPanelIds.length
    ? `${rendered.degradedPanelIds.length} of ${panelData.size} panels could not be rendered: ${rendered.degradedPanelIds.join(", ")}`
    : noPanelBackedByData
      ? "No panel in this dashboard can be rendered into an email"
      : undefined;

  await options.onCaptureOutcome?.({
    mode: reportMode === "complete" ? "full" : "partial",
    ...(reportError ? { error: reportError } : {}),
  });

  if (reportMode === "degraded" && options.skipEmailWhenDegraded) {
    return {
      dashboardUrl: snapshot.dashboardUrl,
      recipientCount: recipients.length,
      reportMode,
      degradedPanelIds: rendered.degradedPanelIds,
      emailsSent: false,
      ...(reportError ? { reportError } : {}),
    };
  }

  const subject = `Daily dashboard: ${snapshot.title} — ${reportDate(snapshot)}`;
  for (const to of recipients) {
    const emailTimeoutMs = options.deadlineAt
      ? Math.min(
          DASHBOARD_REPORT_EMAIL_TIMEOUT_MS,
          options.deadlineAt - Date.now(),
        )
      : DASHBOARD_REPORT_EMAIL_TIMEOUT_MS;
    if (emailTimeoutMs <= 0) {
      throw new Error(
        "Dashboard email delivery exceeded the report delivery deadline",
      );
    }
    await sendEmail({
      to,
      subject,
      html: rendered.html,
      text: rendered.text,
      ...(rendered.attachments.length
        ? { attachments: rendered.attachments }
        : {}),
      timeoutMs: emailTimeoutMs,
      templateId: ANALYTICS_DASHBOARD_REPORT_EMAIL_ID,
    });
  }

  return {
    dashboardUrl: snapshot.dashboardUrl,
    recipientCount: recipients.length,
    reportMode,
    degradedPanelIds: rendered.degradedPanelIds,
    emailsSent: true,
    ...(reportError ? { reportError } : {}),
  };
}
