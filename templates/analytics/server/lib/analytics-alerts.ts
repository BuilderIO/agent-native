import { createHash, randomUUID } from "node:crypto";

import { notifyWithDelivery } from "@agent-native/core/notifications";
import { recordChange } from "@agent-native/core/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export type AnalyticsAlertFilterOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "in"
  | "exists";

export interface AnalyticsAlertFilter {
  field: string;
  op?: AnalyticsAlertFilterOp;
  value?: unknown;
}

export type AnalyticsAlertThresholdMode = "event_count" | "distinct_count";
export type AnalyticsAlertSeverity = "warning" | "critical";
export type AnalyticsAlertStatus =
  | "ok"
  | "triggered"
  | "cooldown"
  | "error"
  | "running";

export interface AnalyticsAlertRuleInput {
  id?: string;
  name: string;
  description?: string;
  eventName?: string | null;
  filters?: AnalyticsAlertFilter[];
  thresholdMode?: AnalyticsAlertThresholdMode;
  distinctBy?: string | null;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes?: number;
  severity?: AnalyticsAlertSeverity;
  channels?: string[];
  emailRecipients?: string[];
  enabled?: boolean;
}

export interface AnalyticsAlertRule {
  id: string;
  name: string;
  description: string;
  eventName: string | null;
  filters: AnalyticsAlertFilter[];
  thresholdMode: AnalyticsAlertThresholdMode;
  distinctBy: string | null;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  severity: AnalyticsAlertSeverity;
  channels: string[];
  emailRecipients: string[];
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  lastStatus: AnalyticsAlertStatus | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
}

export interface AnalyticsAlertEventRow {
  id: string;
  eventName: string;
  userId?: string | null;
  anonymousId?: string | null;
  userKey?: string | null;
  sessionId?: string | null;
  timestamp: string;
  eventDate?: string | null;
  receivedAt?: string | null;
  url?: string | null;
  path?: string | null;
  hostname?: string | null;
  referrer?: string | null;
  app?: string | null;
  template?: string | null;
  signedIn?: string | null;
  properties?: string | null;
  context?: string | null;
}

export interface AnalyticsAlertEvaluation {
  triggered: boolean;
  observedValue: number;
  eventCount: number;
  sampleEvents: Array<Record<string, unknown>>;
}

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

export interface RunRuleResult extends AnalyticsAlertEvaluation {
  ruleId: string;
  status: AnalyticsAlertStatus;
  notificationId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

const ALERT_RULE_RUNNING_STALE_MS = 15 * 60 * 1000;
const DEFAULT_HTTP_5XX_ALERT_ID_PREFIX = "default-http-5xx-spike";

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Alert name is required");
  return normalized.slice(0, 120);
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function clampInt(value: number, min: number, max: number): number {
  const normalized = Math.floor(Number(value));
  if (!Number.isFinite(normalized)) return min;
  return Math.max(min, Math.min(max, normalized));
}

function normalizeFilters(filters: AnalyticsAlertFilter[] | undefined) {
  const normalized: AnalyticsAlertFilter[] = [];
  for (const filter of filters ?? []) {
    const field = filter.field?.trim();
    if (!field) continue;
    const op = filter.op ?? "equals";
    if (!["equals", "not_equals", "contains", "in", "exists"].includes(op)) {
      throw new Error(`Unsupported alert filter operator: ${op}`);
    }
    normalized.push({ field, op, value: filter.value });
  }
  return normalized;
}

function normalizeChannels(
  channels: string[] | undefined,
  emailRecipients: string[],
): string[] {
  const source =
    channels && channels.length
      ? channels
      : emailRecipients.length
        ? ["inbox", "email"]
        : ["inbox"];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of source) {
    const channel = raw.trim();
    if (!channel || seen.has(channel)) continue;
    seen.add(channel);
    normalized.push(channel);
  }
  return normalized.length ? normalized : ["inbox"];
}

function normalizeEmailRecipients(recipients: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of recipients ?? []) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
}

function boolEnv(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function currentDeployHostname(): string {
  const raw = process.env.URL || process.env.DEPLOY_URL || "";
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function defaultHttp5xxAlertEnabled(): boolean {
  const configured = boolEnv("ANALYTICS_DEFAULT_HTTP_5XX_ALERT_ENABLED");
  if (configured !== null) return configured;
  return currentDeployHostname() === "analytics.agent-native.com";
}

function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
}

function defaultHttp5xxAlertId(ownerEmail: string, orgId: string | null) {
  const hash = createHash("sha256")
    .update(`${ownerEmail.toLowerCase()}|${orgId ?? ""}`)
    .digest("hex")
    .slice(0, 10);
  return `${DEFAULT_HTTP_5XX_ALERT_ID_PREFIX}-${hash}`;
}

async function defaultHttp5xxAlertScopes(): Promise<AccessCtx[]> {
  const ownerEmail = process.env.ANALYTICS_DEFAULT_ALERT_OWNER_EMAIL?.trim();
  const orgId = process.env.ANALYTICS_DEFAULT_ALERT_ORG_ID?.trim() || null;
  if (ownerEmail) return [{ email: ownerEmail, orgId }];

  const db = getDb() as any;
  const rows = await db
    .select({
      ownerEmail: schema.analyticsPublicKeys.ownerEmail,
      orgId: schema.analyticsPublicKeys.orgId,
    })
    .from(schema.analyticsPublicKeys)
    .where(isNull(schema.analyticsPublicKeys.revokedAt))
    .limit(1000);

  const seen = new Set<string>();
  const scopes: AccessCtx[] = [];
  for (const row of rows) {
    const email = String(row.ownerEmail ?? "").trim();
    if (!email) continue;
    const scopeOrgId =
      typeof row.orgId === "string" && row.orgId.trim()
        ? row.orgId.trim()
        : null;
    const key = `${email.toLowerCase()}|${scopeOrgId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ email, orgId: scopeOrgId });
  }
  return scopes;
}

function rowToRule(row: any): AnalyticsAlertRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    eventName: row.eventName ?? null,
    filters: safeJsonParse<AnalyticsAlertFilter[]>(row.filters, []),
    thresholdMode:
      row.thresholdMode === "distinct_count" ? "distinct_count" : "event_count",
    distinctBy: row.distinctBy ?? null,
    threshold: Number(row.threshold ?? 1),
    windowMinutes: Number(row.windowMinutes ?? 10),
    cooldownMinutes: Number(row.cooldownMinutes ?? 30),
    severity: row.severity === "critical" ? "critical" : "warning",
    channels: safeJsonParse<string[]>(row.channels, ["inbox"]),
    emailRecipients: safeJsonParse<string[]>(row.emailRecipients, []),
    enabled: row.enabled === true || row.enabled === 1,
    lastEvaluatedAt: row.lastEvaluatedAt ?? null,
    lastTriggeredAt: row.lastTriggeredAt ?? null,
    lastStatus: row.lastStatus ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
  };
}

function ownerWhere(ctx: AccessCtx, id?: string) {
  const table = schema.analyticsAlertRules;
  const clauses = [
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  ];
  if (id) clauses.push(eq(table.id, id));
  return and(...clauses);
}

export async function listAnalyticsAlertRules(
  ctx: AccessCtx,
): Promise<AnalyticsAlertRule[]> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.analyticsAlertRules)
    .where(ownerWhere(ctx))
    .orderBy(asc(schema.analyticsAlertRules.name));
  return rows.map(rowToRule);
}

export async function getAnalyticsAlertRule(
  id: string,
  ctx: AccessCtx,
): Promise<AnalyticsAlertRule | null> {
  const db = getDb() as any;
  const [row] = await db
    .select()
    .from(schema.analyticsAlertRules)
    .where(ownerWhere(ctx, id));
  return row ? rowToRule(row) : null;
}

export async function saveAnalyticsAlertRule(
  input: AnalyticsAlertRuleInput,
  ctx: AccessCtx,
): Promise<AnalyticsAlertRule> {
  const updatedAt = nowIso();
  const id = input.id || randomUUID();
  const name = normalizeName(input.name);
  const description = input.description?.trim() ?? "";
  const eventName = normalizeNullableText(input.eventName);
  const filters = normalizeFilters(input.filters);
  const thresholdMode =
    input.thresholdMode === "distinct_count" ? "distinct_count" : "event_count";
  const distinctBy =
    thresholdMode === "distinct_count"
      ? normalizeNullableText(input.distinctBy) || "user_key"
      : normalizeNullableText(input.distinctBy);
  const threshold = clampInt(input.threshold, 1, 1_000_000);
  const windowMinutes = clampInt(input.windowMinutes, 1, 24 * 60);
  const cooldownMinutes = clampInt(input.cooldownMinutes ?? 30, 0, 24 * 60);
  const severity = input.severity === "critical" ? "critical" : "warning";
  const emailRecipients = normalizeEmailRecipients(input.emailRecipients);
  const channels = normalizeChannels(input.channels, emailRecipients);
  const enabled = input.enabled ?? true;
  const db = getDb() as any;

  if (input.id) {
    const existing = await getAnalyticsAlertRule(input.id, ctx);
    if (!existing) {
      throw Object.assign(new Error("Analytics alert rule not found"), {
        statusCode: 404,
      });
    }
    await db
      .update(schema.analyticsAlertRules)
      .set({
        name,
        description,
        eventName,
        filters: JSON.stringify(filters),
        thresholdMode,
        distinctBy,
        threshold,
        windowMinutes,
        cooldownMinutes,
        severity,
        channels: JSON.stringify(channels),
        emailRecipients: JSON.stringify(emailRecipients),
        enabled,
        updatedAt,
        lastError: null,
      })
      .where(ownerWhere(ctx, id));
  } else {
    await db.insert(schema.analyticsAlertRules).values({
      id,
      name,
      description,
      eventName,
      filters: JSON.stringify(filters),
      thresholdMode,
      distinctBy,
      threshold,
      windowMinutes,
      cooldownMinutes,
      severity,
      channels: JSON.stringify(channels),
      emailRecipients: JSON.stringify(emailRecipients),
      enabled,
      createdAt: updatedAt,
      updatedAt,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
    });
  }

  const saved = await getAnalyticsAlertRule(id, ctx);
  if (!saved) throw new Error("Failed to save analytics alert rule");
  recordChange({
    source: "analytics-alert-rules",
    type: "change",
    key: saved.id,
    owner: saved.ownerEmail,
    orgId: saved.orgId ?? undefined,
  });
  return saved;
}

export async function deleteAnalyticsAlertRule(
  id: string,
  ctx: AccessCtx,
): Promise<void> {
  const existing = await getAnalyticsAlertRule(id, ctx);
  if (!existing) {
    throw Object.assign(new Error("Analytics alert rule not found"), {
      statusCode: 404,
    });
  }
  const db = getDb() as any;
  await db.delete(schema.analyticsAlertRules).where(ownerWhere(ctx, id));
  recordChange({
    source: "analytics-alert-rules",
    type: "delete",
    key: existing.id,
    owner: existing.ownerEmail,
    orgId: existing.orgId ?? undefined,
  });
}

const DEFAULT_ALERT_SEED_CHUNK_SIZE = 500;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function ensureDefaultHttp5xxSpikeAlertRules(): Promise<{
  checked: number;
  created: number;
}> {
  if (!defaultHttp5xxAlertEnabled()) return { checked: 0, created: 0 };

  const scopes = await defaultHttp5xxAlertScopes();
  if (!scopes.length) return { checked: 0, created: 0 };

  const db = getDb() as any;
  const threshold = envInt(
    "ANALYTICS_DEFAULT_HTTP_5XX_ALERT_THRESHOLD",
    5,
    1,
    1000,
  );
  const windowMinutes = envInt(
    "ANALYTICS_DEFAULT_HTTP_5XX_ALERT_WINDOW_MINUTES",
    5,
    1,
    60,
  );
  const cooldownMinutes = envInt(
    "ANALYTICS_DEFAULT_HTTP_5XX_ALERT_COOLDOWN_MINUTES",
    30,
    0,
    24 * 60,
  );

  const scopesById = new Map<string, AccessCtx>();
  for (const scope of scopes) {
    scopesById.set(defaultHttp5xxAlertId(scope.email, scope.orgId), scope);
  }
  const allIds = Array.from(scopesById.keys());

  const existingIds = new Set<string>();
  for (const idChunk of chunkArray(allIds, DEFAULT_ALERT_SEED_CHUNK_SIZE)) {
    const rows = await db
      .select({ id: schema.analyticsAlertRules.id })
      .from(schema.analyticsAlertRules)
      .where(inArray(schema.analyticsAlertRules.id, idChunk));
    for (const row of rows) existingIds.add(row.id);
  }

  const missingIds = allIds.filter((id) => !existingIds.has(id));
  if (!missingIds.length) return { checked: scopes.length, created: 0 };

  const now = nowIso();
  const rowsToInsert = missingIds.map((id) => {
    const scope = scopesById.get(id)!;
    return {
      id,
      name: "Hosted app HTTP 5xx spike",
      description:
        "Default Agent Native alert for a spike in server responses with 5xx status codes.",
      eventName: "http.response",
      filters: JSON.stringify([
        { field: "properties.status_class", value: "5xx" },
      ]),
      thresholdMode: "event_count" as const,
      distinctBy: null,
      threshold,
      windowMinutes,
      cooldownMinutes,
      severity: "critical" as const,
      channels: JSON.stringify(["inbox"]),
      emailRecipients: JSON.stringify([]),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ownerEmail: scope.email,
      orgId: scope.orgId,
    };
  });

  let created = 0;
  for (const rowChunk of chunkArray(
    rowsToInsert,
    DEFAULT_ALERT_SEED_CHUNK_SIZE,
  )) {
    const inserted = await db
      .insert(schema.analyticsAlertRules)
      .values(rowChunk)
      .onConflictDoNothing()
      .returning({ id: schema.analyticsAlertRules.id });
    created += inserted.length;
  }

  return { checked: scopes.length, created };
}

export async function listEnabledAnalyticsAlertRules(options: {
  limit: number;
  ownerEmail?: string;
  orgId?: string | null;
}): Promise<AnalyticsAlertRule[]> {
  const db = getDb() as any;
  const table = schema.analyticsAlertRules;
  const clauses: any[] = [eq(table.enabled, true)];
  if (options.ownerEmail) {
    clauses.push(
      sql`lower(${table.ownerEmail}) = ${options.ownerEmail.toLowerCase()}`,
    );
  }
  if (options.orgId !== undefined) {
    clauses.push(
      options.orgId ? eq(table.orgId, options.orgId) : isNull(table.orgId),
    );
  }
  clauses.push(alertRuleNotRunningWhere(new Date()));
  const rows = await db
    .select()
    .from(table)
    .where(and(...clauses))
    .orderBy(
      sql`case when ${table.lastEvaluatedAt} is null then 0 else 1 end`,
      asc(table.lastEvaluatedAt),
      asc(table.createdAt),
    )
    .limit(clampInt(options.limit, 1, 500));
  return rows.map(rowToRule);
}

function alertRuleNotRunningWhere(now: Date) {
  const table = schema.analyticsAlertRules;
  const staleRunningBefore = new Date(
    now.getTime() - ALERT_RULE_RUNNING_STALE_MS,
  ).toISOString();
  return or(
    isNull(table.lastStatus),
    sql`${table.lastStatus} <> 'running'`,
    isNull(table.lastEvaluatedAt),
    lte(table.lastEvaluatedAt, staleRunningBefore),
  );
}

function alertRulePreviousEvaluationWhere(rule: AnalyticsAlertRule) {
  const table = schema.analyticsAlertRules;
  return rule.lastEvaluatedAt
    ? eq(table.lastEvaluatedAt, rule.lastEvaluatedAt)
    : isNull(table.lastEvaluatedAt);
}

export async function claimAnalyticsAlertRuleEvaluation(
  rule: AnalyticsAlertRule,
  now: Date = new Date(),
): Promise<boolean> {
  const db = getDb() as any;
  const table = schema.analyticsAlertRules;
  const claimedAt = now.toISOString();
  const rows = await db
    .update(table)
    .set({
      lastEvaluatedAt: claimedAt,
      lastStatus: "running",
      lastError: null,
    })
    .where(
      and(
        eq(table.id, rule.id),
        eq(table.enabled, true),
        alertRuleNotRunningWhere(now),
        alertRulePreviousEvaluationWhere(rule),
      ),
    )
    .returning({ id: table.id });
  return rows.length > 0;
}

export async function evaluateAndNotifyAnalyticsAlertRule(
  rule: AnalyticsAlertRule,
  now: Date = new Date(),
): Promise<RunRuleResult> {
  const windowEnd = now.toISOString();
  const windowStart = new Date(
    now.getTime() - rule.windowMinutes * 60 * 1000,
  ).toISOString();
  const rows = await loadCandidateEvents(rule, windowStart, windowEnd);
  const evaluation = evaluateAnalyticsAlertRuleRows(rule, rows);
  const evaluatedAt = now.toISOString();

  if (!evaluation.triggered) {
    await markRuleStatus(rule.id, {
      lastEvaluatedAt: evaluatedAt,
      lastStatus: "ok",
      lastError: null,
    });
    return { ruleId: rule.id, status: "ok", ...evaluation };
  }

  if (isCoolingDown(rule, now)) {
    await markRuleStatus(rule.id, {
      lastEvaluatedAt: evaluatedAt,
      lastStatus: "cooldown",
      lastError: null,
    });
    return { ruleId: rule.id, status: "cooldown", ...evaluation };
  }

  const body = alertBody(rule, evaluation);
  const channels = ensureInboxNotificationChannel(rule.channels);
  const delivery = await notifyWithDelivery(
    {
      severity: rule.severity,
      title: `Analytics alert: ${rule.name}`,
      body,
      channels,
      metadata: {
        kind: "analytics_alert",
        ruleId: rule.id,
        ruleName: rule.name,
        observedValue: evaluation.observedValue,
        eventCount: evaluation.eventCount,
        threshold: rule.threshold,
        thresholdMode: rule.thresholdMode,
        distinctBy: rule.distinctBy,
        windowMinutes: rule.windowMinutes,
        windowStart,
        windowEnd,
        eventName: rule.eventName,
        filters: rule.filters,
        sampleEvents: evaluation.sampleEvents,
        emailRecipients: rule.emailRecipients,
        requestedChannels: rule.channels,
      },
    },
    { owner: rule.ownerEmail },
  );
  if (delivery.deliveredChannels.length === 0) {
    await markRuleStatus(rule.id, {
      lastEvaluatedAt: evaluatedAt,
      lastStatus: "error",
      lastError: "Analytics alert notification was not delivered.",
    });
    return { ruleId: rule.id, status: "error", ...evaluation };
  }

  await recordIncident(rule, {
    notificationId: delivery.notification?.id,
    triggeredAt: evaluatedAt,
    windowStart,
    windowEnd,
    ...evaluation,
  });
  await markRuleStatus(rule.id, {
    lastEvaluatedAt: evaluatedAt,
    lastTriggeredAt: evaluatedAt,
    lastStatus: "triggered",
    lastError: null,
  });
  return {
    ruleId: rule.id,
    status: "triggered",
    notificationId: delivery.notification?.id,
    ...evaluation,
  };
}

function ensureInboxNotificationChannel(channels: string[]): string[] {
  const normalized = channels.map((channel) => channel.trim()).filter(Boolean);
  return normalized.includes("inbox") ? normalized : ["inbox", ...normalized];
}

export async function markAnalyticsAlertRuleError(
  id: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await markRuleStatus(id, {
    lastEvaluatedAt: nowIso(),
    lastStatus: "error",
    lastError: message.slice(0, 1000),
  });
}

export function evaluateAnalyticsAlertRuleRows(
  rule: Pick<
    AnalyticsAlertRule,
    "filters" | "threshold" | "thresholdMode" | "distinctBy"
  >,
  rows: AnalyticsAlertEventRow[],
): AnalyticsAlertEvaluation {
  const matched = rows.filter((row) =>
    rule.filters.every((filter) => matchesFilter(row, filter)),
  );
  const observedValue =
    rule.thresholdMode === "distinct_count"
      ? distinctCount(matched, rule.distinctBy || "user_key")
      : matched.length;
  return {
    triggered: observedValue >= rule.threshold,
    observedValue,
    eventCount: matched.length,
    sampleEvents: matched.slice(0, 5).map(sampleEvent),
  };
}

async function loadCandidateEvents(
  rule: AnalyticsAlertRule,
  windowStart: string,
  windowEnd: string,
): Promise<AnalyticsAlertEventRow[]> {
  const db = getDb() as any;
  const table = schema.analyticsEvents;
  const clauses: any[] = [
    gte(table.timestamp, windowStart),
    lte(table.timestamp, windowEnd),
  ];
  if (rule.orgId) {
    clauses.push(eq(table.orgId, rule.orgId));
  } else {
    clauses.push(isNull(table.orgId));
    clauses.push(
      sql`lower(${table.ownerEmail}) = ${rule.ownerEmail.toLowerCase()}`,
    );
  }
  if (rule.eventName) clauses.push(eq(table.eventName, rule.eventName));
  const rows: AnalyticsAlertEventRow[] = [];
  const batchSize = analyticsAlertEventBatchSize();
  let cursor: { timestamp: string; id: string } | null = null;

  while (true) {
    const pageClauses = [...clauses];
    if (cursor) {
      pageClauses.push(
        sql`(${table.timestamp} < ${cursor.timestamp} or (${table.timestamp} = ${cursor.timestamp} and ${table.id} < ${cursor.id}))`,
      );
    }
    const page = await db
      .select()
      .from(table)
      .where(and(...pageClauses))
      .orderBy(desc(table.timestamp), desc(table.id))
      .limit(batchSize);

    if (!page.length) break;
    rows.push(...page);
    if (page.length < batchSize) break;

    const last = page[page.length - 1];
    cursor = { timestamp: last.timestamp, id: last.id };
  }

  return rows;
}

function analyticsAlertEventBatchSize(): number {
  const raw =
    process.env.ANALYTICS_ALERT_EVENT_BATCH_SIZE ??
    process.env.ANALYTICS_ALERT_MAX_EVENTS_PER_RULE;
  if (!raw) return 5000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10000) : 5000;
}

function isCoolingDown(rule: AnalyticsAlertRule, now: Date): boolean {
  if (!rule.lastTriggeredAt || rule.cooldownMinutes <= 0) return false;
  const last = Date.parse(rule.lastTriggeredAt);
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < rule.cooldownMinutes * 60 * 1000;
}

async function markRuleStatus(
  id: string,
  patch: {
    lastEvaluatedAt?: string;
    lastTriggeredAt?: string;
    lastStatus: AnalyticsAlertStatus;
    lastError: string | null;
  },
): Promise<void> {
  const db = getDb() as any;
  await db
    .update(schema.analyticsAlertRules)
    .set(patch)
    .where(eq(schema.analyticsAlertRules.id, id));
}

async function recordIncident(
  rule: AnalyticsAlertRule,
  input: AnalyticsAlertEvaluation & {
    triggeredAt: string;
    windowStart: string;
    windowEnd: string;
    notificationId?: string;
  },
): Promise<void> {
  const db = getDb() as any;
  await db.insert(schema.analyticsAlertIncidents).values({
    id: randomUUID(),
    ruleId: rule.id,
    triggeredAt: input.triggeredAt,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    threshold: rule.threshold,
    observedValue: input.observedValue,
    eventCount: input.eventCount,
    severity: rule.severity,
    channels: JSON.stringify(rule.channels),
    sampleEvents: JSON.stringify(input.sampleEvents),
    notificationId: input.notificationId ?? null,
    createdAt: input.triggeredAt,
    ownerEmail: rule.ownerEmail,
    orgId: rule.orgId,
  });
}

function alertBody(
  rule: AnalyticsAlertRule,
  evaluation: AnalyticsAlertEvaluation,
): string {
  const metric =
    rule.thresholdMode === "distinct_count"
      ? `distinct ${rule.distinctBy || "user_key"} values`
      : "events";
  const target = rule.eventName ? ` for ${rule.eventName}` : "";
  return `${evaluation.observedValue} ${metric}${target} matched in the last ${rule.windowMinutes} minutes; threshold is ${rule.threshold}.`;
}

function matchesFilter(
  row: AnalyticsAlertEventRow,
  filter: AnalyticsAlertFilter,
): boolean {
  const value = fieldValue(row, filter.field);
  const op = filter.op ?? "equals";
  if (op === "exists") {
    const exists = value !== undefined && value !== null && value !== "";
    return filter.value === false ? !exists : exists;
  }
  if (op === "not_equals") return !valueEquals(value, filter.value);
  if (op === "contains") return valueContains(value, filter.value);
  if (op === "in") return valueIn(value, filter.value);
  return valueEquals(value, filter.value);
}

function distinctCount(rows: AnalyticsAlertEventRow[], field: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    const value = fieldValue(row, field);
    if (value === undefined || value === null || value === "") continue;
    values.add(String(value));
  }
  return values.size;
}

function fieldValue(row: AnalyticsAlertEventRow, field: string): unknown {
  const normalized = field.trim();
  if (normalized.startsWith("properties.")) {
    return pathValue(
      safeJsonParse<Record<string, unknown>>(row.properties, {}),
      normalized.slice("properties.".length),
    );
  }
  if (normalized.startsWith("context.")) {
    return pathValue(
      safeJsonParse<Record<string, unknown>>(row.context, {}),
      normalized.slice("context.".length),
    );
  }
  const aliases: Record<string, keyof AnalyticsAlertEventRow> = {
    id: "id",
    event_name: "eventName",
    eventName: "eventName",
    user_id: "userId",
    userId: "userId",
    anonymous_id: "anonymousId",
    anonymousId: "anonymousId",
    user_key: "userKey",
    userKey: "userKey",
    session_id: "sessionId",
    sessionId: "sessionId",
    timestamp: "timestamp",
    event_date: "eventDate",
    eventDate: "eventDate",
    received_at: "receivedAt",
    receivedAt: "receivedAt",
    url: "url",
    path: "path",
    hostname: "hostname",
    referrer: "referrer",
    app: "app",
    template: "template",
    signed_in: "signedIn",
    signedIn: "signedIn",
  };
  const key = aliases[normalized];
  return key ? row[key] : undefined;
}

function pathValue(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (!part) return undefined;
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === undefined || actual === null) return false;
  if (expected === undefined || expected === null) return false;
  return String(actual) === String(expected);
}

function valueContains(actual: unknown, expected: unknown): boolean {
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual)) {
    return actual.some((item) => valueEquals(item, expected));
  }
  return String(actual).includes(String(expected ?? ""));
}

function valueIn(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(expected)) return valueEquals(actual, expected);
  return expected.some((item) => valueEquals(actual, item));
}

function sampleEvent(row: AnalyticsAlertEventRow): Record<string, unknown> {
  return {
    id: row.id,
    eventName: row.eventName,
    timestamp: row.timestamp,
    app: row.app,
    template: row.template,
    userKey: row.userKey,
    sessionId: row.sessionId,
    path: row.path,
  };
}
