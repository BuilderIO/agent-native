import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RadarQueryError,
  REPO_ROOT,
  digestRadarCampaignRecipient,
  radarJsonbParam,
  resolveRadarBigQueryEventsTable,
  resolveRadarFirstPartyBackend,
  runBigQuery,
  runPostgresQuery,
} from "./query.ts";
import { CAMPAIGN_APPS, buildCampaignFollowupSql } from "./sql.ts";
import { buildBigQueryCampaignActivitySql } from "./warehouse-sql.ts";

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  if (index < 0 || index >= items.length) return undefined;
  return items[index];
}

export interface CampaignFollowupRow {
  period: "after_send" | "prior_7_days";
  recipient_app: string;
  activity_app: string;
  metric:
    | "any_visit"
    | "campaign_landing"
    | "builder_connect_succeeded"
    | "first_output";
  recipients: number;
  recipients_with_activity: number;
}

export interface CampaignActivityAppSummary {
  period: CampaignFollowupRow["period"];
  activityApp: string;
  recipients: number;
  anyVisit: number;
  campaignLanding: number;
  builderConnectSucceeded: number;
  firstOutput: number;
}

export interface CampaignFollowupResult {
  campaign: "outage_recovery_20261026";
  sentRecipients: number;
  skippedRows: number;
  byRecipientApp: Record<string, number>;
  rows: CampaignFollowupRow[];
  observedAt: string;
}

export function summarizeCampaignByActivityApp(
  result: CampaignFollowupResult,
): CampaignActivityAppSummary[] {
  const summaries = new Map<string, CampaignActivityAppSummary>();
  const countedRecipientApps = new Map<string, Set<string>>();
  const metricKeys: Record<
    CampaignFollowupRow["metric"],
    keyof Pick<
      CampaignActivityAppSummary,
      "anyVisit" | "campaignLanding" | "builderConnectSucceeded" | "firstOutput"
    >
  > = {
    any_visit: "anyVisit",
    campaign_landing: "campaignLanding",
    builder_connect_succeeded: "builderConnectSucceeded",
    first_output: "firstOutput",
  };
  for (const row of result.rows) {
    const key = `${row.period}|${row.activity_app}`;
    const summary = summaries.get(key) ?? {
      period: row.period,
      activityApp: row.activity_app,
      recipients: 0,
      anyVisit: 0,
      campaignLanding: 0,
      builderConnectSucceeded: 0,
      firstOutput: 0,
    };
    const seenApps = countedRecipientApps.get(key) ?? new Set<string>();
    if (!seenApps.has(row.recipient_app)) {
      summary.recipients += row.recipients;
      seenApps.add(row.recipient_app);
      countedRecipientApps.set(key, seenApps);
    }
    summary[metricKeys[row.metric]] += row.recipients_with_activity;
    summaries.set(key, summary);
  }
  return [...summaries.values()].sort(
    (left, right) =>
      left.period.localeCompare(right.period) ||
      left.activityApp.localeCompare(right.activityApp),
  );
}

export interface CampaignRecipient {
  email: string;
  sent_at: string;
  app: string;
}

export function campaignPostgresParams(
  recipients: CampaignRecipient[],
  startDate: string,
  endDate: string,
  orgId: string,
): unknown[] {
  const recipientRows = recipients.map((recipient) => ({
    email: recipient.email,
    sent_at: recipient.sent_at,
    app: recipient.app,
  }));
  return [radarJsonbParam(recipientRows), startDate, endDate, orgId];
}

interface BigQueryCampaignActivityRow extends Record<string, unknown> {
  recipient_app: string;
  activity_app: string;
  period: string;
  metric: string;
  recipients_with_activity: number | string;
}

function campaignRowsFromBigQuery(
  recipients: CampaignRecipient[],
  activityRows: Record<string, unknown>[],
): CampaignFollowupRow[] {
  const recipientsByApp = new Map<string, number>();
  const activityApps = new Set<string>(CAMPAIGN_APPS);
  for (const recipient of recipients) {
    recipientsByApp.set(
      recipient.app,
      (recipientsByApp.get(recipient.app) ?? 0) + 1,
    );
    activityApps.add(recipient.app);
  }

  const activityCounts = new Map<string, number>();
  for (const rawRow of activityRows) {
    const row = rawRow as Partial<BigQueryCampaignActivityRow>;
    if (
      typeof row.activity_app !== "string" ||
      typeof row.recipient_app !== "string" ||
      typeof row.period !== "string" ||
      typeof row.metric !== "string"
    ) {
      throw new RadarQueryError(
        "BigQuery campaign query returned malformed aggregate rows.",
        1,
      );
    }
    const activityApp = normalizeApp(row.activity_app);
    const recipientApp = normalizeApp(row.recipient_app);
    const period = campaignPeriod(row.period);
    const metric = campaignMetric(row.metric);
    const count = Number(row.recipients_with_activity);
    const denominator = recipientsByApp.get(recipientApp);
    if (
      denominator === undefined ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > denominator
    ) {
      throw new RadarQueryError(
        "BigQuery campaign query returned an invalid aggregate count.",
        1,
      );
    }
    activityApps.add(activityApp);
    const key = `${period}|${recipientApp}|${activityApp}|${metric}`;
    if (activityCounts.has(key)) {
      throw new RadarQueryError(
        "BigQuery campaign query returned duplicate aggregate rows.",
        1,
      );
    }
    activityCounts.set(key, count);
  }

  const metrics: CampaignFollowupRow["metric"][] = [
    "any_visit",
    "campaign_landing",
    "builder_connect_succeeded",
    "first_output",
  ];
  const rows: CampaignFollowupRow[] = [];
  for (const [recipientApp, count] of recipientsByApp) {
    for (const activityApp of activityApps) {
      for (const period of ["after_send", "prior_7_days"] as const) {
        for (const metric of metrics) {
          const key = `${period}|${recipientApp}|${activityApp}|${metric}`;
          rows.push({
            period,
            recipient_app: recipientApp,
            activity_app: activityApp,
            metric,
            recipients: count,
            recipients_with_activity: activityCounts.get(key) ?? 0,
          });
        }
      }
    }
  }
  return rows;
}

function normalizeApp(value: string | undefined): string {
  const app = value?.trim().toLowerCase() || "unknown";
  for (const name of ["design", "slides", "clips"]) {
    if (app === `beta-${name}` || app.startsWith(`beta-${name}-`)) return name;
  }
  const withoutBeta = app.startsWith("beta-") ? app.slice("beta-".length) : app;
  const betaNormalized = withoutBeta === "plans" ? "plan" : withoutBeta;
  if (
    CAMPAIGN_APPS.includes(betaNormalized as (typeof CAMPAIGN_APPS)[number])
  ) {
    return betaNormalized;
  }
  return "other";
}

function campaignPeriod(value: unknown): CampaignFollowupRow["period"] {
  if (value === "after_send" || value === "prior_7_days") return value;
  throw new RadarQueryError("Campaign query returned an unknown period.", 1);
}

function campaignMetric(value: unknown): CampaignFollowupRow["metric"] {
  if (
    value === "any_visit" ||
    value === "campaign_landing" ||
    value === "builder_connect_succeeded" ||
    value === "first_output"
  ) {
    return value;
  }
  throw new RadarQueryError("Campaign query returned an unknown metric.", 1);
}

function campaignFilePath(): string {
  const configured = process.env.FIRST_TOUCH_RADAR_SENT_FILE;
  if (configured) return path.resolve(configured);
  const candidates = [
    path.join(REPO_ROOT, ".tmp/growth-radar/outage-email/sent.jsonl"),
    path.join(
      os.homedir(),
      "Projects/builder/agent-native/framework/.tmp/growth-radar/outage-email/sent.jsonl",
    ),
  ];
  const fallback = itemAt(candidates, 0);
  if (fallback === undefined) {
    throw new RadarQueryError(
      "Campaign recipient file path is unavailable.",
      2,
    );
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? fallback;
}

function readSentRecipients(): {
  recipients: CampaignRecipient[];
  skippedRows: number;
} {
  const file = campaignFilePath();
  let fileStat: fs.Stats;
  try {
    fileStat = fs.lstatSync(file);
  } catch {
    throw new RadarQueryError(
      "Campaign recipient file is unavailable; set FIRST_TOUCH_RADAR_SENT_FILE.",
      2,
    );
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new RadarQueryError(
      "Campaign recipient file is not a regular file.",
      2,
    );
  }
  if ((fileStat.mode & 0o077) !== 0 || (fileStat.mode & 0o400) === 0) {
    throw new RadarQueryError(
      "Campaign recipient file must be owner-readable and private.",
      2,
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    throw new RadarQueryError("Campaign recipient file is unreadable.", 2);
  }
  const recipients: CampaignRecipient[] = [];
  const seen = new Set<string>();
  try {
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      if (String(row.status) !== "202") {
        throw new RadarQueryError(
          "Campaign recipient file contains a non-accepted send row; no counts were produced.",
          2,
        );
      }
      const email =
        typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      const sentAt =
        typeof row.sent_at === "string" ? new Date(row.sent_at) : null;
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !sentAt ||
        !Number.isFinite(sentAt.getTime())
      ) {
        throw new RadarQueryError(
          "Campaign recipient file contains an invalid accepted-send row.",
          2,
        );
      }
      if (seen.has(email)) {
        throw new RadarQueryError(
          "Campaign recipient file contains a duplicate recipient; follow up needs one send time per person.",
          2,
        );
      }
      seen.add(email);
      recipients.push({
        email,
        sent_at: sentAt.toISOString(),
        app: normalizeApp(typeof row.app === "string" ? row.app : undefined),
      });
    }
  } catch (error) {
    if (error instanceof RadarQueryError) throw error;
    throw new RadarQueryError(
      "Campaign recipient file contains invalid JSON; no counts were produced.",
      2,
    );
  }
  if (recipients.length === 0) {
    throw new RadarQueryError(
      "Campaign recipient file has no accepted sends.",
      2,
    );
  }
  return { recipients, skippedRows: 0 };
}

function dateBefore(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function runCampaignFollowup(
  orgId: string,
): Promise<CampaignFollowupResult> {
  const { recipients, skippedRows } = readSentRecipients();
  const firstRecipient = itemAt(recipients, 0);
  if (!firstRecipient) {
    throw new RadarQueryError(
      "Campaign recipient file has no accepted sends.",
      2,
    );
  }
  const oldest = recipients.reduce(
    (min, recipient) => (recipient.sent_at < min ? recipient.sent_at : min),
    firstRecipient.sent_at,
  );
  const startDate = dateBefore(oldest.slice(0, 10), 7);
  const observedAt = new Date();
  const endDate = observedAt.toISOString().slice(0, 10);
  const backend = await resolveRadarFirstPartyBackend();
  const rows =
    backend.sink === "bigquery"
      ? campaignRowsFromBigQuery(
          recipients,
          (
            await runBigQuery(
              buildBigQueryCampaignActivitySql(
                await resolveRadarBigQueryEventsTable(),
              ),
              {
                params: [
                  { name: "start_date", type: "DATE", value: startDate },
                  { name: "end_date", type: "DATE", value: endDate },
                  { name: "org_id", type: "STRING", value: orgId },
                  {
                    name: "recipients_json",
                    type: "STRING",
                    value: JSON.stringify(
                      await Promise.all(
                        recipients.map(async (recipient) => ({
                          email_hash: await digestRadarCampaignRecipient(
                            recipient.email,
                          ),
                          sent_at: recipient.sent_at,
                          recipient_app: recipient.app,
                        })),
                      ),
                    ),
                  },
                  {
                    name: "observed_at",
                    type: "TIMESTAMP",
                    value: observedAt.toISOString(),
                  },
                ],
                fresh: true,
                cache: false,
              },
            )
          ).rows,
        )
      : (
          await runPostgresQuery(
            buildCampaignFollowupSql(),
            campaignPostgresParams(recipients, startDate, endDate, orgId),
            { fresh: true, cache: false },
          )
        ).rows;
  const byRecipientApp: Record<string, number> = {};
  const aggregateRows = rows.map((row) => {
    const recipientApp = String(row.recipient_app ?? "unknown");
    byRecipientApp[recipientApp] = Number(row.recipients ?? 0);
    return {
      period: campaignPeriod(row.period),
      recipient_app: recipientApp,
      activity_app: String(row.activity_app ?? "unknown"),
      metric: campaignMetric(row.metric),
      recipients: Number(row.recipients ?? 0),
      recipients_with_activity: Number(row.recipients_with_activity ?? 0),
    };
  });
  if (aggregateRows.length === 0) {
    throw new RadarQueryError(
      "Campaign query returned no aggregate rows for its recipient cohort.",
      1,
    );
  }
  return {
    campaign: "outage_recovery_20261026",
    sentRecipients: recipients.length,
    skippedRows,
    byRecipientApp,
    rows: aggregateRows,
    observedAt: observedAt.toISOString(),
  };
}
