import { getDbExec } from "../db/client.js";
import { ForbiddenError } from "../sharing/access.js";
import {
  builderCreditsFromCostCents,
  usageBillingForEngine,
  type UsageBillingMode,
} from "./store.js";

const DAY_MS = 86_400_000;

export type UsageMetricsScope = "me" | "workspace";

export interface UsageMetricBucket {
  key: string;
  label: string;
  costCents: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  activeUsers: number;
  lastActiveAt: number | null;
}

export interface UsageDailyMetric {
  date: string;
  costCents: number;
  calls: number;
  tokens: number;
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
  prompt: string | null;
  promptSource: "thread" | "thread-preview" | "not-captured" | "unavailable";
  threadId: string | null;
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
  app: string;
  appKey: string;
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
  };
  currentDay: {
    costCents: number;
    credits: number;
    calls: number;
    tokens: number;
  };
  byLabel: UsageMetricBucket[];
  byModel: UsageMetricBucket[];
  daily: UsageDailyMetric[];
  recent: UsageRecentMetric[];
}

export interface UsageMetricsAccessInput {
  ownerEmail: string;
  orgId?: string | null;
  app: string;
}

interface MemberRecord {
  email: string;
  role: string | null;
}

interface QueryScope {
  where: string;
  args: unknown[];
}

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
  return [...new Set([raw, normalized, `agent-native-${normalized}`])].filter(
    Boolean,
  );
}

export function usageAppScope(app: string): QueryScope {
  const keys = appKeys(app);
  return {
    where: `LOWER(COALESCE(app, '')) IN (${keys.map(() => "?").join(", ")})`,
    args: keys,
  };
}

async function listOrgMembers(orgId: string): Promise<MemberRecord[]> {
  const result = await getDbExec().execute({
    sql: `SELECT email, role FROM org_members WHERE org_id = ? ORDER BY LOWER(email) ASC`,
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
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [orgId, ownerEmail],
  });
  const role = result.rows[0]?.role;
  return typeof role === "string" ? role : null;
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
  return {
    ownerScope: {
      where: `LOWER(owner_email) IN (${placeholders})`,
      args: selectedEmails.map((email) => email.toLowerCase()),
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

function bucketFromRow(row: Record<string, unknown>): UsageMetricBucket {
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
    activeUsers: numberField(row, "active_users"),
    lastActiveAt:
      row.last_active_at == null ? null : numberField(row, "last_active_at"),
  };
}

async function usageBuckets(
  columnExpression: string,
  scope: QueryScope,
  appScope: QueryScope,
  sinceMs: number,
  limit: number,
): Promise<UsageMetricBucket[]> {
  const result = await getDbExec().execute({
    sql: `SELECT ${columnExpression} AS k,
        COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
        COUNT(DISTINCT owner_email) AS active_users,
        MAX(created_at) AS last_active_at
      FROM token_usage
      WHERE ${appScope.where} AND ${scope.where} AND created_at >= ?
      GROUP BY ${columnExpression}
      ORDER BY cost_x100 DESC
      LIMIT ?`,
    args: [...appScope.args, ...scope.args, sinceMs, limit],
  });
  return (result.rows as Array<Record<string, unknown>>).map(bucketFromRow);
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
    const { getSetting } = await import("../settings/store.js");
    const stored = (await getSetting("agent-engine")) as {
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
  return process.env.AGENT_ENGINE ?? null;
}

export async function listAppUsageMetrics(
  input: {
    sinceDays?: number;
    scope?: UsageMetricsScope;
    userEmail?: string | null;
  },
  accessInput: UsageMetricsAccessInput,
): Promise<AppUsageMetrics> {
  const scope = input.scope === "workspace" ? "workspace" : "me";
  const sinceDays = Math.max(1, Math.min(365, input.sinceDays ?? 30));
  const now = Date.now();
  const sinceMs = now - sinceDays * DAY_MS;
  const app = accessInput.app.trim() || "this app";
  const appKey = normalizeUsageAppKey(app);
  const appScope = usageAppScope(app);
  const resolved = await resolveScope(accessInput, scope, input.userEmail);

  const baseArgs = [...appScope.args, ...resolved.ownerScope.args, sinceMs];
  const [totalsResult, byLabel, byModel, dailyResult, recentResult] =
    await Promise.all([
      getDbExec().execute({
        sql: `SELECT
            COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
            COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
            COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
            COUNT(DISTINCT owner_email) AS active_users
          FROM token_usage
          WHERE ${appScope.where} AND ${resolved.ownerScope.where} AND created_at >= ?`,
        args: baseArgs,
      }),
      usageBuckets(
        "COALESCE(NULLIF(label, ''), 'chat')",
        resolved.ownerScope,
        appScope,
        sinceMs,
        6,
      ),
      usageBuckets(
        "COALESCE(NULLIF(model, ''), 'unknown')",
        resolved.ownerScope,
        appScope,
        sinceMs,
        4,
      ),
      getDbExec().execute({
        sql: `SELECT created_at, cost_cents_x100, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens FROM token_usage
          WHERE ${appScope.where} AND ${resolved.ownerScope.where} AND created_at >= ?
          ORDER BY created_at ASC`,
        args: baseArgs,
      }),
      getDbExec().execute({
        sql: `SELECT id, created_at, owner_email, app, label, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_cents_x100, thread_id
          FROM token_usage
          WHERE ${appScope.where} AND ${resolved.ownerScope.where} AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT 12`,
        args: baseArgs,
      }),
    ]);

  const totals = (totalsResult.rows[0] ?? {}) as Record<string, unknown>;
  const dayMap = new Map<
    string,
    { costX100: number; calls: number; tokens: number }
  >();
  for (const row of dailyResult.rows as Array<Record<string, unknown>>) {
    const date = new Date(numberField(row, "created_at"))
      .toISOString()
      .slice(0, 10);
    const current = dayMap.get(date) ?? { costX100: 0, calls: 0, tokens: 0 };
    current.costX100 += numberField(row, "cost_cents_x100");
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
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date(now).toISOString().slice(0, 10);
  const currentDay = daily.find((row) => row.date === today) ?? {
    date: today,
    costCents: 0,
    calls: 0,
    tokens: 0,
  };
  const billing = usageBillingForEngine(await detectUsageEngineName());
  const recent = await hydrateRecentPrompts(
    recentResult.rows as Array<Record<string, unknown>>,
  );

  return {
    billing,
    app,
    appKey,
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
    },
    currentDay: {
      costCents: currentDay.costCents,
      credits: builderCreditsFromCostCents(currentDay.costCents),
      calls: currentDay.calls,
      tokens: currentDay.tokens,
    },
    byLabel,
    byModel,
    daily,
    recent,
  };
}
