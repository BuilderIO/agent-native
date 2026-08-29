import {
  detectEngineFromEnv,
  detectEngineFromUserSecrets,
  getAgentEngineEntry,
  isAgentEngineSettingConfigured,
  isStoredEngineUsable,
  registerBuiltinEngines,
} from "@agent-native/core/agent/engine";
import { getDbExec } from "@agent-native/core/db";
import { getSetting } from "@agent-native/core/settings";
import { ForbiddenError } from "@agent-native/core/sharing";
import {
  builderCreditsFromCostCents,
  getUsageSummary,
  usageBillingForEngine,
  type UsageBillingMode,
} from "@agent-native/core/usage";

import {
  listWorkspaceApps,
  type WorkspaceAppSummary,
} from "./app-creation-store.js";
import { currentOrgId, currentOwnerEmail } from "./dispatch-store.js";

const DAY_MS = 86_400_000;

registerBuiltinEngines();

export interface UsageMetricBucket {
  key: string;
  label: string;
  costCents: number;
  calls: number;
  chatCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  activeUsers: number;
  lastActiveAt: number | null;
}

export interface UserUsageMetric extends UsageMetricBucket {
  ownerEmail: string;
  chatThreads: number;
  chatMessages: number;
  lastChatAt: number | null;
  topApp: string | null;
  role: string | null;
}

export interface AppAdoptionActionMetric {
  key: string;
  label: string;
  calls: number;
  activeUsers: number;
  lastActiveAt: number | null;
}

export interface AppAccessMetric {
  id: string;
  name: string;
  path: string;
  status: WorkspaceAppSummary["status"];
  statusLabel?: string;
  isDispatch: boolean;
  accessModel: "workspace" | "solo";
  accessLabel: string;
  accessUsers: number;
  ownerEmail: string | null;
  isOwnedByViewer: boolean;
  canViewUsage: boolean;
  usersWithUsage: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  usageCalls: number;
  chatCalls: number;
  costCents: number;
  lastActiveAt: number | null;
  actionMetrics: AppAdoptionActionMetric[];
}

export interface DailyUsageMetric {
  date: string;
  costCents: number;
  calls: number;
  chatCalls: number;
  activeUsers: number;
}

export interface MonthlyUserUsageMetric {
  month: string;
  ownerEmail: string;
  costCents: number;
  credits: number;
  calls: number;
  chatCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface WorkspaceAppCreationMetric {
  month: string;
  ownerEmail: string;
  count: number;
  appIds: string[];
}

export interface RecentUsageMetric {
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
  runId: string | null;
  taskId: string | null;
  sourcePlatform: string | null;
  sourceId: string | null;
}

export type UsageMetricsScope = "me" | "workspace" | "app";

export interface UsageUserOption {
  email: string;
  role: string | null;
}

export interface DispatchUsageMetrics {
  billing: UsageBillingMode;
  viewScope: UsageMetricsScope;
  selectedUserEmail: string | null;
  selectedAppId: string | null;
  availableUsers: UsageUserOption[];
  sinceMs: number;
  sinceDays: number;
  generatedAt: number;
  access: {
    viewerEmail: string;
    orgId: string | null;
    role: string | null;
    scope: "organization" | "solo";
    totalUsers: number;
  };
  totals: {
    costCents: number;
    calls: number;
    chatCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    activeUsers: number;
    chatThreads: number;
    chatMessages: number;
    workspaceApps: number;
  };
  byApp: UsageMetricBucket[];
  byUser: UserUsageMetric[];
  byLabel: UsageMetricBucket[];
  byModel: UsageMetricBucket[];
  daily: DailyUsageMetric[];
  monthlyByUser: MonthlyUserUsageMetric[];
  workspaceAppCreationsByUserMonth: WorkspaceAppCreationMetric[];
  appAccess: AppAccessMetric[];
  recent: RecentUsageMetric[];
}

interface MemberRecord {
  email: string;
  role: string | null;
  joinedAt: number | null;
}

interface ChatStats {
  threads: number;
  messages: number;
  lastChatAt: number | null;
}

function numberField(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0) || 0;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : value == null
      ? ""
      : JSON.stringify(value);
}

function nullableNumberField(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key];
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
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

type ParsedThreadData =
  | { status: "absent"; value: null }
  | { status: "invalid"; value: null }
  | { status: "parsed"; value: Record<string, unknown> };

function parseJson(value: unknown): ParsedThreadData {
  if (typeof value !== "string" || !value.trim()) {
    return { status: "absent", value: null };
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? { status: "parsed", value: parsed as Record<string, unknown> }
      : { status: "invalid", value: null };
  } catch {
    return { status: "invalid", value: null };
  }
}

function textFromPromptContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string"
        ? item.text.trim()
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function truncatePrompt(value: string, maxLength = 360): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function firstUserPrompt(threadData: unknown): string | null {
  const parsed = parseJson(threadData);
  if (parsed.status !== "parsed") return null;
  const messages = parsed.value.messages;
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
    const text = textFromPromptContent(message.content);
    if (text) return truncatePrompt(text);
  }
  return null;
}

interface ThreadPromptRow {
  id?: unknown;
  preview?: unknown;
  thread_data?: unknown;
}

async function hydrateRecentPrompts(
  rows: Array<Record<string, unknown>>,
): Promise<RecentUsageMetric[]> {
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
    const promptSource = prompt
      ? "thread"
      : preview
        ? "thread-preview"
        : threadQueryUnavailable && threadId
          ? "unavailable"
          : "not-captured";

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
      prompt: prompt ?? (preview ? truncatePrompt(preview) : null),
      promptSource,
      threadId,
      runId: nullableStringField(row, "run_id"),
      taskId: nullableStringField(row, "task_id"),
      sourcePlatform: nullableStringField(row, "source_platform"),
      sourceId: nullableStringField(row, "source_id"),
    } satisfies RecentUsageMetric;
  });
}

function labelForKey(value: string): string {
  const trimmed = value.trim();
  return trimmed || "Unattributed";
}

function normalizeAppKey(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "unattributed";
  return raw.replace(/^agent-native-/, "");
}

function appOwner(app: WorkspaceAppSummary): string | null {
  const owner = app.owner?.trim();
  return owner || null;
}

function envEmails(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isEnvAdmin(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return [
    ...envEmails("DISPATCH_ADMIN_EMAILS"),
    ...envEmails("WORKSPACE_OWNER_EMAIL"),
    ...envEmails("DISPATCH_DEFAULT_OWNER_EMAIL"),
  ].includes(normalized);
}

async function detectUsageEngineName(): Promise<string | null> {
  try {
    const stored = (await getSetting("agent-engine")) as {
      engine?: string;
    } | null;
    if (isAgentEngineSettingConfigured(stored)) {
      return (stored as { engine: string }).engine;
    }
    if (stored && typeof stored.engine === "string") {
      const entry = getAgentEngineEntry(stored.engine);
      if (entry && isStoredEngineUsable(stored, entry)) {
        return stored.engine;
      }
    }

    const detectedFromUser = await detectEngineFromUserSecrets();
    if (detectedFromUser) return detectedFromUser.name;

    return detectEngineFromEnv()?.name ?? null;
  } catch {
    return null;
  }
}

async function queryRows<T extends Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await getDbExec().execute({ sql, args });
    return result.rows as T[];
  } catch {
    return [];
  }
}

async function initializeUsageMetricsTable(sinceMs: number): Promise<void> {
  try {
    // Initializes token_usage on fresh deployments before the read-only
    // aggregate queries below. The fake owner avoids changing visible data.
    await getUsageSummary({ ownerEmail: "__dispatch_metrics_init__", sinceMs });
  } catch {
    // Metrics should still render an empty state if usage storage is locked,
    // stale, or unavailable; each aggregate read below is already best-effort.
  }
}

async function getViewerOrgRole(
  orgId: string | null,
  email: string,
): Promise<string | null> {
  if (!orgId) return null;
  const rows = await queryRows<{ role?: string }>(
    `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    [orgId, email.toLowerCase()],
  );
  const role = rows[0]?.role;
  return typeof role === "string" ? role : null;
}

async function listOrgMembers(orgId: string | null): Promise<MemberRecord[]> {
  if (!orgId) return [];
  const result = await getDbExec().execute({
    sql: `SELECT email, role, joined_at AS joined_at FROM org_members WHERE org_id = ? ORDER BY joined_at ASC`,
    args: [orgId],
  });
  const rows = result.rows as Record<string, unknown>[];
  return rows
    .map((row) => ({
      email: stringField(row, "email").trim(),
      role: stringField(row, "role") || null,
      joinedAt: nullableNumberField(row, "joined_at"),
    }))
    .filter((member) => member.email);
}

function usageScope(
  sinceMs: number,
  memberEmails: string[],
): { where: string; args: unknown[] } {
  if (memberEmails.length === 0) {
    return { where: "created_at >= ?", args: [sinceMs] };
  }
  const placeholders = memberEmails.map(() => "?").join(", ");
  return {
    where: `created_at >= ? AND LOWER(owner_email) IN (${placeholders})`,
    args: [sinceMs, ...memberEmails.map((email) => email.toLowerCase())],
  };
}

function threadScope(
  sinceMs: number,
  memberEmails: string[],
): { where: string; args: unknown[] } {
  if (memberEmails.length === 0) {
    return { where: "updated_at >= ?", args: [sinceMs] };
  }
  const placeholders = memberEmails.map(() => "?").join(", ");
  return {
    where: `updated_at >= ? AND LOWER(owner_email) IN (${placeholders})`,
    args: [sinceMs, ...memberEmails.map((email) => email.toLowerCase())],
  };
}

function ownerScope(
  sinceMs: number,
  ownerEmail: string,
): {
  where: string;
  args: unknown[];
} {
  return {
    where: "created_at >= ? AND LOWER(owner_email) = ?",
    args: [sinceMs, ownerEmail.toLowerCase()],
  };
}

function ownerThreadScope(
  sinceMs: number,
  ownerEmail: string,
): {
  where: string;
  args: unknown[];
} {
  return {
    where: "updated_at >= ? AND LOWER(owner_email) = ?",
    args: [sinceMs, ownerEmail.toLowerCase()],
  };
}

function appUsageScope(
  sinceMs: number,
  memberEmails: string[],
  appId: string,
  orgId: string | null,
): { where: string; args: unknown[] } {
  const scope = usageScope(sinceMs, memberEmails);
  const raw = appId.trim().toLowerCase();
  const normalized = normalizeAppKey(appId);
  const keys = [...new Set([raw, normalized, `agent-native-${normalized}`])];
  const orgClause = orgId?.trim() ? "org_id = ?" : "org_id IS NULL";
  const orgArgs = orgId?.trim() ? [orgId.trim()] : [];
  return {
    where: `${scope.where} AND ${orgClause} AND LOWER(COALESCE(app, '')) IN (${keys
      .map(() => "?")
      .join(", ")})`,
    args: [...scope.args, ...orgArgs, ...keys],
  };
}

function workspaceAppCreationScope(
  sinceMs: number,
  orgId: string | null,
  memberEmails: string[],
): { where: string; args: unknown[] } {
  const filters = ["created_at >= ?", "action = ?"];
  const args: unknown[] = [sinceMs, "workspace-app.pending"];

  if (orgId) {
    filters.push("org_id = ?");
    args.push(orgId);
  }
  if (memberEmails.length > 0) {
    filters.push(
      `LOWER(owner_email) IN (${memberEmails.map(() => "?").join(", ")})`,
    );
    args.push(...memberEmails.map((email) => email.toLowerCase()));
  }

  return { where: filters.join(" AND "), args };
}

function bucketFromRow(row: Record<string, unknown>): UsageMetricBucket {
  const key = stringField(row, "k");
  return {
    key,
    label: labelForKey(key),
    costCents: numberField(row, "cost_x100") / 100,
    calls: numberField(row, "calls"),
    chatCalls: numberField(row, "chat_calls"),
    inputTokens: numberField(row, "input_tokens"),
    outputTokens: numberField(row, "output_tokens"),
    cacheReadTokens: numberField(row, "cache_read_tokens"),
    cacheWriteTokens: numberField(row, "cache_write_tokens"),
    activeUsers: numberField(row, "active_users"),
    lastActiveAt: nullableNumberField(row, "last_active_at"),
  };
}

async function usageBuckets(
  columnExpression: string,
  where: string,
  args: unknown[],
  limit: number,
): Promise<UsageMetricBucket[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT ${columnExpression} AS k,
        COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
        COUNT(*) AS calls,
        SUM(CASE WHEN label = 'chat' THEN 1 ELSE 0 END) AS chat_calls,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
        COUNT(DISTINCT owner_email) AS active_users,
        MAX(created_at) AS last_active_at
      FROM token_usage
      WHERE ${where}
      GROUP BY ${columnExpression}
      ORDER BY cost_x100 DESC
      LIMIT ?`,
    [...args, limit],
  );
  return rows.map(bucketFromRow);
}

async function loadChatStats(
  where: string,
  args: unknown[],
): Promise<Map<string, ChatStats>> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT owner_email AS owner_email,
        COUNT(*) AS threads,
        COALESCE(SUM(message_count), 0) AS messages,
        MAX(updated_at) AS last_chat_at
      FROM chat_threads
      WHERE ${where}
      GROUP BY owner_email`,
    args,
  );
  return new Map(
    rows.map((row) => [
      stringField(row, "owner_email"),
      {
        threads: numberField(row, "threads"),
        messages: numberField(row, "messages"),
        lastChatAt: nullableNumberField(row, "last_chat_at"),
      },
    ]),
  );
}

async function assertCanViewMetrics(viewScope: UsageMetricsScope): Promise<{
  viewerEmail: string;
  orgId: string | null;
  role: string | null;
}> {
  const viewerEmail = currentOwnerEmail();
  const orgId = currentOrgId();
  const role = await getViewerOrgRole(orgId, viewerEmail);
  if (
    viewScope === "me" ||
    isEnvAdmin(viewerEmail) ||
    role === "owner" ||
    role === "admin"
  ) {
    return { viewerEmail, orgId, role };
  }
  if (!orgId) {
    return { viewerEmail, orgId, role };
  }
  throw new ForbiddenError(
    "Only organization owners and admins can view workspace usage metrics.",
  );
}

export async function listDispatchUsageMetrics(input: {
  sinceDays?: number;
  scope?: UsageMetricsScope;
  userEmail?: string | null;
  appId?: string | null;
}): Promise<DispatchUsageMetrics> {
  const viewScope: UsageMetricsScope =
    input.scope === "me" ? "me" : input.scope === "app" ? "app" : "workspace";
  const { viewerEmail, orgId, role } = await assertCanViewMetrics(
    viewScope === "app" ? "me" : viewScope,
  );
  const sinceDays = Math.max(1, Math.min(365, input.sinceDays ?? 30));
  const generatedAt = Date.now();
  const sinceMs = generatedAt - sinceDays * DAY_MS;
  const billing = usageBillingForEngine(await detectUsageEngineName());

  const apps = await listWorkspaceApps({ includeAgentCards: false });
  const requestedAppId = input.appId?.trim() || null;
  const selectedApp =
    viewScope === "app" && requestedAppId
      ? apps.find((app) => app.id === requestedAppId)
      : null;
  if (viewScope === "app" && !requestedAppId) {
    throw new Error("App metrics require an appId.");
  }
  if (viewScope === "app" && !selectedApp) {
    throw new ForbiddenError(
      "You do not have access to metrics for this workspace app.",
    );
  }
  const selectedAppOwner = selectedApp ? appOwner(selectedApp) : null;
  const isMetricsAdmin = Boolean(
    isEnvAdmin(viewerEmail) || role === "owner" || role === "admin",
  );
  if (
    viewScope === "app" &&
    !isMetricsAdmin &&
    selectedAppOwner?.toLowerCase() !== viewerEmail.toLowerCase()
  ) {
    throw new ForbiddenError(
      "Only the app owner or an organization owner or admin can view app metrics.",
    );
  }

  await initializeUsageMetricsTable(sinceMs);

  const rawMembers =
    viewScope === "me"
      ? [{ email: viewerEmail, role, joinedAt: null }]
      : orgId
        ? await listOrgMembers(orgId)
        : [{ email: viewerEmail, role: null, joinedAt: null }];
  const members =
    viewScope !== "me" && orgId && rawMembers.length === 0
      ? [{ email: viewerEmail, role, joinedAt: null }]
      : rawMembers;
  const requestedUserEmail =
    viewScope === "app" ? null : input.userEmail?.trim() || null;
  const selectedUserEmail =
    viewScope === "me"
      ? viewerEmail
      : requestedUserEmail
        ? (members.find(
            (member) =>
              member.email.toLowerCase() === requestedUserEmail.toLowerCase(),
          )?.email ?? null)
        : null;
  if (viewScope === "workspace" && requestedUserEmail && !selectedUserEmail) {
    throw new ForbiddenError(
      "The selected user is not available in this workspace.",
    );
  }
  const memberEmails = selectedUserEmail
    ? [selectedUserEmail]
    : members.map((member) => member.email);
  const memberByEmail = new Map(
    members.map((member) => [member.email.toLowerCase(), member]),
  );
  const usage =
    viewScope === "app" && selectedApp
      ? appUsageScope(sinceMs, memberEmails, selectedApp.id, orgId)
      : selectedUserEmail
        ? ownerScope(sinceMs, selectedUserEmail)
        : usageScope(sinceMs, memberEmails);
  const adoptionSinceMs = Math.min(sinceMs, generatedAt - 7 * DAY_MS);
  const adoptionUsage =
    viewScope === "app" && selectedApp
      ? appUsageScope(adoptionSinceMs, memberEmails, selectedApp.id, orgId)
      : selectedUserEmail
        ? ownerScope(adoptionSinceMs, selectedUserEmail)
        : usageScope(adoptionSinceMs, memberEmails);
  const threads = selectedUserEmail
    ? ownerThreadScope(sinceMs, selectedUserEmail)
    : threadScope(sinceMs, memberEmails);

  const workspaceAppCreation = workspaceAppCreationScope(
    sinceMs,
    orgId,
    memberEmails,
  );

  const [
    totalsRows,
    byApp,
    byUserBase,
    byLabel,
    byModel,
    chatStats,
    workspaceAppCreationRows,
  ] = await Promise.all([
    queryRows<Record<string, unknown>>(
      `SELECT
            COALESCE(SUM(cost_cents_x100), 0) AS cost_x100,
            COUNT(*) AS calls,
            SUM(CASE WHEN label = 'chat' THEN 1 ELSE 0 END) AS chat_calls,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
            COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
            COUNT(DISTINCT owner_email) AS active_users
          FROM token_usage
          WHERE ${usage.where}`,
      usage.args,
    ),
    usageBuckets(
      `COALESCE(NULLIF(app, ''), 'unattributed')`,
      usage.where,
      usage.args,
      20,
    ),
    usageBuckets("owner_email", usage.where, usage.args, 50),
    usageBuckets(
      `COALESCE(NULLIF(label, ''), 'chat')`,
      usage.where,
      usage.args,
      20,
    ),
    usageBuckets(
      `COALESCE(NULLIF(model, ''), 'unknown')`,
      usage.where,
      usage.args,
      20,
    ),
    viewScope === "app"
      ? Promise.resolve(new Map<string, ChatStats>())
      : loadChatStats(threads.where, threads.args),
    viewScope === "app"
      ? Promise.resolve([])
      : queryRows<Record<string, unknown>>(
          `SELECT owner_email, actor, target_id, created_at
              FROM dispatch_audit_events
              WHERE ${workspaceAppCreation.where}
              ORDER BY created_at ASC`,
          workspaceAppCreation.args,
        ),
  ]);

  const topAppRows = await queryRows<Record<string, unknown>>(
    `SELECT owner_email AS owner_email,
        COALESCE(NULLIF(app, ''), 'unattributed') AS app,
        COALESCE(SUM(cost_cents_x100), 0) AS cost_x100
      FROM token_usage
      WHERE ${usage.where}
      GROUP BY owner_email, COALESCE(NULLIF(app, ''), 'unattributed')
      ORDER BY owner_email ASC, cost_x100 DESC`,
    usage.args,
  );
  const topAppByUser = new Map<string, string>();
  for (const row of topAppRows) {
    const email = stringField(row, "owner_email");
    if (!topAppByUser.has(email)) {
      topAppByUser.set(email, stringField(row, "app"));
    }
  }

  const byUserMap = new Map<string, UserUsageMetric>();
  for (const bucket of byUserBase) {
    const ownerEmail = bucket.key;
    const stats = chatStats.get(ownerEmail) ?? {
      threads: 0,
      messages: 0,
      lastChatAt: null,
    };
    const member = memberByEmail.get(ownerEmail.toLowerCase());
    byUserMap.set(ownerEmail, {
      ...bucket,
      ownerEmail,
      chatThreads: stats.threads,
      chatMessages: stats.messages,
      lastChatAt: stats.lastChatAt,
      topApp: topAppByUser.get(ownerEmail) ?? null,
      role: member?.role ?? null,
    });
  }
  for (const [ownerEmail, stats] of chatStats) {
    if (byUserMap.has(ownerEmail)) continue;
    const member = memberByEmail.get(ownerEmail.toLowerCase());
    byUserMap.set(ownerEmail, {
      key: ownerEmail,
      label: ownerEmail,
      ownerEmail,
      costCents: 0,
      calls: 0,
      chatCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      activeUsers: 1,
      lastActiveAt: stats.lastChatAt,
      chatThreads: stats.threads,
      chatMessages: stats.messages,
      lastChatAt: stats.lastChatAt,
      topApp: null,
      role: member?.role ?? null,
    });
  }

  const dayRows = await queryRows<Record<string, unknown>>(
    `SELECT created_at, owner_email, app, label, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cost_cents_x100
      FROM token_usage
      WHERE ${adoptionUsage.where}
      ORDER BY created_at ASC`,
    adoptionUsage.args,
  );
  const dailyMap = new Map<
    string,
    { costX100: number; calls: number; chatCalls: number; users: Set<string> }
  >();
  const monthlyByUserMap = new Map<
    string,
    Omit<MonthlyUserUsageMetric, "credits">
  >();
  const appAdoptionMap = new Map<
    string,
    {
      calls: number;
      costCents: number;
      chatCalls: number;
      users: Set<string>;
      dailyUsers: Set<string>;
      weeklyUsers: Set<string>;
      lastActiveAt: number | null;
      actions: Map<
        string,
        { calls: number; users: Set<string>; lastActiveAt: number | null }
      >;
    }
  >();
  for (const row of dayRows) {
    const createdAt = numberField(row, "created_at");
    const ownerEmail = stringField(row, "owner_email");
    const isInSelectedRange = createdAt >= sinceMs;
    if (isInSelectedRange) {
      const date = new Date(createdAt).toISOString().slice(0, 10);
      const current = dailyMap.get(date) ?? {
        costX100: 0,
        calls: 0,
        chatCalls: 0,
        users: new Set<string>(),
      };
      current.costX100 += numberField(row, "cost_cents_x100");
      current.calls += 1;
      if (stringField(row, "label") === "chat") current.chatCalls += 1;
      current.users.add(ownerEmail);
      dailyMap.set(date, current);
    }

    const appKey = normalizeAppKey(stringField(row, "app"));
    const appAdoption = appAdoptionMap.get(appKey) ?? {
      calls: 0,
      costCents: 0,
      chatCalls: 0,
      users: new Set<string>(),
      dailyUsers: new Set<string>(),
      weeklyUsers: new Set<string>(),
      lastActiveAt: null,
      actions: new Map(),
    };
    if (createdAt >= generatedAt - DAY_MS) {
      appAdoption.dailyUsers.add(ownerEmail);
    }
    if (createdAt >= generatedAt - 7 * DAY_MS) {
      appAdoption.weeklyUsers.add(ownerEmail);
    }
    if (isInSelectedRange) {
      appAdoption.calls += 1;
      appAdoption.costCents += numberField(row, "cost_cents_x100") / 100;
      if (stringField(row, "label") === "chat") appAdoption.chatCalls += 1;
      appAdoption.users.add(ownerEmail);
      appAdoption.lastActiveAt = Math.max(
        appAdoption.lastActiveAt ?? 0,
        createdAt,
      );
      const label = stringField(row, "label") || "chat";
      const action = appAdoption.actions.get(label) ?? {
        calls: 0,
        users: new Set<string>(),
        lastActiveAt: null,
      };
      action.calls += 1;
      action.users.add(ownerEmail);
      action.lastActiveAt = Math.max(action.lastActiveAt ?? 0, createdAt);
      appAdoption.actions.set(label, action);
    }
    appAdoptionMap.set(appKey, appAdoption);

    if (!isInSelectedRange) continue;
    const date = new Date(createdAt).toISOString().slice(0, 10);
    const month = date.slice(0, 7);
    const monthlyKey = `${ownerEmail}\u0000${month}`;
    const monthly = monthlyByUserMap.get(monthlyKey) ?? {
      month,
      ownerEmail,
      costCents: 0,
      calls: 0,
      chatCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    monthly.costCents += numberField(row, "cost_cents_x100") / 100;
    monthly.calls += 1;
    if (stringField(row, "label") === "chat") monthly.chatCalls += 1;
    monthly.inputTokens += numberField(row, "input_tokens");
    monthly.outputTokens += numberField(row, "output_tokens");
    monthly.cacheReadTokens += numberField(row, "cache_read_tokens");
    monthly.cacheWriteTokens += numberField(row, "cache_write_tokens");
    monthlyByUserMap.set(monthlyKey, monthly);
  }
  const daily = [...dailyMap.entries()]
    .map(([date, value]) => ({
      date,
      costCents: value.costX100 / 100,
      calls: value.calls,
      chatCalls: value.chatCalls,
      activeUsers: value.users.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthlyByUser =
    viewScope === "app"
      ? []
      : [...monthlyByUserMap.values()]
          .map((row) => ({
            ...row,
            credits: builderCreditsFromCostCents(row.costCents),
          }))
          .sort(
            (a, b) =>
              a.month.localeCompare(b.month) ||
              a.ownerEmail.localeCompare(b.ownerEmail),
          );

  const workspaceAppCreationMap = new Map<
    string,
    { month: string; ownerEmail: string; count: number; appIds: Set<string> }
  >();
  for (const row of workspaceAppCreationRows) {
    const month = new Date(numberField(row, "created_at"))
      .toISOString()
      .slice(0, 7);
    const ownerEmail =
      stringField(row, "owner_email") || stringField(row, "actor");
    if (!ownerEmail) continue;
    const key = `${ownerEmail}\u0000${month}`;
    const current = workspaceAppCreationMap.get(key) ?? {
      month,
      ownerEmail,
      count: 0,
      appIds: new Set<string>(),
    };
    current.count += 1;
    const appId = stringField(row, "target_id");
    if (appId) current.appIds.add(appId);
    workspaceAppCreationMap.set(key, current);
  }
  const workspaceAppCreationsByUserMonth = [...workspaceAppCreationMap.values()]
    .map(({ appIds, ...row }) => ({
      ...row,
      appIds: [...appIds].sort(),
    }))
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.ownerEmail.localeCompare(b.ownerEmail),
    );

  const recentRows =
    viewScope === "app"
      ? []
      : await queryRows<Record<string, unknown>>(
          `SELECT id, created_at, owner_email, app, label, model,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
              cost_cents_x100, thread_id, run_id, task_id, source_platform, source_id
            FROM token_usage
            WHERE ${usage.where}
            ORDER BY created_at DESC
            LIMIT 50`,
          usage.args,
        );
  const recent =
    viewScope === "app" ? [] : await hydrateRecentPrompts(recentRows);

  const appUsageByKey = new Map(
    byApp.map((bucket) => [normalizeAppKey(bucket.key), bucket]),
  );
  const accessUsers = members.length || byUserMap.size;
  const accessModel =
    viewScope === "me" ? "solo" : orgId ? "workspace" : "solo";
  const accessLabel =
    viewScope === "me"
      ? "Your account"
      : orgId
        ? "Workspace members"
        : "Signed-in users";
  const appRows = selectedApp ? [selectedApp] : apps;
  const appAccess = appRows.map((app) => {
    const usageBucket = appUsageByKey.get(normalizeAppKey(app.id));
    const adoption = appAdoptionMap.get(normalizeAppKey(app.id));
    const ownerEmail = appOwner(app);
    const isOwnedByViewer =
      ownerEmail?.toLowerCase() === viewerEmail.toLowerCase();
    const canViewUsage = isMetricsAdmin || isOwnedByViewer;
    const visibleUsageBucket = canViewUsage ? usageBucket : undefined;
    const visibleAdoption = canViewUsage ? adoption : undefined;
    return {
      id: app.id,
      name: app.name,
      path: app.path,
      status: app.status,
      statusLabel: app.statusLabel,
      isDispatch: app.isDispatch,
      accessModel,
      accessLabel,
      accessUsers,
      ownerEmail: canViewUsage ? ownerEmail : null,
      isOwnedByViewer,
      canViewUsage,
      usersWithUsage:
        visibleAdoption?.users.size ?? visibleUsageBucket?.activeUsers ?? 0,
      dailyActiveUsers: visibleAdoption?.dailyUsers.size ?? 0,
      weeklyActiveUsers: visibleAdoption?.weeklyUsers.size ?? 0,
      usageCalls: visibleAdoption?.calls ?? visibleUsageBucket?.calls ?? 0,
      chatCalls:
        visibleAdoption?.chatCalls ?? visibleUsageBucket?.chatCalls ?? 0,
      costCents:
        visibleAdoption?.costCents ?? visibleUsageBucket?.costCents ?? 0,
      lastActiveAt:
        visibleAdoption?.lastActiveAt ??
        visibleUsageBucket?.lastActiveAt ??
        null,
      actionMetrics: visibleAdoption
        ? [...visibleAdoption.actions.entries()]
            .map(([key, action]) => ({
              key,
              label: labelForKey(key),
              calls: action.calls,
              activeUsers: action.users.size,
              lastActiveAt: action.lastActiveAt,
            }))
            .sort((a, b) => b.calls - a.calls)
        : [],
    } satisfies AppAccessMetric;
  });

  const totals = totalsRows[0] ?? {};
  const chatThreadTotals = [...chatStats.values()].reduce(
    (acc, value) => ({
      threads: acc.threads + value.threads,
      messages: acc.messages + value.messages,
    }),
    { threads: 0, messages: 0 },
  );

  return {
    billing,
    viewScope,
    selectedUserEmail,
    selectedAppId: selectedApp?.id ?? null,
    availableUsers:
      viewScope === "app"
        ? []
        : members
            .map(({ email, role }) => ({ email, role }))
            .sort((a, b) => a.email.localeCompare(b.email)),
    sinceMs,
    sinceDays,
    generatedAt,
    access: {
      viewerEmail,
      orgId,
      role,
      scope: orgId ? "organization" : "solo",
      totalUsers: accessUsers,
    },
    totals: {
      costCents: numberField(totals, "cost_x100") / 100,
      calls: numberField(totals, "calls"),
      chatCalls: numberField(totals, "chat_calls"),
      inputTokens: numberField(totals, "input_tokens"),
      outputTokens: numberField(totals, "output_tokens"),
      cacheReadTokens: numberField(totals, "cache_read_tokens"),
      cacheWriteTokens: numberField(totals, "cache_write_tokens"),
      activeUsers: numberField(totals, "active_users"),
      chatThreads: chatThreadTotals.threads,
      chatMessages: chatThreadTotals.messages,
      workspaceApps: appRows.filter((app) => !app.isDispatch).length,
    },
    byApp,
    byUser:
      viewScope === "app"
        ? []
        : [...byUserMap.values()].sort((a, b) => {
            if (b.costCents !== a.costCents) return b.costCents - a.costCents;
            return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
          }),
    byLabel,
    byModel,
    daily,
    monthlyByUser,
    workspaceAppCreationsByUserMonth,
    appAccess,
    recent,
  };
}
