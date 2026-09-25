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

/** Dimensions the daily usage history can be split by. */
export type UsageBreakdownDimension = "feature" | "app" | "model" | "surface";

/** Key of the series that folds every key past a breakdown's limit. */
export const USAGE_OTHER_BREAKDOWN_KEY = "other";

/**
 * One day of one breakdown key. Feature keys are `chat`, `sub-agents`,
 * `automations`, `integration:{platform}`, or `other`; surface keys are `app`
 * (used in the app itself) or the integration platform the call came from.
 */
export interface UsageDailyBreakdownRow {
  date: string;
  key: string;
  costCents: number;
  calls: number;
  tokens: number;
  builderCredits?: number;
  estimatedBuilderCredits?: number;
  otherCostCents?: number;
}

export interface UsageChatMetric {
  threadId: string;
  title: string | null;
  titleSource: "thread" | "thread-preview" | "not-captured" | "unavailable";
  ownerEmail: string;
  /** Normalized app key, as in `byApp`. */
  app: string;
  lastActiveAt: number;
  costCents: number;
  calls: number;
  builderCredits?: number;
  estimatedBuilderCredits?: number;
  otherCostCents?: number;
}

export interface UsageToolCallDay {
  date: string;
  /** Tool name, or `other` past the top tools. */
  key: string;
  calls: number;
}

/**
 * Tool calls come from the agent trace spans, which have their own retention
 * window. "unavailable" means the traces could not be read, which is not the
 * same as a period with no tool calls.
 */
export type UsageToolCallMetrics =
  | { status: "ok"; daily: UsageToolCallDay[] }
  | { status: "unavailable" };

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
  /**
   * People by spend, keyed by lowercased email. Only for the organization
   * view (workspace scope with no one selected); empty otherwise.
   */
  byUser: UsageMetricBucket[];
  daily: UsageDailyMetric[];
  /** The daily history split by each dimension; each day sums to `daily`. */
  dailyBy: Record<UsageBreakdownDimension, UsageDailyBreakdownRow[]>;
  topChats: UsageChatMetric[];
  toolCalls: UsageToolCallMetrics;
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
  /** The lowercased owner emails `ownerScope` selects. */
  ownerEmails: string[];
  /** The org predicate inside `ownerScope`, for tables with an `org_id`. */
  orgScope: QueryScope;
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
  const ownerEmails = selectedEmails.map((email) => email.toLowerCase());
  return {
    ownerScope: {
      where: [orgScope.where, `LOWER(owner_email) IN (${placeholders})`]
        .filter(Boolean)
        .join(" AND "),
      args: [...orgScope.args, ...ownerEmails],
    },
    ownerEmails,
    orgScope,
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

/** The spend sums every usage aggregate selects, split by how each row bills. */
const USAGE_AMOUNT_COLUMNS = `COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
        COALESCE(SUM(builder_credits_used), 0) AS builder_credits,
        COALESCE(SUM(CASE WHEN engine_name = 'builder' AND builder_credits_used IS NULL THEN cost_cents_x100 ELSE 0 END), 0) AS estimated_builder_cost_x100,
        COALESCE(SUM(CASE WHEN engine_name IS DISTINCT FROM 'builder' AND builder_credits_used IS NULL THEN cost_cents_x100 ELSE 0 END), 0) AS other_cost_x100`;

function usageAmountOrder(builderCreditsEnabled: boolean): string {
  return builderCreditsEnabled
    ? "builder_credits DESC, estimated_builder_cost_x100 DESC, other_cost_x100 DESC"
    : "cost_x100 DESC";
}

function buildUsageCost(row: Record<string, unknown>): number {
  return numberField(row, "cost_x100") / 100;
}

/** The spend fields of a row that selected `USAGE_AMOUNT_COLUMNS`. */
function amountFieldsFromRow(
  row: Record<string, unknown>,
  builderCreditsEnabled: boolean,
): Pick<
  UsageMetricBucket,
  "costCents" | "builderCredits" | "estimatedBuilderCredits" | "otherCostCents"
> {
  return {
    costCents: buildUsageCost(row),
    ...(builderCreditsEnabled
      ? {
          builderCredits: numberField(row, "builder_credits"),
          estimatedBuilderCredits: builderCreditsFromCostCents(
            numberField(row, "estimated_builder_cost_x100") / 100,
          ),
          otherCostCents: numberField(row, "other_cost_x100") / 100,
        }
      : {}),
  };
}

function bucketFromRow(
  row: Record<string, unknown>,
  builderCreditsEnabled: boolean,
): UsageMetricBucket {
  const key = stringField(row, "k");
  const amounts = amountFieldsFromRow(row, builderCreditsEnabled);
  return {
    key,
    label: key || "Unattributed",
    costCents: amounts.costCents,
    calls: numberField(row, "calls"),
    inputTokens: numberField(row, "input_tokens"),
    outputTokens: numberField(row, "output_tokens"),
    cacheReadTokens: numberField(row, "cache_read_tokens"),
    cacheWriteTokens: numberField(row, "cache_write_tokens"),
    ...(builderCreditsEnabled
      ? {
          builderCredits: amounts.builderCredits,
          estimatedBuilderCredits: amounts.estimatedBuilderCredits,
          otherCostCents: amounts.otherCostCents,
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
        ${USAGE_AMOUNT_COLUMNS},
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
      ORDER BY ${usageAmountOrder(builderCreditsEnabled)}, k ASC${limit === null ? "" : "\n      LIMIT ?"}`,
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

/**
 * What a call was for, from its `label`: the chat, a sub-agent or agent team,
 * an automation or recurring job, or the integration it arrived through.
 */
const FEATURE_KEY_SQL = `CASE
          WHEN LOWER(COALESCE(label, '')) IN ('', 'chat') THEN 'chat'
          WHEN LOWER(label) LIKE 'agent-team%' OR LOWER(label) LIKE 'custom-agent:%' THEN 'sub-agents'
          WHEN LOWER(label) LIKE 'automation:%' OR LOWER(label) LIKE 'manual-automation:%' OR LOWER(label) LIKE 'recurring-job:%' THEN 'automations'
          WHEN LOWER(label) LIKE 'integration:%' THEN LOWER(label)
          ELSE '${USAGE_OTHER_BREAKDOWN_KEY}'
        END`;

/** Where a call came from: the app itself, or an integration platform. */
const SURFACE_KEY_SQL = `COALESCE(NULLIF(LOWER(source_platform), ''), 'app')`;

const MODEL_KEY_SQL = `COALESCE(NULLIF(model, ''), 'unknown')`;

/** Series kept per dimension before the rest fold into `other`. */
const BREAKDOWN_KEY_LIMIT = 5;

function dayKey(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

interface BreakdownAccumulator {
  costX100: number;
  builderCredits: number;
  estimatedBuilderCostX100: number;
  otherCostX100: number;
  calls: number;
  tokens: number;
}

/**
 * The daily history split by `column`. Days are UTC, like `daily`. With a
 * `keyLimit`, keys past the top ones by spend fold into `other`, so the
 * payload stays small while every day still sums to its `daily` total.
 */
async function usageDailyBreakdown(
  column: SqlExpression,
  filter: QueryScope,
  sinceMs: number,
  keyLimit: number | null,
  builderCreditsEnabled: boolean,
): Promise<UsageDailyBreakdownRow[]> {
  const result = await getDbExec().execute({
    sql: `SELECT (created_at / ${DAY_MS}) AS d, ${column.sql} AS k,
        ${USAGE_AMOUNT_COLUMNS},
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens
      FROM token_usage
      WHERE ${filter.where} AND created_at >= ?
      GROUP BY 1, 2`,
    args: [...column.args, ...filter.args, sinceMs],
  });
  const rows = (result.rows as Array<Record<string, unknown>>).map((row) => ({
    day: numberField(row, "d"),
    key: stringField(row, "k"),
    value: {
      costX100: numberField(row, "cost_x100"),
      builderCredits: numberField(row, "builder_credits"),
      estimatedBuilderCostX100: numberField(row, "estimated_builder_cost_x100"),
      otherCostX100: numberField(row, "other_cost_x100"),
      calls: numberField(row, "calls"),
      tokens: numberField(row, "tokens"),
    } satisfies BreakdownAccumulator,
  }));

  const kept = new Set<string>();
  if (keyLimit !== null) {
    const totals = new Map<string, BreakdownAccumulator>();
    for (const row of rows) {
      const total = totals.get(row.key);
      totals.set(
        row.key,
        total ? addAccumulators(total, row.value) : row.value,
      );
    }
    const ranked = [...totals.entries()]
      .filter(([key]) => key !== USAGE_OTHER_BREAKDOWN_KEY)
      .sort(
        ([aKey, a], [bKey, b]) =>
          compareAccumulators(b, a, builderCreditsEnabled) ||
          aKey.localeCompare(bKey),
      );
    for (const [key] of ranked.slice(0, keyLimit)) kept.add(key);
  }

  const merged = new Map<
    string,
    { day: number; key: string; value: BreakdownAccumulator }
  >();
  for (const row of rows) {
    const key =
      keyLimit === null || kept.has(row.key)
        ? row.key
        : USAGE_OTHER_BREAKDOWN_KEY;
    const id = `${row.day}\u0000${key}`;
    const current = merged.get(id);
    merged.set(id, {
      day: row.day,
      key,
      value: current ? addAccumulators(current.value, row.value) : row.value,
    });
  }

  return [...merged.values()]
    .sort((a, b) => a.day - b.day || a.key.localeCompare(b.key))
    .map(({ day, key, value }) => ({
      date: dayKey(day),
      key,
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
          }
        : {}),
    }));
}

function addAccumulators(
  a: BreakdownAccumulator,
  b: BreakdownAccumulator,
): BreakdownAccumulator {
  return {
    costX100: a.costX100 + b.costX100,
    builderCredits: a.builderCredits + b.builderCredits,
    estimatedBuilderCostX100:
      a.estimatedBuilderCostX100 + b.estimatedBuilderCostX100,
    otherCostX100: a.otherCostX100 + b.otherCostX100,
    calls: a.calls + b.calls,
    tokens: a.tokens + b.tokens,
  };
}

/** Same order as `usageAmountOrder`, then by calls. */
function compareAccumulators(
  a: BreakdownAccumulator,
  b: BreakdownAccumulator,
  builderCreditsEnabled: boolean,
): number {
  const order = builderCreditsEnabled
    ? [
        a.builderCredits - b.builderCredits,
        a.estimatedBuilderCostX100 - b.estimatedBuilderCostX100,
        a.otherCostX100 - b.otherCostX100,
      ]
    : [a.costX100 - b.costX100];
  return order.find((difference) => difference !== 0) ?? a.calls - b.calls;
}

const TOP_CHATS_LIMIT = 10;

/** The chats that spent the most, with their titles from `chat_threads`. */
async function topUsageChats(
  appKeyColumn: SqlExpression,
  filter: QueryScope,
  sinceMs: number,
  builderCreditsEnabled: boolean,
): Promise<UsageChatMetric[]> {
  const result = await getDbExec().execute({
    sql: `SELECT thread_id AS k,
        MIN(LOWER(owner_email)) AS owner_email,
        MIN(${appKeyColumn.sql}) AS app,
        ${USAGE_AMOUNT_COLUMNS},
        COUNT(*) AS calls,
        MAX(created_at) AS last_active_at
      FROM token_usage
      WHERE ${filter.where} AND created_at >= ?
        AND thread_id IS NOT NULL AND thread_id <> ''
      GROUP BY 1
      ORDER BY ${usageAmountOrder(builderCreditsEnabled)}, last_active_at DESC
      LIMIT ${TOP_CHATS_LIMIT}`,
    args: [...appKeyColumn.args, ...filter.args, sinceMs],
  });
  const rows = result.rows as Array<Record<string, unknown>>;
  const threadIds = rows.map((row) => stringField(row, "k"));
  const threads = new Map<string, { title: string; preview: string }>();
  let threadQueryUnavailable = false;
  if (threadIds.length > 0) {
    try {
      const threadResult = await getDbExec().execute({
        sql: `SELECT id, title, preview FROM chat_threads WHERE id IN (${threadIds.map(() => "?").join(", ")})`,
        args: threadIds,
      });
      for (const row of threadResult.rows as Array<Record<string, unknown>>) {
        const id = stringField(row, "id");
        if (!id) continue;
        threads.set(id, {
          title: stringField(row, "title").trim(),
          preview: stringField(row, "preview").trim(),
        });
      }
    } catch (error) {
      console.warn("[usage] Couldn't read chat titles for top chats", error);
      threadQueryUnavailable = true;
    }
  }
  return rows.map((row) => {
    const threadId = stringField(row, "k");
    const thread = threads.get(threadId);
    const title = thread?.title || thread?.preview.slice(0, 200) || null;
    return {
      threadId,
      title,
      titleSource: thread?.title
        ? "thread"
        : thread?.preview
          ? "thread-preview"
          : threadQueryUnavailable
            ? "unavailable"
            : "not-captured",
      ownerEmail: stringField(row, "owner_email"),
      app: stringField(row, "app"),
      lastActiveAt: numberField(row, "last_active_at"),
      calls: numberField(row, "calls"),
      ...amountFieldsFromRow(row, builderCreditsEnabled),
    } satisfies UsageChatMetric;
  });
}

/**
 * Tool calls per day from the agent trace spans, scoped to the same people
 * and organization as the usage rows. Spans carry no app, so one app's tool
 * calls are the ones in runs that recorded usage for that app.
 */
async function usageToolCalls(
  resolved: { ownerEmails: string[]; orgScope: QueryScope },
  appScope: QueryScope,
  sinceMs: number,
): Promise<UsageToolCallMetrics> {
  try {
    const { ensureObservabilityTables } =
      await import("../observability/store.js");
    await ensureObservabilityTables();
    const spanScope = andScopes(resolved.orgScope, {
      where: `LOWER(user_id) IN (${resolved.ownerEmails.map(() => "?").join(", ")})`,
      args: resolved.ownerEmails,
    });
    const runScope: QueryScope = appScope.where
      ? {
          where: `run_id IN (SELECT run_id FROM token_usage WHERE run_id IS NOT NULL AND ${appScope.where} AND created_at >= ?)`,
          args: [...appScope.args, sinceMs],
        }
      : NO_APP_FILTER;
    const filter = andScopes(spanScope, runScope);
    const result = await getDbExec().execute({
      sql: `SELECT (created_at / ${DAY_MS}) AS d, name AS k, COUNT(*) AS calls
        FROM agent_trace_spans
        WHERE span_type = 'tool_call' AND created_at >= ? AND ${filter.where}
        GROUP BY 1, 2`,
      args: [sinceMs, ...filter.args],
    });
    const rows = (result.rows as Array<Record<string, unknown>>).map((row) => ({
      day: numberField(row, "d"),
      key: stringField(row, "k") || USAGE_OTHER_BREAKDOWN_KEY,
      calls: numberField(row, "calls"),
    }));
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(row.key, (totals.get(row.key) ?? 0) + row.calls);
    }
    const kept = new Set(
      [...totals.entries()]
        .filter(([key]) => key !== USAGE_OTHER_BREAKDOWN_KEY)
        .sort(([aKey, a], [bKey, b]) => b - a || aKey.localeCompare(bKey))
        .slice(0, BREAKDOWN_KEY_LIMIT)
        .map(([key]) => key),
    );
    const merged = new Map<string, UsageToolCallDay & { day: number }>();
    for (const row of rows) {
      const key = kept.has(row.key) ? row.key : USAGE_OTHER_BREAKDOWN_KEY;
      const id = `${row.day}\u0000${key}`;
      const current = merged.get(id);
      merged.set(id, {
        day: row.day,
        date: dayKey(row.day),
        key,
        calls: (current?.calls ?? 0) + row.calls,
      });
    }
    return {
      status: "ok",
      daily: [...merged.values()]
        .sort((a, b) => a.day - b.day || a.key.localeCompare(b.key))
        .map(({ date, key, calls }) => ({ date, key, calls })),
    };
  } catch (error) {
    console.warn("[usage] Couldn't read tool calls from agent traces", error);
    return { status: "unavailable" };
  }
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
  const organizationView =
    scope === "workspace" && resolved.selectedUserEmail === null;
  const [
    byUser,
    featureDaily,
    appDaily,
    modelDaily,
    surfaceDaily,
    topChats,
    toolCalls,
  ] = await Promise.all([
    organizationView
      ? usageBuckets(
          { sql: "LOWER(owner_email)", args: [] },
          filter,
          sinceMs,
          BREAKDOWN_KEY_LIMIT,
          builderCreditsEnabled,
        )
      : Promise.resolve([]),
    usageDailyBreakdown(
      { sql: FEATURE_KEY_SQL, args: [] },
      filter,
      sinceMs,
      BREAKDOWN_KEY_LIMIT,
      builderCreditsEnabled,
    ),
    usageDailyBreakdown(
      appKeyColumn,
      filter,
      sinceMs,
      null,
      builderCreditsEnabled,
    ),
    usageDailyBreakdown(
      { sql: MODEL_KEY_SQL, args: [] },
      filter,
      sinceMs,
      BREAKDOWN_KEY_LIMIT,
      builderCreditsEnabled,
    ),
    usageDailyBreakdown(
      { sql: SURFACE_KEY_SQL, args: [] },
      filter,
      sinceMs,
      BREAKDOWN_KEY_LIMIT,
      builderCreditsEnabled,
    ),
    topUsageChats(appKeyColumn, filter, sinceMs, builderCreditsEnabled),
    usageToolCalls(resolved, appScope, sinceMs),
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
    byUser,
    daily,
    dailyBy: {
      feature: featureDaily,
      app: appDaily,
      model: modelDaily,
      surface: surfaceDaily,
    },
    topChats,
    toolCalls,
    recent,
  };
}
