import { getAppConfig } from "../app-config/index.js";
import { getDbExec } from "../db/client.js";
import { ForbiddenError } from "../sharing/access.js";
import { isSelfScopedUsageRead, usageOrgScope } from "./org-scope.js";
import {
  builderCreditsFromCostCents,
  ensureUsageTable,
  resolveUsageAppKey,
  usageBillingForEngine,
  MIXED_USAGE_BILLING,
  type UsageBillingMode,
} from "./store.js";

const DAY_MS = 86_400_000;

export type UsageMetricsScope = "me" | "workspace";

/**
 * Selects usage from every app instead of one app's identities. A symbol, not
 * a reserved string, so no real app key can ever be mistaken for it.
 */
export const ALL_USAGE_APPS: unique symbol = Symbol(
  "agent-native.usage.all-apps",
);

/** `get-usage-metrics` app filter values that select every app / this app. */
export const USAGE_APP_FILTER_ALL = "all";
export const USAGE_APP_FILTER_CURRENT = "current";

/** One app's key (its configured legacy identities merge in), or every app. */
export type UsageAppSelection = string | typeof ALL_USAGE_APPS;

export interface UsageMetricBucket {
  key: string;
  label: string;
  costCents: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  builderCredits?: number;
  estimatedBuilderCredits?: number;
  otherCostCents?: number;
  activeUsers: number;
  lastActiveAt: number | null;
}

export interface UsageDailyMetric {
  date: string;
  costCents: number;
  calls: number;
  tokens: number;
  builderCredits?: number;
  estimatedBuilderCredits?: number;
  otherCostCents?: number;
  otherCalls?: number;
}

export interface UsageRecentMetric {
  id: number;
  createdAt: number;
  ownerEmail: string;
  app: string;
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCents: number;
  builderCredits?: number;
  estimatedBuilderCredits?: number;
  otherCostCents?: number;
  engineName?: string | null;
  prompt: string | null;
  promptSource: "thread" | "thread-preview" | "not-captured" | "unavailable";
  threadId: string | null;
}

export interface UsageAppOption {
  /** Normalized app key, as used by `byApp` and accepted as an app filter. */
  key: string;
  calls: number;
  lastActiveAt: number | null;
}

export interface UsageUserOption {
  email: string;
  role: string | null;
}

export interface UsageMetricsAccess {
  viewerEmail: string;
  orgId: string | null;
  role: string | null;
  canViewWorkspace: boolean;
  totalUsers: number;
}

export interface AppUsageMetrics {
  billing: UsageBillingMode;
  /** "all" when every app is included; "app" when filtered to one app. */
  appScope: "all" | "app";
  app: string;
  /** Normalized key of the filtered app; null when every app is included. */
  appKey: string | null;
  /** Normalized key of the app serving this request; null when unconfigured. */
  currentAppKey: string | null;
  /**
   * Apps with usage for the selected people in the range, ignoring the app
   * filter, so a filter picker can list them while one app is selected.
   */
  apps: UsageAppOption[];
  viewScope: UsageMetricsScope;
  selectedUserEmail: string | null;
  availableUsers: UsageUserOption[];
  sinceMs: number;
  sinceDays: number;
  generatedAt: number;
  access: UsageMetricsAccess;
  totals: {
    costCents: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    activeUsers: number;
    builderCredits?: number;
    estimatedBuilderCredits?: number;
    otherCostCents?: number;
    otherCalls?: number;
  };
  currentDay: {
    costCents: number;
    credits: number;
    estimatedBuilderCredits?: number;
    otherCostCents?: number;
    otherCalls?: number;
    calls: number;
    tokens: number;
  };
  byLabel: UsageMetricBucket[];
  byModel: UsageMetricBucket[];
  /**
   * Every app within the app filter, never truncated, so the per-app buckets
   * always sum to `totals`.
   */
  byApp: UsageMetricBucket[];
  daily: UsageDailyMetric[];
  recent: UsageRecentMetric[];
}

export interface UsageMetricsAccessInput {
  ownerEmail: string;
  orgId?: string | null;
  app: UsageAppSelection;
}

interface MemberRecord {
  email: string;
  role: string | null;
}

interface QueryScope {
  where: string;
  args: unknown[];
}

interface SqlExpression {
  sql: string;
  args: unknown[];
}

const NO_APP_FILTER: QueryScope = { where: "", args: [] };

interface ThreadPromptRow {
  id?: unknown;
  preview?: unknown;
  thread_data?: unknown;
}

function numberField(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0) || 0;
}

function stringField(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "");
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email) throw new Error("Usage metrics require an authenticated user.");
  return email;
}

export function normalizeUsageAppKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^agent-native-/, "");
  return normalized || "unattributed";
}

function appKeys(value: string): string[] {
  const raw = value.trim().toLowerCase();
  const normalized = normalizeUsageAppKey(value);
  return [
    ...new Set([
      raw,
      normalized,
      `agent-native-${normalized}`,
      ...(normalized === "unattributed" ? [""] : []),
    ]),
  ];
}

export function usageAppScope(app: string): QueryScope {
  const configured = getAppConfig().app;
  const configuredKeys = [configured.id, configured.legacyId, configured.name]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const requested = app.trim().toLowerCase();
  const matchesConfiguredIdentity = configuredKeys.some(
    (value) => value.toLowerCase() === requested,
  );
  const keys = [
    ...new Set(
      (matchesConfiguredIdentity ? configuredKeys : [app]).flatMap(appKeys),
    ),
  ];
  return {
    where: `LOWER(COALESCE(app, '')) IN (${keys.map(() => "?").join(", ")})`,
    args: keys,
  };
}

/**
 * The normalized app key of a `token_usage` row, with the configured app's
 * legacy identities folded into its current key. It must group rows exactly
 * as `usageAppScope(key)` selects them, or a per-app bucket and that app's
 * filtered totals disagree.
 */
function usageAppKeyExpression(): SqlExpression {
  const normalized = `COALESCE(NULLIF(REGEXP_REPLACE(LOWER(COALESCE(app, '')), '^agent-native-', ''), ''), 'unattributed')`;
  const configured = resolveUsageAppKey();
  if (!configured) return { sql: normalized, args: [] };
  const identity = usageAppScope(configured);
  return {
    sql: `CASE WHEN ${identity.where} THEN ? ELSE ${normalized} END`,
    args: [...identity.args, normalizeUsageAppKey(configured)],
  };
}

function andScopes(...scopes: QueryScope[]): QueryScope {
  const present = scopes.filter((scope) => scope.where);
  return {
    where: present.map((scope) => scope.where).join(" AND "),
    args: present.flatMap((scope) => scope.args),
  };
}

async function listOrgMembers(orgId: string): Promise<MemberRecord[]> {
  const result = await getDbExec().execute({
    sql: `SELECT email, role FROM org_members
          WHERE org_id = ? AND federation_removal_pending_at IS NULL
          ORDER BY LOWER(email) ASC`,
    args: [orgId],
  });
  return (result.rows as Array<Record<string, unknown>>)
    .map((row) => ({
      email: stringField(row, "email").trim(),
      role: stringField(row, "role").trim() || null,
    }))
    .filter((member) => member.email);
}

async function getOrgRole(
  orgId: string | null,
  ownerEmail: string,
): Promise<string | null> {
  if (!orgId) return null;
  const result = await getDbExec().execute({
    sql: `SELECT role FROM org_members
          WHERE org_id = ? AND LOWER(email) = ?
            AND federation_removal_pending_at IS NULL
          LIMIT 1`,
    args: [orgId, ownerEmail],
  });
  const role = result.rows[0]?.role;
  return typeof role === "string" ? role : null;
}

export async function canViewWorkspaceUsage(
  input: Pick<UsageMetricsAccessInput, "ownerEmail" | "orgId">,
): Promise<boolean> {
  const role = await getOrgRole(
    input.orgId?.trim() || null,
    normalizeEmail(input.ownerEmail),
  );
  return role === "owner" || role === "admin";
}

async function resolveScope(
  input: UsageMetricsAccessInput,
  scope: UsageMetricsScope,
  requestedUserEmail?: string | null,
): Promise<{
  ownerScope: QueryScope;
  selectedUserEmail: string | null;
  members: MemberRecord[];
  access: UsageMetricsAccess;
}> {
  const viewerEmail = normalizeEmail(input.ownerEmail);
  const orgId = input.orgId?.trim() || null;
  const role = await getOrgRole(orgId, viewerEmail);
  const canViewWorkspace = Boolean(
    orgId && (role === "owner" || role === "admin"),
  );

  if (scope === "workspace" && !canViewWorkspace) {
    throw new ForbiddenError(
      "Only organization owners and admins can view workspace usage metrics.",
    );
  }

  const members = orgId
    ? await listOrgMembers(orgId)
    : [{ email: viewerEmail, role }];
  const availableMembers =
    members.length > 0 ? members : [{ email: viewerEmail, role }];
  const requested = requestedUserEmail?.trim().toLowerCase() || null;
  const selectedUserEmail =
    scope === "me"
      ? viewerEmail
      : requested
        ? (availableMembers.find(
            (member) => member.email.toLowerCase() === requested,
          )?.email ?? null)
        : null;

  if (scope === "workspace" && requested && !selectedUserEmail) {
    throw new ForbiddenError(
      "The selected user is not available in this workspace.",
    );
  }

  const selectedEmails = selectedUserEmail
    ? [selectedUserEmail]
    : availableMembers.map((member) => member.email);
  if (selectedEmails.length === 0) {
    throw new Error("The usage scope has no available users.");
  }

  const placeholders = selectedEmails.map(() => "?").join(", ");
  const orgScope = usageOrgScope({
    orgId,
    selfScoped: isSelfScopedUsageRead(selectedEmails, viewerEmail),
  });
  return {
    ownerScope: {
      where: [orgScope.where, `LOWER(owner_email) IN (${placeholders})`]
        .filter(Boolean)
        .join(" AND "),
      args: [
        ...orgScope.args,
        ...selectedEmails.map((email) => email.toLowerCase()),
      ],
    },
    selectedUserEmail,
    members: availableMembers,
    access: {
      viewerEmail,
      orgId,
      role,
      canViewWorkspace,
      totalUsers: availableMembers.length,
    },
  };
}

function buildUsageCost(row: Record<string, unknown>): number {
  return numberField(row, "cost_x100") / 100;
}

function bucketFromRow(
  row: Record<string, unknown>,
  builderCreditsEnabled: boolean,
): UsageMetricBucket {
  const key = stringField(row, "k");
  return {
    key,
    label: key || "Unattributed",
    costCents: buildUsageCost(row),
    calls: numberField(row, "calls"),
    inputTokens: numberField(row, "input_tokens"),
    outputTokens: numberField(row, "output_tokens"),
    cacheReadTokens: numberField(row, "cache_read_tokens"),
    cacheWriteTokens: numberField(row, "cache_write_tokens"),
    ...(builderCreditsEnabled
      ? {
          builderCredits: numberField(row, "builder_credits"),
          estimatedBuilderCredits: builderCreditsFromCostCents(
            numberField(row, "estimated_builder_cost_x100") / 100,
          ),
          otherCostCents: numberField(row, "other_cost_x100") / 100,
        }
      : {}),
    activeUsers: numberField(row, "active_users"),
    lastActiveAt:
      row.last_active_at == null ? null : numberField(row, "last_active_at"),
  };
}

async function usageBuckets(
  column: SqlExpression,
  filter: QueryScope,
  sinceMs: number,
  limit: number | null,
  builderCreditsEnabled: boolean,
): Promise<UsageMetricBucket[]> {
  // GROUP BY 1, not the expression: a parameterized expression repeated in
  // GROUP BY gets new placeholder numbers and no longer matches the SELECT.
  const result = await getDbExec().execute({
    sql: `SELECT ${column.sql} AS k,
        COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
        COALESCE(SUM(builder_credits_used), 0) AS builder_credits,
        COALESCE(SUM(CASE WHEN engine_name = 'builder' AND builder_credits_used IS NULL THEN cost_cents_x100 ELSE 0 END), 0) AS estimated_builder_cost_x100,
        COALESCE(SUM(CASE WHEN engine_name IS DISTINCT FROM 'builder' AND builder_credits_used IS NULL THEN cost_cents_x100 ELSE 0 END), 0) AS other_cost_x100,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
        COUNT(DISTINCT owner_email) AS active_users,
        MAX(created_at) AS last_active_at
      FROM token_usage
      WHERE ${filter.where} AND created_at >= ?
      GROUP BY 1
      ORDER BY ${builderCreditsEnabled ? "builder_credits DESC, estimated_builder_cost_x100 DESC, other_cost_x100 DESC" : "cost_x100 DESC"}, k ASC${limit === null ? "" : "\n      LIMIT ?"}`,
    args: [
      ...column.args,
      ...filter.args,
      sinceMs,
      ...(limit === null ? [] : [limit]),
    ],
  });
  return (result.rows as Array<Record<string, unknown>>).map((row) =>
    bucketFromRow(row, builderCreditsEnabled),
  );
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // coercion-ok: malformed persisted metadata is absent from optional prompt enrichment.
    return null;
  }
}

function promptText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? record.text.trim()
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function firstUserPrompt(threadData: unknown): string | null {
  const parsed = parseJson(threadData);
  const messages = parsed?.messages;
  if (!Array.isArray(messages)) return null;
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const message =
      record.message && typeof record.message === "object"
        ? (record.message as Record<string, unknown>)
        : record;
    const role = typeof message.role === "string" ? message.role : "";
    if (role !== "user" && role !== "human") continue;
    const text = promptText(message.content);
    if (text)
      return text.length > 360 ? `${text.slice(0, 359).trimEnd()}…` : text;
  }
  return null;
}

async function hydrateRecentPrompts(
  rows: Array<Record<string, unknown>>,
  builderCreditsEnabled: boolean,
): Promise<UsageRecentMetric[]> {
  const threadIds = [
    ...new Set(
      rows
        .map((row) => nullableStringField(row, "thread_id"))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const threads = new Map<string, ThreadPromptRow>();
  let threadQueryUnavailable = false;
  if (threadIds.length > 0) {
    try {
      const result = await getDbExec().execute({
        sql: `SELECT id, preview, thread_data FROM chat_threads WHERE id IN (${threadIds.map(() => "?").join(", ")})`,
        args: threadIds,
      });
      for (const row of result.rows as ThreadPromptRow[]) {
        const id = typeof row.id === "string" ? row.id : "";
        if (id) threads.set(id, row);
      }
    } catch {
      threadQueryUnavailable = true;
    }
  }

  return rows.map((row) => {
    const threadId = nullableStringField(row, "thread_id");
    const thread = threadId ? threads.get(threadId) : undefined;
    const prompt = thread ? firstUserPrompt(thread.thread_data) : null;
    const preview =
      typeof thread?.preview === "string" ? thread.preview.trim() : "";
    return {
      id: numberField(row, "id"),
      createdAt: numberField(row, "created_at"),
      ownerEmail: stringField(row, "owner_email"),
      app: stringField(row, "app") || "unattributed",
      label: stringField(row, "label") || "chat",
      model: stringField(row, "model") || "unknown",
      inputTokens: numberField(row, "input_tokens"),
      outputTokens: numberField(row, "output_tokens"),
      cacheReadTokens: numberField(row, "cache_read_tokens"),
      cacheWriteTokens: numberField(row, "cache_write_tokens"),
      costCents: numberField(row, "cost_cents_x100") / 100,
      ...(builderCreditsEnabled
        ? {
            ...(row.builder_credits_used != null
              ? { builderCredits: numberField(row, "builder_credits_used") }
              : row.engine_name === "builder"
                ? {
                    estimatedBuilderCredits: builderCreditsFromCostCents(
                      numberField(row, "cost_cents_x100") / 100,
                    ),
                  }
                : {}),
            otherCostCents:
              row.engine_name === "builder" || row.builder_credits_used != null
                ? 0
                : numberField(row, "cost_cents_x100") / 100,
            engineName: nullableStringField(row, "engine_name"),
          }
        : {}),
      prompt: prompt ?? (preview ? preview.slice(0, 359).trimEnd() : null),
      promptSource: prompt
        ? "thread"
        : preview
          ? "thread-preview"
          : threadQueryUnavailable && threadId
            ? "unavailable"
            : "not-captured",
      threadId,
    } satisfies UsageRecentMetric;
  });
}

async function detectUsageEngineName(): Promise<string | null> {
  try {
    const { readDefaultAgentEngineSetting } =
      await import("../agent/default-agent-engine.js");
    const stored = (await readDefaultAgentEngineSetting()) as {
      engine?: unknown;
    } | null;
    if (typeof stored?.engine === "string" && stored.engine.trim()) {
      return stored.engine;
    }
  } catch {
    // coercion-ok: engine settings are optional; raw usage rows remain authoritative.
    // The metrics action can still render USD estimates when engine settings
    // are unavailable; the underlying usage rows remain authoritative.
  }
  return getAppConfig().agent.engine ?? null;
}

export async function listAppUsageMetrics(
  input: {
    sinceDays?: number;
    scope?: UsageMetricsScope;
    userEmail?: string | null;
    builderCreditsEnabled?: boolean;
  },
  accessInput: UsageMetricsAccessInput,
): Promise<AppUsageMetrics> {
  await ensureUsageTable();
  const scope = input.scope === "workspace" ? "workspace" : "me";
  const builderCreditsEnabled = input.builderCreditsEnabled === true;
  const sinceDays = Math.max(1, Math.min(365, input.sinceDays ?? 30));
  const now = Date.now();
  const sinceMs = now - sinceDays * DAY_MS;
  const allApps = accessInput.app === ALL_USAGE_APPS;
  const appId =
    accessInput.app === ALL_USAGE_APPS ? "" : accessInput.app.trim();
  const app = allApps ? "all apps" : appId || "this app";
  const appKey = allApps ? null : normalizeUsageAppKey(appId);
  const configuredAppKey = resolveUsageAppKey();
  const currentAppKey = configuredAppKey
    ? normalizeUsageAppKey(configuredAppKey)
    : null;
  const appScope = allApps ? NO_APP_FILTER : usageAppScope(appId);
  const resolved = await resolveScope(accessInput, scope, input.userEmail);
  const filter = andScopes(appScope, resolved.ownerScope);
  const appKeyColumn = usageAppKeyExpression();

  const baseArgs = [...filter.args, sinceMs];
  const everyAppBuckets = usageBuckets(
    appKeyColumn,
    resolved.ownerScope,
    sinceMs,
    null,
    builderCreditsEnabled,
  );
  const [
    totalsResult,
    byLabel,
    byModel,
    byApp,
    appOptionBuckets,
    dailyResult,
    recentResult,
  ] = await Promise.all([
    getDbExec().execute({
      sql: `SELECT
            COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
            COALESCE(SUM(builder_credits_used), 0) AS builder_credits,
            COALESCE(SUM(CASE WHEN engine_name = 'builder' AND builder_credits_used IS NULL THEN cost_cents_x100 ELSE 0 END), 0) AS estimated_builder_cost_x100,
            COALESCE(SUM(CASE WHEN engine_name IS DISTINCT FROM 'builder' AND builder_credits_used IS NULL THEN cost_cents_x100 ELSE 0 END), 0) AS other_cost_x100,
            COUNT(*) FILTER (WHERE engine_name = 'builder' OR builder_credits_used IS NOT NULL) AS builder_calls,
            COUNT(*) FILTER (WHERE engine_name IS DISTINCT FROM 'builder' AND builder_credits_used IS NULL) AS other_calls,
            COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
            COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
            COUNT(DISTINCT owner_email) AS active_users
          FROM token_usage
          WHERE ${filter.where} AND created_at >= ?`,
      args: baseArgs,
    }),
    usageBuckets(
      { sql: "COALESCE(NULLIF(label, ''), 'chat')", args: [] },
      filter,
      sinceMs,
      6,
      builderCreditsEnabled,
    ),
    usageBuckets(
      { sql: "COALESCE(NULLIF(model, ''), 'unknown')", args: [] },
      filter,
      sinceMs,
      4,
      builderCreditsEnabled,
    ),
    allApps
      ? everyAppBuckets
      : usageBuckets(
          appKeyColumn,
          filter,
          sinceMs,
          null,
          builderCreditsEnabled,
        ),
    everyAppBuckets,
    getDbExec().execute({
      sql: `SELECT created_at, cost_cents_x100, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, builder_credits_used, engine_name FROM token_usage
          WHERE ${filter.where} AND created_at >= ?
          ORDER BY created_at ASC`,
      args: baseArgs,
    }),
    getDbExec().execute({
      sql: `SELECT id, created_at, owner_email, app, label, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_cents_x100, builder_credits_used, engine_name, thread_id
          FROM token_usage
          WHERE ${filter.where} AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT 12`,
      args: baseArgs,
    }),
  ]);

  const totals = (totalsResult.rows[0] ?? {}) as Record<string, unknown>;
  const dayMap = new Map<
    string,
    {
      costX100: number;
      calls: number;
      tokens: number;
      builderCredits: number;
      estimatedBuilderCostX100: number;
      otherCostX100: number;
      otherCalls: number;
    }
  >();
  for (const row of dailyResult.rows as Array<Record<string, unknown>>) {
    const date = new Date(numberField(row, "created_at"))
      .toISOString()
      .slice(0, 10);
    const current = dayMap.get(date) ?? {
      costX100: 0,
      calls: 0,
      tokens: 0,
      builderCredits: 0,
      estimatedBuilderCostX100: 0,
      otherCostX100: 0,
      otherCalls: 0,
    };
    current.costX100 += numberField(row, "cost_cents_x100");
    if (row.builder_credits_used != null) {
      current.builderCredits += numberField(row, "builder_credits_used");
    } else if (row.engine_name === "builder") {
      current.estimatedBuilderCostX100 += numberField(row, "cost_cents_x100");
    } else {
      current.otherCostX100 += numberField(row, "cost_cents_x100");
      current.otherCalls += 1;
    }
    current.calls += 1;
    current.tokens +=
      numberField(row, "input_tokens") +
      numberField(row, "output_tokens") +
      numberField(row, "cache_read_tokens") +
      numberField(row, "cache_write_tokens");
    dayMap.set(date, current);
  }
  const daily = [...dayMap.entries()]
    .map(([date, value]) => ({
      date,
      costCents: value.costX100 / 100,
      calls: value.calls,
      tokens: value.tokens,
      ...(builderCreditsEnabled
        ? {
            builderCredits: value.builderCredits,
            estimatedBuilderCredits: builderCreditsFromCostCents(
              value.estimatedBuilderCostX100 / 100,
            ),
            otherCostCents: value.otherCostX100 / 100,
            otherCalls: value.otherCalls,
          }
        : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date(now).toISOString().slice(0, 10);
  const currentDay = daily.find((row) => row.date === today) ?? {
    date: today,
    costCents: 0,
    calls: 0,
    tokens: 0,
    ...(builderCreditsEnabled
      ? {
          builderCredits: 0,
          estimatedBuilderCredits: 0,
          otherCostCents: 0,
          otherCalls: 0,
        }
      : {}),
  };
  const builderCalls = numberField(totals, "builder_calls");
  const otherCalls = numberField(totals, "other_calls");
  const billing = builderCreditsEnabled
    ? builderCalls && otherCalls
      ? MIXED_USAGE_BILLING
      : builderCalls
        ? usageBillingForEngine("builder")
        : otherCalls
          ? usageBillingForEngine(null)
          : usageBillingForEngine(await detectUsageEngineName())
    : usageBillingForEngine(await detectUsageEngineName());
  const recent = await hydrateRecentPrompts(
    recentResult.rows as Array<Record<string, unknown>>,
    builderCreditsEnabled,
  );

  return {
    billing,
    appScope: allApps ? "all" : "app",
    app,
    appKey,
    currentAppKey,
    apps: appOptionBuckets
      .map(({ key, calls, lastActiveAt }) => ({ key, calls, lastActiveAt }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    viewScope: scope,
    selectedUserEmail: resolved.selectedUserEmail,
    availableUsers: resolved.members
      .map(({ email, role }) => ({ email, role }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    sinceMs,
    sinceDays,
    generatedAt: now,
    access: resolved.access,
    totals: {
      costCents: buildUsageCost(totals),
      calls: numberField(totals, "calls"),
      inputTokens: numberField(totals, "input_tokens"),
      outputTokens: numberField(totals, "output_tokens"),
      cacheReadTokens: numberField(totals, "cache_read_tokens"),
      cacheWriteTokens: numberField(totals, "cache_write_tokens"),
      activeUsers: numberField(totals, "active_users"),
      ...(builderCreditsEnabled
        ? {
            builderCredits: numberField(totals, "builder_credits"),
            estimatedBuilderCredits: builderCreditsFromCostCents(
              numberField(totals, "estimated_builder_cost_x100") / 100,
            ),
            otherCostCents: numberField(totals, "other_cost_x100") / 100,
            otherCalls,
          }
        : {}),
    },
    currentDay: {
      costCents: currentDay.costCents,
      credits:
        currentDay.builderCredits ??
        builderCreditsFromCostCents(currentDay.costCents),
      ...(builderCreditsEnabled
        ? {
            estimatedBuilderCredits: currentDay.estimatedBuilderCredits ?? 0,
            otherCostCents: currentDay.otherCostCents ?? 0,
            otherCalls: currentDay.otherCalls ?? 0,
          }
        : {}),
      calls: currentDay.calls,
      tokens: currentDay.tokens,
    },
    byLabel,
    byModel,
    byApp,
    daily,
    recent,
  };
}
