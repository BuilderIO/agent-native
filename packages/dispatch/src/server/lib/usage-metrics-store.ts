import { getUsageSummary } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { currentOrgId, currentOwnerEmail } from "./dispatch-store.js";
import {
  listWorkspaceApps,
  type WorkspaceAppSummary,
} from "./app-creation-store.js";

const DAY_MS = 86_400_000;

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

export interface AppAccessMetric {
  id: string;
  name: string;
  path: string;
  status: WorkspaceAppSummary["status"];
  isDispatch: boolean;
  accessModel: "workspace" | "solo";
  accessLabel: string;
  accessUsers: number;
  usersWithUsage: number;
  usageCalls: number;
  chatCalls: number;
  costCents: number;
  lastActiveAt: number | null;
}

export interface DailyUsageMetric {
  date: string;
  costCents: number;
  calls: number;
  chatCalls: number;
  activeUsers: number;
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
}

export interface DispatchUsageMetrics {
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
  return String(row[key] ?? "");
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

function labelForKey(value: string): string {
  const trimmed = value.trim();
  return trimmed || "Unattributed";
}

function normalizeAppKey(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "unattributed";
  return raw.replace(/^agent-native-/, "");
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

async function listOrgMembers(
  orgId: string | null,
): Promise<MemberRecord[]> {
  if (!orgId) return [];
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT email, role, joined_at AS joined_at FROM org_members WHERE org_id = ? ORDER BY joined_at ASC`,
    [orgId],
  );
  return rows
    .map((row) => ({
      email: stringField(row, "email").trim(),
      role: stringField(row, "role") || null,
      joinedAt: nullableNumberField(row, "joined_at"),
    }))
    .filter((member) => member.email);
}

async function listSignedInUsers(): Promise<MemberRecord[]> {
  const authRows = await queryRows<Record<string, unknown>>(
    `SELECT email, created_at AS joined_at FROM "user" ORDER BY created_at ASC`,
  );
  if (authRows.length > 0) {
    return authRows
      .map((row) => ({
        email: stringField(row, "email").trim(),
        role: null,
        joinedAt: nullableNumberField(row, "joined_at"),
      }))
      .filter((member) => member.email);
  }

  const usageRows = await queryRows<{ email?: string }>(
    `SELECT DISTINCT owner_email AS email FROM token_usage`,
  );
  const threadRows = await queryRows<{ email?: string }>(
    `SELECT DISTINCT owner_email AS email FROM chat_threads`,
  );
  const emails = new Set<string>();
  for (const row of [...usageRows, ...threadRows]) {
    if (row.email) emails.add(row.email);
  }
  return [...emails].sort().map((email) => ({
    email,
    role: null,
    joinedAt: null,
  }));
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
    where: `created_at >= ? AND owner_email IN (${placeholders})`,
    args: [sinceMs, ...memberEmails],
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
    where: `updated_at >= ? AND owner_email IN (${placeholders})`,
    args: [sinceMs, ...memberEmails],
  };
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

async function assertCanViewMetrics(): Promise<{
  viewerEmail: string;
  orgId: string | null;
  role: string | null;
}> {
  const viewerEmail = currentOwnerEmail();
  const orgId = currentOrgId();
  const role = await getViewerOrgRole(orgId, viewerEmail);
  if (isEnvAdmin(viewerEmail) || role === "owner" || role === "admin") {
    return { viewerEmail, orgId, role };
  }
  if (!orgId) {
    return { viewerEmail, orgId, role };
  }
  throw new Error(
    "Only organization owners and admins can view workspace usage metrics.",
  );
}

export async function listDispatchUsageMetrics(input: {
  sinceDays?: number;
}): Promise<DispatchUsageMetrics> {
  const { viewerEmail, orgId, role } = await assertCanViewMetrics();
  const sinceDays = Math.max(1, Math.min(365, input.sinceDays ?? 30));
  const sinceMs = Date.now() - sinceDays * DAY_MS;

  // Initializes token_usage on fresh deployments before the read-only
  // aggregate queries below. The fake owner avoids changing visible data.
  await getUsageSummary({ ownerEmail: "__dispatch_metrics_init__", sinceMs });

  const members = orgId ? await listOrgMembers(orgId) : await listSignedInUsers();
  const memberEmails = orgId ? members.map((member) => member.email) : [];
  const memberByEmail = new Map(
    members.map((member) => [member.email.toLowerCase(), member]),
  );
  const usage = usageScope(sinceMs, memberEmails);
  const threads = threadScope(sinceMs, memberEmails);

  const [apps, totalsRows, byApp, byUserBase, byLabel, byModel, chatStats] =
    await Promise.all([
      listWorkspaceApps({ includeAgentCards: false }),
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
      loadChatStats(threads.where, threads.args),
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
    `SELECT created_at, owner_email, label, cost_cents_x100
      FROM token_usage
      WHERE ${usage.where}
      ORDER BY created_at ASC`,
    usage.args,
  );
  const dailyMap = new Map<
    string,
    { costX100: number; calls: number; chatCalls: number; users: Set<string> }
  >();
  for (const row of dayRows) {
    const date = new Date(numberField(row, "created_at"))
      .toISOString()
      .slice(0, 10);
    const current =
      dailyMap.get(date) ??
      { costX100: 0, calls: 0, chatCalls: 0, users: new Set<string>() };
    current.costX100 += numberField(row, "cost_cents_x100");
    current.calls += 1;
    if (stringField(row, "label") === "chat") current.chatCalls += 1;
    current.users.add(stringField(row, "owner_email"));
    dailyMap.set(date, current);
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

  const recentRows = await queryRows<Record<string, unknown>>(
    `SELECT id, created_at, owner_email, app, label, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_cents_x100
      FROM token_usage
      WHERE ${usage.where}
      ORDER BY created_at DESC
      LIMIT 50`,
    usage.args,
  );
  const recent = recentRows.map((row) => ({
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
  }));

  const appUsageByKey = new Map(
    byApp.map((bucket) => [normalizeAppKey(bucket.key), bucket]),
  );
  const accessUsers = members.length || byUserMap.size;
  const accessModel = orgId ? "workspace" : "solo";
  const accessLabel = orgId ? "Workspace members" : "Signed-in users";
  const appAccess = apps.map((app) => {
    const usageBucket = appUsageByKey.get(normalizeAppKey(app.id));
    return {
      id: app.id,
      name: app.name,
      path: app.path,
      status: app.status,
      isDispatch: app.isDispatch,
      accessModel,
      accessLabel,
      accessUsers,
      usersWithUsage: usageBucket?.activeUsers ?? 0,
      usageCalls: usageBucket?.calls ?? 0,
      chatCalls: usageBucket?.chatCalls ?? 0,
      costCents: usageBucket?.costCents ?? 0,
      lastActiveAt: usageBucket?.lastActiveAt ?? null,
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
    sinceMs,
    sinceDays,
    generatedAt: Date.now(),
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
      workspaceApps: apps.filter((app) => !app.isDispatch).length,
    },
    byApp,
    byUser: [...byUserMap.values()].sort((a, b) => {
      if (b.costCents !== a.costCents) return b.costCents - a.costCents;
      return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
    }),
    byLabel,
    byModel,
    daily,
    appAccess,
    recent,
  };
}
