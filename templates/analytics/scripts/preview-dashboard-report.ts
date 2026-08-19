#!/usr/bin/env tsx

/**
 * Render a real dashboard email report to local files without sending anything.
 *
 * This is the proof-of-delivery check for the server-rendered report pipeline:
 * it runs the same panel queries and the same email renderer the scheduler
 * uses, then writes the HTML plus every inline chart PNG to disk with the
 * `cid:` references rewritten to local paths so the result opens in a browser
 * exactly as a mail client would compose it.
 *
 * Read-only: it never calls sendEmail and never runs migrations.
 *
 *   pnpm --filter analytics exec tsx --env-file=.env scripts/preview-dashboard-report.ts
 *   pnpm --filter analytics exec tsx --env-file=.env scripts/preview-dashboard-report.ts --subscription <id> --out /tmp/report
 *   pnpm --filter analytics exec tsx --env-file=.env scripts/preview-dashboard-report.ts --dashboard <id> --out /tmp/report
 *
 * Exits non-zero when any panel degraded, so it works as a check.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index";
import { collectReportSnapshot } from "../server/lib/dashboard-report";
import {
  fetchReportPanelData,
  renderReportEmail,
} from "../server/lib/dashboard-report-render";
import {
  getDashboardReportSubscription,
  type DashboardReportSubscription,
} from "../server/lib/dashboard-report-subscriptions";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Renders any dashboard, not just a subscribed one, so panel types and sources
 * the single real subscription never exercises can still be verified. Scoped to
 * the dashboard's own owner so `getReportDashboard`'s access check is the same
 * one the scheduler goes through.
 */
async function subscriptionForDashboard(
  dashboardId: string,
): Promise<DashboardReportSubscription> {
  const db = getDb() as any;
  const [row] = await db
    .select({
      id: schema.dashboards.id,
      title: schema.dashboards.title,
      ownerEmail: schema.dashboards.ownerEmail,
      orgId: schema.dashboards.orgId,
    })
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, dashboardId));
  if (!row) throw new Error(`Dashboard ${dashboardId} not found`);

  const now = new Date().toISOString();
  return {
    id: `preview-${dashboardId}`,
    dashboardId,
    name: row.title ?? dashboardId,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    recipients: ["preview@example.invalid"],
    filters: {},
    frequency: "daily",
    timeOfDay: "09:00",
    timezone: "UTC",
    enabled: false,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    lastCaptureAt: null,
    lastCaptureMode: null,
    lastCaptureError: null,
    createdAt: now,
    updatedAt: now,
  } as DashboardReportSubscription;
}

async function main() {
  const outDir = arg("out") ?? join(process.cwd(), ".report-preview");
  const wantedId = arg("subscription");
  const wantedDashboard = arg("dashboard");

  if (wantedDashboard) {
    await renderPreview(
      await subscriptionForDashboard(wantedDashboard),
      outDir,
    );
    return;
  }

  const db = getDb() as any;
  const rows = await db
    .select({
      id: schema.dashboardReportSubscriptions.id,
      ownerEmail: schema.dashboardReportSubscriptions.ownerEmail,
      orgId: schema.dashboardReportSubscriptions.orgId,
      enabled: schema.dashboardReportSubscriptions.enabled,
    })
    .from(schema.dashboardReportSubscriptions)
    .limit(25);
  if (!rows.length) {
    throw new Error(
      "No dashboard_report_subscriptions rows found for this DATABASE_URL.",
    );
  }
  const target = wantedId
    ? rows.find((row: any) => row.id === wantedId)
    : (rows.find((row: any) => row.enabled) ?? rows[0]);
  if (!target) {
    throw new Error(
      `Subscription ${wantedId} not found. Available: ${rows.map((r: any) => r.id).join(", ")}`,
    );
  }
  // Load through the access-checked reader so JSON columns (recipients,
  // filters) arrive parsed exactly as the scheduler sees them.
  const sub = await getDashboardReportSubscription(target.id, {
    email: target.ownerEmail,
    orgId: target.orgId,
  });
  if (!sub) {
    throw new Error(
      `Subscription ${target.id} is not readable as ${target.ownerEmail}`,
    );
  }

  await renderPreview(sub, outDir);
}

async function renderPreview(
  sub: DashboardReportSubscription,
  outDir: string,
): Promise<void> {
  console.log(
    `[preview] subscription=${sub.id} dashboard=${sub.dashboardId} owner=${sub.ownerEmail} org=${sub.orgId ?? "none"}`,
  );

  const startedAt = Date.now();
  const { snapshot, panelData, rendered } = await runWithRequestContext(
    { userEmail: sub.ownerEmail, orgId: sub.orgId ?? undefined },
    async () => {
      const snapshot = await collectReportSnapshot(sub);
      console.log(
        `[preview] "${snapshot.title}" — ${snapshot.panelIds.length} reportable panels, filters=${JSON.stringify(snapshot.filters)}`,
      );
      const panelData = await fetchReportPanelData({
        ownerEmail: sub.ownerEmail,
        orgId: sub.orgId,
        snapshot,
      });
      const rendered = await renderReportEmail({ snapshot, panelData });
      return { snapshot, panelData, rendered };
    },
  );
  const elapsedMs = Date.now() - startedAt;

  console.log(`\n[preview] per-panel outcome:`);
  const counts = new Map<string, number>();
  for (const panel of snapshot.panels) {
    const data = panelData.get(panel.id);
    const status = data?.status ?? "not-queried";
    counts.set(status, (counts.get(status) ?? 0) + 1);
    const detail =
      data && data.status === "rows"
        ? `${data.rows.length} rows`
        : data && "message" in data
          ? data.message
          : "";
    console.log(
      `  ${status.padEnd(20)} ${panel.chartType.padEnd(10)} ${panel.title ?? panel.id} ${detail ? `— ${detail}` : ""}`,
    );
  }

  await mkdir(outDir, { recursive: true });
  let html = rendered.html;
  let inlineHtml = rendered.html;
  for (const attachment of rendered.attachments) {
    await writeFile(join(outDir, attachment.filename), attachment.content);
    html = html.split(`cid:${attachment.contentId}`).join(attachment.filename);
    inlineHtml = inlineHtml
      .split(`cid:${attachment.contentId}`)
      .join(
        `data:${attachment.contentType};base64,${attachment.content.toString("base64")}`,
      );
  }
  await writeFile(join(outDir, "report.html"), html, "utf8");
  await writeFile(join(outDir, "report-standalone.html"), inlineHtml, "utf8");
  await writeFile(join(outDir, "report.txt"), rendered.text, "utf8");

  const totalBytes = rendered.attachments.reduce(
    (sum, a) => sum + a.content.length,
    0,
  );
  console.log(`\n[preview] summary`);
  for (const [status, count] of [...counts].sort()) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  images: ${rendered.attachments.length} (${totalBytes} bytes)`);
  console.log(
    `  degraded panels: ${rendered.degradedPanelIds.length ? rendered.degradedPanelIds.join(", ") : "none"}`,
  );
  console.log(`  render time: ${elapsedMs}ms`);
  console.log(`\n[preview] open ${join(outDir, "report.html")}`);

  if (rendered.degradedPanelIds.length) process.exitCode = 1;
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error("[preview] failed:", err);
    process.exit(1);
  });
}
