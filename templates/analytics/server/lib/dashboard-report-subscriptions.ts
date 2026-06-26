import { randomUUID } from "node:crypto";

import { recordChange } from "@agent-native/core/server";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { loadDashboardSeed } from "./dashboard-seeds";
import { getDashboard } from "./dashboards-store";

export interface ReportSubscriptionInput {
  id?: string;
  dashboardId: string;
  name?: string;
  recipients: string[];
  filters?: Record<string, string>;
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
}

export interface DashboardReportSubscription {
  id: string;
  dashboardId: string;
  name: string;
  recipients: string[];
  filters: Record<string, string>;
  frequency: "daily";
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "success" | "error" | "running" | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
}

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

export interface ReportDashboard {
  id: string;
  title: string;
  config: Record<string, unknown>;
}

export async function getReportDashboard(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<ReportDashboard | null> {
  const dashboard = await getDashboard(dashboardId, ctx);
  if (dashboard?.kind === "sql") {
    return {
      id: dashboard.id,
      title: dashboard.title,
      config: dashboard.config,
    };
  }

  const seed = loadDashboardSeed(dashboardId);
  if (!seed) return null;
  return {
    id: dashboardId,
    title:
      typeof seed.name === "string" && seed.name.trim()
        ? seed.name.trim()
        : dashboardId,
    config: seed,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeRecipients(recipients: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of recipients) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
}

function normalizeFilters(filters: Record<string, string> | undefined) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    const k = key.trim();
    const v = String(value ?? "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function assertTimeOfDay(value: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error("timeOfDay must be HH:mm");
  return value;
}

function assertTimezone(value: string): string {
  const timezone = value.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function calendarDayAfter(parts: { year: number; month: number; day: number }) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function zonedTimeToUtc(
  parts: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    0,
  );
  let guess = targetUtc;
  for (let i = 0; i < 4; i++) {
    const actual = getZonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const diff = actualAsUtc - targetUtc;
    if (Math.abs(diff) < 1000) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function nextDailyRunAt(
  timeOfDay: string,
  timeZone: string,
  from: Date = new Date(),
): string {
  const [hour, minute] = assertTimeOfDay(timeOfDay).split(":").map(Number);
  const timezone = assertTimezone(timeZone);
  const today = getZonedParts(from, timezone);
  let candidate = zonedTimeToUtc(today, hour, minute, timezone);
  if (candidate.getTime() <= from.getTime() + 30_000) {
    candidate = zonedTimeToUtc(calendarDayAfter(today), hour, minute, timezone);
  }
  return candidate.toISOString();
}

function rowToSubscription(row: any): DashboardReportSubscription {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    name: row.name,
    recipients: safeJsonParse<string[]>(row.recipients, []),
    filters: safeJsonParse<Record<string, string>>(row.filters, {}),
    frequency: "daily",
    timeOfDay: row.timeOfDay,
    timezone: row.timezone,
    enabled: row.enabled === true || row.enabled === 1,
    nextRunAt: row.nextRunAt ?? null,
    lastRunAt: row.lastRunAt ?? null,
    lastStatus: row.lastStatus ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
  };
}

function ownerWhere(ctx: AccessCtx, dashboardId?: string, id?: string) {
  const table = schema.dashboardReportSubscriptions;
  const clauses = [
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
  ];
  clauses.push(ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId));
  if (dashboardId) clauses.push(eq(table.dashboardId, dashboardId));
  if (id) clauses.push(eq(table.id, id));
  return and(...clauses);
}

function dueReportWhere(now: Date) {
  const table = schema.dashboardReportSubscriptions;
  return and(
    eq(table.enabled, true),
    lte(table.nextRunAt, now.toISOString()),
    reportNotRunningWhere(now),
  );
}

function reportNotRunningWhere(now: Date) {
  const table = schema.dashboardReportSubscriptions;
  const staleRunningBefore = new Date(
    now.getTime() - 30 * 60 * 1000,
  ).toISOString();
  return or(
    isNull(table.lastStatus),
    sql`${table.lastStatus} <> 'running'`,
    isNull(table.lastRunAt),
    lte(table.lastRunAt, staleRunningBefore),
  );
}

export async function listDashboardReportSubscriptions(
  ctx: AccessCtx,
  dashboardId?: string,
): Promise<DashboardReportSubscription[]> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.dashboardReportSubscriptions)
    .where(ownerWhere(ctx, dashboardId))
    .orderBy(asc(schema.dashboardReportSubscriptions.createdAt));
  return rows.map(rowToSubscription);
}

export async function getDashboardReportSubscription(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardReportSubscription | null> {
  const db = getDb() as any;
  const [row] = await db
    .select()
    .from(schema.dashboardReportSubscriptions)
    .where(ownerWhere(ctx, undefined, id));
  return row ? rowToSubscription(row) : null;
}

export async function saveDashboardReportSubscription(
  input: ReportSubscriptionInput,
  ctx: AccessCtx,
): Promise<DashboardReportSubscription> {
  const dashboard = await getReportDashboard(input.dashboardId, ctx);
  if (!dashboard) {
    throw Object.assign(new Error("Dashboard not found"), { statusCode: 404 });
  }

  const recipients = normalizeRecipients(input.recipients);
  if (recipients.length === 0) {
    throw new Error("At least one recipient is required");
  }

  const timeOfDay = assertTimeOfDay(input.timeOfDay);
  const timezone = assertTimezone(input.timezone);
  const filters = normalizeFilters(input.filters);
  const updatedAt = nowIso();
  const nextRunAt = input.enabled ? nextDailyRunAt(timeOfDay, timezone) : null;
  const name =
    input.name?.trim() || `${dashboard.title || "Dashboard"} daily email`;
  const db = getDb() as any;
  const id = input.id || randomUUID();

  if (input.id) {
    const existing = await getDashboardReportSubscription(input.id, ctx);
    if (!existing) {
      throw Object.assign(new Error("Report subscription not found"), {
        statusCode: 404,
      });
    }
    await db
      .update(schema.dashboardReportSubscriptions)
      .set({
        dashboardId: input.dashboardId,
        name,
        recipients: JSON.stringify(recipients),
        filters: JSON.stringify(filters),
        timeOfDay,
        timezone,
        enabled: input.enabled,
        nextRunAt,
        updatedAt,
        lastError: null,
      })
      .where(ownerWhere(ctx, undefined, id));
  } else {
    await db.insert(schema.dashboardReportSubscriptions).values({
      id,
      dashboardId: input.dashboardId,
      name,
      recipients: JSON.stringify(recipients),
      filters: JSON.stringify(filters),
      frequency: "daily",
      timeOfDay,
      timezone,
      enabled: input.enabled,
      nextRunAt,
      createdAt: updatedAt,
      updatedAt,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
    });
  }

  const saved = await getDashboardReportSubscription(id, ctx);
  if (!saved) throw new Error("Failed to save report subscription");
  recordChange({
    source: "dashboard-report-subscriptions",
    type: "change",
    key: saved.dashboardId,
    owner: saved.ownerEmail,
    orgId: saved.orgId ?? undefined,
  });
  return saved;
}

export async function deleteDashboardReportSubscription(
  id: string,
  ctx: AccessCtx,
): Promise<void> {
  const existing = await getDashboardReportSubscription(id, ctx);
  if (!existing) {
    throw Object.assign(new Error("Report subscription not found"), {
      statusCode: 404,
    });
  }
  const db = getDb() as any;
  await db
    .delete(schema.dashboardReportSubscriptions)
    .where(ownerWhere(ctx, undefined, id));
  recordChange({
    source: "dashboard-report-subscriptions",
    type: "delete",
    key: existing.dashboardId,
    owner: existing.ownerEmail,
    orgId: existing.orgId ?? undefined,
  });
}

export async function listDueDashboardReportSubscriptions(
  now: Date = new Date(),
): Promise<DashboardReportSubscription[]> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.dashboardReportSubscriptions)
    .where(dueReportWhere(now))
    .orderBy(asc(schema.dashboardReportSubscriptions.nextRunAt));
  return rows.map(rowToSubscription);
}

export async function claimDueDashboardReportSubscriptions(
  limit: number,
  now: Date = new Date(),
): Promise<DashboardReportSubscription[]> {
  const db = getDb() as any;
  const claimLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const candidates = await db
    .select()
    .from(schema.dashboardReportSubscriptions)
    .where(dueReportWhere(now))
    .orderBy(asc(schema.dashboardReportSubscriptions.nextRunAt))
    .limit(claimLimit);
  const claimed: DashboardReportSubscription[] = [];
  for (const candidate of candidates) {
    const startedAt = nowIso();
    const rows = await db
      .update(schema.dashboardReportSubscriptions)
      .set({
        lastRunAt: startedAt,
        lastStatus: "running",
        lastError: null,
        updatedAt: startedAt,
      })
      .where(
        and(
          eq(schema.dashboardReportSubscriptions.id, candidate.id),
          dueReportWhere(now),
        ),
      )
      .returning();
    if (rows[0]) claimed.push(rowToSubscription(rows[0]));
  }
  return claimed;
}

export async function claimDashboardReportSubscription(
  id: string,
  ctx: AccessCtx,
  now: Date = new Date(),
): Promise<DashboardReportSubscription | null> {
  const db = getDb() as any;
  const startedAt = now.toISOString();
  const rows = await db
    .update(schema.dashboardReportSubscriptions)
    .set({
      lastRunAt: startedAt,
      lastStatus: "running",
      lastError: null,
      updatedAt: startedAt,
    })
    .where(and(ownerWhere(ctx, undefined, id), reportNotRunningWhere(now)))
    .returning();
  return rows[0] ? rowToSubscription(rows[0]) : null;
}

export async function queueDashboardReportSubscriptionNow(
  id: string,
  ctx: AccessCtx,
  now: Date = new Date(),
): Promise<DashboardReportSubscription | null> {
  const db = getDb() as any;
  const queuedAt = now.toISOString();
  const rows = await db
    .update(schema.dashboardReportSubscriptions)
    .set({
      enabled: true,
      nextRunAt: queuedAt,
      lastStatus: null,
      lastError: null,
      updatedAt: queuedAt,
    })
    .where(ownerWhere(ctx, undefined, id))
    .returning();
  return rows[0] ? rowToSubscription(rows[0]) : null;
}

export async function markDashboardReportResult(
  sub: DashboardReportSubscription,
  status: "success" | "error",
  error?: string,
): Promise<void> {
  const now = nowIso();
  const db = getDb() as any;
  await db
    .update(schema.dashboardReportSubscriptions)
    .set({
      lastStatus: status,
      lastError: error ? error.slice(0, 500) : null,
      nextRunAt: sub.enabled
        ? nextDailyRunAt(sub.timeOfDay, sub.timezone, new Date())
        : null,
      updatedAt: now,
    })
    .where(eq(schema.dashboardReportSubscriptions.id, sub.id));
}
