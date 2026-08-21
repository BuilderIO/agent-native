import { getDbExec, intType, isPostgres } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import {
  deleteNotification,
  notifyWithDelivery,
} from "../notifications/index.js";
import { ForbiddenError } from "../sharing/access.js";
import { builderCreditsFromCostCents } from "./store.js";

const DAY_MS = 86_400_000;
const DEFAULT_DAILY_USD = 100;

export const USAGE_ALERT_DEFAULT_DAILY_USD = DEFAULT_DAILY_USD;
export const USAGE_ALERT_UNIT_SCALE = {
  usd: 100,
  "builder-credits": 1,
  tokens: 1,
} as const;

export type UsageAlertScope = "user" | "workspace";
export type UsageAlertUnit = "usd" | "builder-credits" | "tokens";
export type UsageAlertPeriod = "day" | "month";
export type UsageAlertChannel = "in-app" | "email";
export type UsageAlertStatus = "ok" | "triggered" | "dismissed";

export interface UsageAlertAccess {
  ownerEmail: string;
  orgId?: string | null;
}

export interface UsageAlertRule {
  id: string;
  appId: string | null;
  scope: UsageAlertScope;
  unit: UsageAlertUnit;
  period: UsageAlertPeriod;
  limit: number;
  channels: UsageAlertChannel[];
  enabled: boolean;
  isDefault: boolean;
  status: UsageAlertStatus;
  current: number;
  percent: number;
  windowStart: number;
  windowEnd: number;
  dismissedAt: number | null;
  updatedAt: number;
}

export interface UsageAlertEventSummary {
  status: UsageAlertStatus;
  current: number;
  limit: number;
  percent: number;
  windowStart: number;
  windowEnd: number;
}

export interface UsageAlertListOptions {
  scope?: UsageAlertScope;
  appId?: string | null;
}

export interface SaveUsageAlertInput {
  scope: UsageAlertScope;
  ruleId?: string;
  appId?: string | null;
  unit?: UsageAlertUnit;
  period?: UsageAlertPeriod;
  limit?: number;
  channels?: UsageAlertChannel[];
  enabled?: boolean;
}

export interface UsageAlertMutationResult {
  rule: UsageAlertRule;
  rules: UsageAlertRule[];
  current: UsageAlertEventSummary | null;
}

interface ResolvedScope {
  scope: UsageAlertScope;
  ownerEmail: string;
  orgId: string | null;
  canManage: boolean;
  partitionSql: string;
  partitionArgs: unknown[];
}

interface UsageTotals {
  costCents: number;
  tokens: number;
}

let initPromise: Promise<void> | undefined;
let evaluationTail: Promise<void> = Promise.resolve();

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email) throw new Error("Usage alerts require an authenticated user.");
  return email;
}

function numberField(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0) || 0;
}

function stringField(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "");
}

function nullableNumberField(
  row: Record<string, unknown>,
  key: string,
): number | null {
  if (row[key] == null) return null;
  return numberField(row, key);
}

function booleanField(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true || numberField(row, key) === 1;
}

function normalizedAppId(value?: string | null): string | null {
  const appId = value?.trim().toLowerCase();
  return appId || null;
}

function appAliases(value: string | null): string[] {
  if (!value) return [];
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^agent-native-/, "");
  if (!normalized) return [];
  return [...new Set([normalized, `agent-native-${normalized}`])];
}

function windowForPeriod(
  period: UsageAlertPeriod,
  timestamp = Date.now(),
): { start: number; end: number } {
  const date = new Date(timestamp);
  if (period === "month") {
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return {
      start,
      end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    };
  }
  const start = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return { start, end: start + DAY_MS };
}

function defaultLimit(unit: UsageAlertUnit): number {
  if (unit === "usd") return DEFAULT_DAILY_USD;
  if (unit === "builder-credits") {
    return builderCreditsFromCostCents(DEFAULT_DAILY_USD * 100);
  }
  return 0;
}

function defaultRuleId(partition: ResolvedScope): string {
  const principal =
    partition.scope === "workspace"
      ? `org:${partition.orgId}`
      : `user:${partition.ownerEmail}`;
  return `usage-alert:${partition.scope}:${principal}:all:default`;
}

function ruleIdFor(
  partition: ResolvedScope,
  appId: string | null,
  unit: UsageAlertUnit,
  period: UsageAlertPeriod,
): string {
  const principal =
    partition.scope === "workspace"
      ? `org:${partition.orgId}`
      : `user:${partition.ownerEmail}`;
  return `usage-alert:${partition.scope}:${principal}:${appId ?? "all"}:${unit}:${period}`;
}

export async function ensureTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getDbExec();
      const tableSql = `CREATE TABLE IF NOT EXISTS usage_alert_rules (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        app_id TEXT,
        unit TEXT NOT NULL,
        period TEXT NOT NULL,
        limit_value ${intType()} NOT NULL,
        channels TEXT NOT NULL,
        enabled ${intType()} NOT NULL DEFAULT 1,
        is_default ${intType()} NOT NULL DEFAULT 0,
        dismissed_window_start ${intType()},
        created_at ${intType()} NOT NULL,
        updated_at ${intType()} NOT NULL
      )`;
      const eventsSql = `CREATE TABLE IF NOT EXISTS usage_alert_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        window_start ${intType()} NOT NULL,
        notification_id TEXT,
        created_at ${intType()} NOT NULL
      )`;
      const indexes = [
        {
          name: "idx_usage_alert_rules_owner",
          sql: "CREATE INDEX IF NOT EXISTS idx_usage_alert_rules_owner ON usage_alert_rules(owner_email, org_id, scope)",
        },
        {
          name: "idx_usage_alert_events_rule_window",
          sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_alert_events_rule_window ON usage_alert_events(rule_id, window_start)",
        },
      ];
      if (isPostgres()) {
        await ensureTableExists("usage_alert_rules", tableSql);
        await ensureTableExists("usage_alert_events", eventsSql);
        await ensureColumnExists(
          "usage_alert_rules",
          "is_default",
          `ALTER TABLE usage_alert_rules ADD COLUMN is_default ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "usage_alert_events",
          "notification_id",
          "ALTER TABLE usage_alert_events ADD COLUMN notification_id TEXT",
        );
        for (const index of indexes) {
          await ensureIndexExists(index.name, index.sql);
        }
      } else {
        await db.execute(tableSql);
        await db.execute(eventsSql);
        const eventColumns = await db.execute(
          "PRAGMA table_info(usage_alert_events)",
        );
        const hasNotificationId = eventColumns.rows.some(
          (row) =>
            String((row as Record<string, unknown>).name) === "notification_id",
        );
        if (!hasNotificationId) {
          await db.execute(
            "ALTER TABLE usage_alert_events ADD COLUMN notification_id TEXT",
          );
        }
        for (const index of indexes) await db.execute(index.sql);
      }
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  await initPromise;
}

async function resolveScope(
  scope: UsageAlertScope,
  access: UsageAlertAccess,
): Promise<ResolvedScope> {
  const ownerEmail = normalizeEmail(access.ownerEmail);
  const orgId = access.orgId?.trim() || null;
  let role: string | null = null;
  if (orgId) {
    const result = await getDbExec().execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, ownerEmail],
    });
    const candidate = result.rows[0]?.role;
    role = typeof candidate === "string" ? candidate : null;
  }
  const canManage = scope === "user" || role === "owner" || role === "admin";
  if (scope === "workspace" && !canManage) {
    throw new ForbiddenError(
      "Only organization owners and admins can manage workspace usage alerts.",
    );
  }
  if (scope === "workspace" && !orgId) {
    throw new ForbiddenError(
      "Workspace usage alerts require an active organization.",
    );
  }
  return {
    scope,
    ownerEmail,
    orgId: scope === "workspace" ? orgId : null,
    canManage,
    partitionSql:
      scope === "workspace" ? "org_id = ?" : "LOWER(owner_email) = ?",
    partitionArgs: scope === "workspace" ? [orgId!] : [ownerEmail],
  };
}

async function usageTotals(
  appId: string | null,
  partition: ResolvedScope,
  period: UsageAlertPeriod,
): Promise<UsageTotals> {
  const window = windowForPeriod(period);
  const aliases = appAliases(appId);
  const appClause = aliases.length
    ? ` AND LOWER(COALESCE(app, '')) IN (${aliases.map(() => "?").join(", ")})`
    : "";
  const result = await getDbExec().execute({
    sql: `SELECT COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
        COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) +
        COALESCE(SUM(cache_read_tokens), 0) + COALESCE(SUM(cache_write_tokens), 0) AS tokens
      FROM token_usage
      WHERE ${partition.scope === "workspace" ? "org_id = ?" : "LOWER(owner_email) = ?"}
        AND created_at >= ?${appClause}`,
    args: [
      ...(partition.scope === "workspace"
        ? [partition.orgId!]
        : [partition.ownerEmail]),
      window.start,
      ...aliases,
    ],
  });
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return {
    costCents: numberField(row, "cost_x100") / 100,
    tokens: numberField(row, "tokens"),
  };
}

function valueForUnit(totals: UsageTotals, unit: UsageAlertUnit): number {
  if (unit === "tokens") return totals.tokens;
  if (unit === "builder-credits")
    return builderCreditsFromCostCents(totals.costCents);
  return totals.costCents / 100;
}

function usageStatus(
  current: number,
  limit: number,
  enabled: boolean,
  dismissedWindowStart: number | null,
  windowStart: number,
): UsageAlertStatus {
  if (dismissedWindowStart === windowStart) return "dismissed";
  if (!enabled || limit <= 0) return "ok";
  return current >= limit ? "triggered" : "ok";
}

function parseChannels(value: unknown): UsageAlertChannel[] {
  if (typeof value !== "string") {
    throw new Error("Usage alert channels are unreadable.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Usage alert channels are unreadable.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Usage alert channels are unreadable.");
  }

  const channels = parsed.filter(
    (channel): channel is UsageAlertChannel =>
      channel === "in-app" || channel === "email",
  );
  if (channels.length === 0) {
    throw new Error("Usage alert channels are unreadable.");
  }
  return [...new Set(channels)];
}

async function storedRows(
  partition: ResolvedScope,
  appId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const aliases = appAliases(appId);
  const appClause = aliases.length
    ? ` AND (app_id IS NULL OR LOWER(app_id) IN (${aliases.map(() => "?").join(", ")}))`
    : "";
  const result = await getDbExec().execute({
    sql: `SELECT id, scope, owner_email, org_id, app_id, unit, period,
        limit_value, channels, enabled, is_default, dismissed_window_start,
        created_at, updated_at
      FROM usage_alert_rules
      WHERE scope = ? AND ${partition.partitionSql}${appClause}
      ORDER BY CASE WHEN app_id IS NULL THEN 0 ELSE 1 END, updated_at DESC`,
    args: [partition.scope, ...partition.partitionArgs, ...aliases],
  });
  return result.rows as Array<Record<string, unknown>>;
}

async function ensureDefaultRule(partition: ResolvedScope): Promise<void> {
  const now = Date.now();
  await getDbExec().execute({
    sql: `INSERT INTO usage_alert_rules (
        id, scope, owner_email, org_id, app_id, unit, period, limit_value,
        channels, enabled, is_default, dismissed_window_start, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'usd', 'day', ?, ?, 1, 1, NULL, ?, ?)
      ON CONFLICT (id) DO NOTHING`,
    args: [
      defaultRuleId(partition),
      partition.scope,
      partition.ownerEmail,
      partition.orgId,
      DEFAULT_DAILY_USD * USAGE_ALERT_UNIT_SCALE.usd,
      JSON.stringify(["in-app", "email"]),
      now,
      now,
    ],
  });
}

async function clearExpiredDismissal(
  row: Record<string, unknown>,
  partition: ResolvedScope,
): Promise<void> {
  const dismissedWindowStart = nullableNumberField(
    row,
    "dismissed_window_start",
  );
  if (dismissedWindowStart == null) return;
  const period = stringField(row, "period") as UsageAlertPeriod;
  const window = windowForPeriod(period);
  if (dismissedWindowStart === window.start) return;
  await getDbExec().execute({
    sql: `UPDATE usage_alert_rules
      SET dismissed_window_start = NULL
      WHERE id = ? AND scope = ? AND ${partition.partitionSql}`,
    args: [stringField(row, "id"), partition.scope, ...partition.partitionArgs],
  });
  row.dismissed_window_start = null;
}

async function rowToRule(
  row: Record<string, unknown>,
  partition: ResolvedScope,
): Promise<UsageAlertRule> {
  const appId = row.app_id == null ? null : String(row.app_id);
  const unit = stringField(row, "unit") as UsageAlertUnit;
  const period = stringField(row, "period") as UsageAlertPeriod;
  const window = windowForPeriod(period);
  const totals = await usageTotals(appId, partition, period);
  const current = valueForUnit(totals, unit);
  const limit = numberField(row, "limit_value") / USAGE_ALERT_UNIT_SCALE[unit];
  const dismissedWindowStart = nullableNumberField(
    row,
    "dismissed_window_start",
  );
  return {
    id: stringField(row, "id"),
    appId,
    scope: partition.scope,
    unit,
    period,
    limit,
    channels: parseChannels(row.channels),
    enabled: booleanField(row, "enabled"),
    isDefault: booleanField(row, "is_default"),
    status: usageStatus(
      current,
      limit,
      booleanField(row, "enabled"),
      dismissedWindowStart,
      window.start,
    ),
    current,
    percent: limit > 0 ? Math.round((current / limit) * 100) : 0,
    windowStart: window.start,
    windowEnd: window.end,
    dismissedAt: dismissedWindowStart == null ? null : dismissedWindowStart,
    updatedAt: numberField(row, "updated_at"),
  };
}

function currentSummary(
  rule: UsageAlertRule | undefined,
): UsageAlertEventSummary | null {
  if (!rule) return null;
  return {
    status: rule.status,
    current: rule.current,
    limit: rule.limit,
    percent: rule.percent,
    windowStart: rule.windowStart,
    windowEnd: rule.windowEnd,
  };
}

export async function listUsageAlerts(
  input: UsageAlertListOptions,
  access: UsageAlertAccess,
): Promise<UsageAlertRule[]> {
  await ensureTables();
  const scope = input.scope ?? "user";
  const appId = normalizedAppId(input.appId);
  const partition = await resolveScope(scope, access);
  await ensureDefaultRule(partition);
  const rows = await storedRows(partition, appId);
  for (const row of rows) await clearExpiredDismissal(row, partition);
  const rules = await Promise.all(rows.map((row) => rowToRule(row, partition)));
  return rules;
}

async function requireRule(
  ruleId: string,
  scope: UsageAlertScope,
  partition: ResolvedScope,
): Promise<Record<string, unknown>> {
  const result = await getDbExec().execute({
    sql: `SELECT id, scope, owner_email, org_id, app_id, unit, period,
        limit_value, channels, enabled, is_default, dismissed_window_start,
        created_at, updated_at
      FROM usage_alert_rules
      WHERE id = ? AND scope = ? AND ${partition.partitionSql} LIMIT 1`,
    args: [ruleId, scope, ...partition.partitionArgs],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Usage alert rule was not found.");
  return row;
}

async function persistRule(
  input: SaveUsageAlertInput,
  partition: ResolvedScope,
): Promise<UsageAlertMutationResult> {
  const appId = normalizedAppId(input.appId);
  const existing = input.ruleId
    ? await requireRule(input.ruleId, partition.scope, partition)
    : null;
  const unit = (input.unit ??
    (existing ? stringField(existing, "unit") : "usd")) as UsageAlertUnit;
  const period = (input.period ??
    (existing ? stringField(existing, "period") : "day")) as UsageAlertPeriod;
  const currentLimit = existing
    ? numberField(existing, "limit_value") /
      USAGE_ALERT_UNIT_SCALE[unit as UsageAlertUnit]
    : defaultLimit(unit as UsageAlertUnit);
  const limit = input.limit ?? currentLimit;
  const channels =
    input.channels ??
    (existing ? parseChannels(existing.channels) : ["in-app", "email"]);
  if (!(unit in USAGE_ALERT_UNIT_SCALE)) throw new Error("Unknown alert unit.");
  if (period !== "day" && period !== "month") {
    throw new Error("Unknown alert period.");
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("Usage alert limit must be greater than zero.");
  }
  if (channels.length === 0) {
    throw new Error("Choose at least one usage alert delivery channel.");
  }
  const id = input.ruleId ?? ruleIdFor(partition, appId, unit, period);
  const isDefault = Boolean(
    existing && booleanField(existing, "is_default") && appId === null,
  );
  const now = Date.now();
  const storedLimit = Math.round(
    limit * USAGE_ALERT_UNIT_SCALE[unit as UsageAlertUnit],
  );
  await getDbExec().execute({
    sql: `INSERT INTO usage_alert_rules (
        id, scope, owner_email, org_id, app_id, unit, period, limit_value,
        channels, enabled, is_default, dismissed_window_start, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        app_id = excluded.app_id,
        unit = excluded.unit,
        period = excluded.period,
        limit_value = excluded.limit_value,
        channels = excluded.channels,
        enabled = excluded.enabled,
        is_default = excluded.is_default,
        dismissed_window_start = NULL,
        updated_at = excluded.updated_at`,
    args: [
      id,
      partition.scope,
      partition.ownerEmail,
      partition.orgId,
      appId,
      unit,
      period,
      storedLimit,
      JSON.stringify(channels),
      (input.enabled ?? (existing ? booleanField(existing, "enabled") : true))
        ? 1
        : 0,
      isDefault ? 1 : 0,
      now,
      now,
    ],
  });
  const rule = await rowToRule(
    await requireRule(id, partition.scope, partition),
    partition,
  );
  const listed = await listUsageAlerts(
    { scope: partition.scope, appId },
    { ownerEmail: partition.ownerEmail, orgId: partition.orgId },
  );
  return { rule, rules: listed, current: currentSummary(rule) };
}

export async function saveUsageAlert(
  input: SaveUsageAlertInput,
  access: UsageAlertAccess,
): Promise<UsageAlertMutationResult> {
  await ensureTables();
  const partition = await resolveScope(input.scope ?? "user", access);
  return persistRule(input, partition);
}

export async function setUsageAlertEnabled(
  ruleId: string,
  scope: UsageAlertScope,
  enabled: boolean,
  access: UsageAlertAccess,
): Promise<UsageAlertMutationResult> {
  await ensureTables();
  const partition = await resolveScope(scope, access);
  const existing = await requireRule(ruleId, scope, partition);
  return persistRule(
    {
      scope,
      ruleId,
      appId: existing.app_id == null ? null : String(existing.app_id),
      unit: stringField(existing, "unit") as UsageAlertUnit,
      period: stringField(existing, "period") as UsageAlertPeriod,
      limit:
        numberField(existing, "limit_value") /
        USAGE_ALERT_UNIT_SCALE[stringField(existing, "unit") as UsageAlertUnit],
      channels: parseChannels(existing.channels),
      enabled,
    },
    partition,
  );
}

export async function dismissUsageAlert(
  ruleId: string,
  scope: UsageAlertScope,
  access: UsageAlertAccess,
): Promise<UsageAlertMutationResult> {
  await ensureTables();
  const partition = await resolveScope(scope, access);
  const existing = await requireRule(ruleId, scope, partition);
  const window = windowForPeriod(
    stringField(existing, "period") as UsageAlertPeriod,
  );
  const eventResult = await getDbExec().execute({
    sql: `SELECT notification_id FROM usage_alert_events
      WHERE rule_id = ? AND window_start = ? LIMIT 1`,
    args: [ruleId, window.start],
  });
  const notificationId = eventResult.rows[0]?.notification_id;
  await getDbExec().execute({
    sql: `UPDATE usage_alert_rules
      SET dismissed_window_start = ?, updated_at = ?
      WHERE id = ? AND scope = ? AND ${partition.partitionSql}`,
    args: [window.start, Date.now(), ruleId, scope, ...partition.partitionArgs],
  });
  if (typeof notificationId === "string" && notificationId) {
    await deleteNotification(notificationId, partition.ownerEmail);
  }
  const rule = await rowToRule(
    await requireRule(ruleId, scope, partition),
    partition,
  );
  const listed = await listUsageAlerts(
    {
      scope,
      appId: existing.app_id == null ? null : String(existing.app_id),
    },
    access,
  );
  return { rule, rules: listed, current: currentSummary(rule) };
}

function shouldEvaluate(record: {
  ownerEmail: string;
  app?: string;
  orgId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costCentsX100?: number;
}): boolean {
  const activity =
    record.inputTokens +
    record.outputTokens +
    (record.cacheReadTokens ?? 0) +
    (record.cacheWriteTokens ?? 0) +
    (record.costCentsX100 ?? 0);
  return Boolean(record.ownerEmail && activity > 0);
}

interface UsageAlertEvaluationRecord {
  ownerEmail: string;
  app?: string;
  orgId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costCentsX100?: number;
}

function evaluationPartition(
  scope: UsageAlertScope,
  record: UsageAlertEvaluationRecord,
): ResolvedScope {
  const ownerEmail = normalizeEmail(record.ownerEmail);
  const orgId = record.orgId?.trim() || null;
  return {
    scope,
    ownerEmail,
    orgId: scope === "workspace" ? orgId : null,
    canManage: true,
    partitionSql:
      scope === "workspace" ? "org_id = ?" : "LOWER(owner_email) = ?",
    partitionArgs: scope === "workspace" ? [orgId] : [ownerEmail],
  };
}

function alertValueLabel(value: number, unit: UsageAlertUnit): string {
  if (unit === "usd") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  const suffix = unit === "builder-credits" ? "Builder credits" : "tokens";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: unit === "tokens" ? 0 : 2 })} ${suffix}`;
}

async function matchingEvaluationRows(
  record: UsageAlertEvaluationRecord,
): Promise<Array<{ row: Record<string, unknown>; partition: ResolvedScope }>> {
  await ensureTables();
  const partitions: ResolvedScope[] = [evaluationPartition("user", record)];
  if (record.orgId?.trim()) {
    partitions.push(evaluationPartition("workspace", record));
  }
  const matches: Array<{
    row: Record<string, unknown>;
    partition: ResolvedScope;
  }> = [];
  const appId = normalizedAppId(record.app);
  for (const partition of partitions) {
    await ensureDefaultRule(partition);
    const rows = await storedRows(partition, appId);
    for (const row of rows) {
      await clearExpiredDismissal(row, partition);
      if (booleanField(row, "enabled")) matches.push({ row, partition });
    }
  }
  return matches;
}

async function evaluateUsageAlerts(
  record: UsageAlertEvaluationRecord,
): Promise<void> {
  const matches = await matchingEvaluationRows(record);
  for (const { row, partition } of matches) {
    const appId = row.app_id == null ? null : String(row.app_id);
    const unit = stringField(row, "unit") as UsageAlertUnit;
    const period = stringField(row, "period") as UsageAlertPeriod;
    const window = windowForPeriod(period);
    const totals = await usageTotals(appId, partition, period);
    const current = valueForUnit(totals, unit);
    const limit =
      numberField(row, "limit_value") / USAGE_ALERT_UNIT_SCALE[unit];
    const dismissedWindowStart = nullableNumberField(
      row,
      "dismissed_window_start",
    );
    if (
      dismissedWindowStart === window.start ||
      !booleanField(row, "enabled") ||
      limit <= 0 ||
      current < limit
    ) {
      continue;
    }

    const ruleId = stringField(row, "id");
    const eventId = `${ruleId}:${window.start}`;
    const inserted = await getDbExec().execute({
      sql: `INSERT INTO usage_alert_events (id, rule_id, window_start, notification_id, created_at)
        VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT (rule_id, window_start) DO NOTHING`,
      args: [eventId, ruleId, window.start, Date.now()],
    });
    if (Number(inserted.rowsAffected ?? 0) !== 1) continue;

    const channels = parseChannels(row.channels);
    const deliveryChannels = [
      ...new Set(
        channels.map((channel) => (channel === "in-app" ? "inbox" : "email")),
      ),
    ];
    if (deliveryChannels.length === 0) continue;
    const owner = normalizeEmail(stringField(row, "owner_email"));
    const target = appId ? ` for ${appId}` : " across all apps";
    const delivery = await notifyWithDelivery(
      {
        severity: "warning",
        title: "Usage limit reached",
        body: `${alertValueLabel(current, unit)} of ${alertValueLabel(limit, unit)} used${target} this ${period}.`,
        metadata: {
          usageAlertRuleId: ruleId,
          appId,
          period,
          windowStart: window.start,
        },
        channels: deliveryChannels,
      },
      { owner },
    );
    const notificationId = delivery.notification?.id;
    if (notificationId) {
      await getDbExec().execute({
        sql: `UPDATE usage_alert_events SET notification_id = ?
          WHERE rule_id = ? AND window_start = ?`,
        args: [notificationId, ruleId, window.start],
      });
    }
  }
}

export function enqueueUsageAlertEvaluation(
  record: UsageAlertEvaluationRecord,
): void {
  if (!shouldEvaluate(record)) return;
  evaluationTail = evaluationTail
    .then(() => evaluateUsageAlerts(record))
    .catch((error) => {
      console.error("[usage-alerts] evaluation failed:", error);
    });
}

export function _resetUsageAlertStoreForTests(): void {
  initPromise = undefined;
  evaluationTail = Promise.resolve();
}

export async function _waitForUsageAlertEvaluationsForTests(): Promise<void> {
  await evaluationTail;
}
