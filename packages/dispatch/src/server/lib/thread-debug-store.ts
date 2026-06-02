import { createDbExec, getDbExec, type DbExec } from "@agent-native/core/db";
import { currentOrgId, currentOwnerEmail } from "./dispatch-store.js";

const CONFIG_ENV_KEY = "AGENT_NATIVE_THREAD_DEBUG_DATABASES";
const MAX_RAW_PREVIEW_CHARS = 1_500;
const DEFAULT_SEARCH_LIMIT = 25;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_RUN_LIMIT = 20;
const DEFAULT_EVENT_LIMIT = 600;
const DEFAULT_TRACE_SPAN_LIMIT = 500;

interface ThreadDebugSourceConfig {
  id: string;
  label: string;
  kind: "current" | "env" | "configured";
  databaseUrl?: string;
  databaseAuthToken?: string;
  databaseUrlEnv?: string | null;
  databaseAuthTokenEnv?: string | null;
}

export interface ThreadDebugSource {
  id: string;
  label: string;
  kind: "current" | "env" | "configured";
  current: boolean;
  connected: boolean;
  databaseUrlEnv: string | null;
  databaseAuthTokenEnv: string | null;
  canInspectAll: boolean;
}

interface DebugAccess {
  viewerEmail: string;
  orgId: string | null;
  role: string | null;
  envAdmin: boolean;
  canInspectAll: boolean;
  memberEmails: string[];
}

interface OwnerScope {
  sql: string;
  args: unknown[];
  label: string;
}

interface ChatThreadRow {
  id: string;
  owner_email: string;
  title: string | null;
  preview: string | null;
  thread_data: string | null;
  message_count: number | string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface AgentRunRow {
  id: string;
  thread_id: string;
  status: string;
  abort_reason?: string | null;
  started_at: number | string;
  completed_at?: number | string | null;
  heartbeat_at?: number | string | null;
}

const execCache = new Map<string, Promise<DbExec>>();

function envEmails(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function isEnvAdmin(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return [
    ...envEmails("DISPATCH_ADMIN_EMAILS"),
    ...envEmails("WORKSPACE_OWNER_EMAIL"),
    ...envEmails("DISPATCH_DEFAULT_OWNER_EMAIL"),
  ].includes(normalized);
}

function isMissingTableError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("does not exist") ||
    message.includes("unknown table") ||
    message.includes("undefined table")
  );
}

async function optionalRows<T = Record<string, unknown>>(
  exec: DbExec,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  try {
    return (await exec.execute({ sql, args })).rows as T[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

async function queryRows<T = Record<string, unknown>>(
  exec: DbExec,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  try {
    return (await exec.execute({ sql, args })).rows as T[];
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new Error(
        "This database does not have agent chat thread tables yet.",
      );
    }
    throw error;
  }
}

function numberField(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumberField(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => {
      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part?.type === "tool-call") {
        const name = part.toolName ?? part.name ?? "tool";
        return `[tool:${name}] ${safeJsonStringify(part.args ?? part.input ?? {})}`;
      }
      if (part?.type === "tool-result") {
        return `[tool-result:${part.toolName ?? part.toolCallId ?? "tool"}] ${
          typeof part.content === "string"
            ? part.content
            : safeJsonStringify(part.content)
        }`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeMessages(threadData: any) {
  const messages = Array.isArray(threadData?.messages)
    ? threadData.messages
    : [];
  return messages.map((entry: any, index: number) => {
    const message = entry?.message ?? entry;
    const content = message?.content;
    const contentParts = Array.isArray(content) ? content : [];
    return {
      index,
      id: typeof message?.id === "string" ? message.id : null,
      role: typeof message?.role === "string" ? message.role : "unknown",
      createdAt: message?.createdAt ?? null,
      status: message?.status ?? null,
      text: textFromContent(content),
      contentParts,
      attachments: Array.isArray(message?.attachments)
        ? message.attachments
        : [],
      metadata: message?.metadata ?? null,
      parentId: entry?.parentId ?? null,
    };
  });
}

function snippetFor(row: ChatThreadRow, query: string): string {
  const raw = `${row.title ?? ""}\n${row.preview ?? ""}\n${row.thread_data ?? ""}`;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!query.trim()) {
    return compact.slice(0, MAX_RAW_PREVIEW_CHARS);
  }
  const lower = compact.toLowerCase();
  const needle = query.trim().toLowerCase();
  const match = lower.indexOf(needle);
  if (match === -1) return compact.slice(0, MAX_RAW_PREVIEW_CHARS);
  const start = Math.max(0, match - 160);
  const end = Math.min(compact.length, match + needle.length + 320);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  return `${prefix}${compact.slice(start, end)}${suffix}`;
}

function envPrefixForSourceId(sourceId: string): string {
  return sourceId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function sourceIdFromEnvPrefix(prefix: string): string {
  return prefix.toLowerCase().replace(/_/g, "-");
}

function labelFromSourceId(sourceId: string): string {
  return sourceId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function currentDatabaseUrlEnv(): string | null {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName && process.env[`${appName}_DATABASE_URL`]) {
    return `${appName}_DATABASE_URL`;
  }
  return process.env.DATABASE_URL ? "DATABASE_URL" : null;
}

function parseConfiguredSources(): ThreadDebugSourceConfig[] {
  const raw = process.env[CONFIG_ENV_KEY];
  if (!raw) return [];
  const parsed = safeJsonParse<any>(raw, null);
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed).map(([id, value]) => ({ id, ...(value as any) }))
      : [];

  return entries
    .map((entry: any): ThreadDebugSourceConfig | null => {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (!id) return null;
      const databaseUrlEnv =
        typeof entry.databaseUrlEnv === "string"
          ? entry.databaseUrlEnv.trim()
          : null;
      const databaseAuthTokenEnv =
        typeof entry.databaseAuthTokenEnv === "string"
          ? entry.databaseAuthTokenEnv.trim()
          : null;
      const databaseUrl =
        typeof entry.databaseUrl === "string" && entry.databaseUrl.trim()
          ? entry.databaseUrl.trim()
          : databaseUrlEnv
            ? process.env[databaseUrlEnv]
            : undefined;
      if (!databaseUrl) return null;
      return {
        id,
        label:
          typeof entry.label === "string" && entry.label.trim()
            ? entry.label.trim()
            : labelFromSourceId(id),
        kind: "configured",
        databaseUrl,
        databaseAuthToken:
          typeof entry.databaseAuthToken === "string"
            ? entry.databaseAuthToken
            : databaseAuthTokenEnv
              ? process.env[databaseAuthTokenEnv]
              : undefined,
        databaseUrlEnv,
        databaseAuthTokenEnv,
      };
    })
    .filter((source): source is ThreadDebugSourceConfig => Boolean(source));
}

function discoverEnvSources(): ThreadDebugSourceConfig[] {
  const ignored = new Set([
    "DATABASE_URL",
    "NETLIFY_DATABASE_URL",
    "NETLIFY_DATABASE_URL_UNPOOLED",
  ]);
  const currentAppPrefix = process.env.APP_NAME?.toUpperCase().replace(
    /-/g,
    "_",
  );
  const sources: ThreadDebugSourceConfig[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !key.endsWith("_DATABASE_URL")) continue;
    if (ignored.has(key) || key.endsWith("_UNPOOLED_DATABASE_URL")) continue;
    const prefix = key.slice(0, -"_DATABASE_URL".length);
    if (!prefix || prefix === "NETLIFY") continue;
    if (currentAppPrefix && prefix === currentAppPrefix) continue;
    const id = sourceIdFromEnvPrefix(prefix);
    const tokenEnv = `${prefix}_DATABASE_AUTH_TOKEN`;
    sources.push({
      id,
      label: labelFromSourceId(id),
      kind: "env",
      databaseUrl: value,
      databaseAuthToken: process.env[tokenEnv],
      databaseUrlEnv: key,
      databaseAuthTokenEnv: process.env[tokenEnv] ? tokenEnv : null,
    });
  }
  return sources;
}

function sourceConfigs(): ThreadDebugSourceConfig[] {
  const byId = new Map<string, ThreadDebugSourceConfig>();
  byId.set("current", {
    id: "current",
    label: "Current Dispatch DB",
    kind: "current",
    databaseUrlEnv: currentDatabaseUrlEnv(),
    databaseAuthTokenEnv: process.env.DATABASE_AUTH_TOKEN
      ? "DATABASE_AUTH_TOKEN"
      : null,
  });
  for (const source of discoverEnvSources()) byId.set(source.id, source);
  for (const source of parseConfiguredSources()) byId.set(source.id, source);
  return [...byId.values()];
}

function resolveSourceConfig(sourceId = "current"): ThreadDebugSourceConfig {
  const normalized = sourceId.trim() || "current";
  const direct = sourceConfigs().find((source) => source.id === normalized);
  if (direct) return direct;

  const prefix = envPrefixForSourceId(normalized);
  const databaseUrlEnv = `${prefix}_DATABASE_URL`;
  const databaseUrl = process.env[databaseUrlEnv];
  if (!databaseUrl) {
    throw new Error(`Thread debug source "${normalized}" is not configured.`);
  }
  const tokenEnv = `${prefix}_DATABASE_AUTH_TOKEN`;
  return {
    id: normalized,
    label: labelFromSourceId(normalized),
    kind: "env",
    databaseUrl,
    databaseAuthToken: process.env[tokenEnv],
    databaseUrlEnv,
    databaseAuthTokenEnv: process.env[tokenEnv] ? tokenEnv : null,
  };
}

async function execForSource(source: ThreadDebugSourceConfig): Promise<DbExec> {
  if (source.kind === "current") return getDbExec();
  const cacheKey = `${source.databaseUrl ?? ""}\n${source.databaseAuthToken ?? ""}`;
  if (!execCache.has(cacheKey)) {
    execCache.set(
      cacheKey,
      createDbExec({
        url: source.databaseUrl,
        authToken: source.databaseAuthToken,
      }),
    );
  }
  return execCache.get(cacheKey)!;
}

async function currentDbRows<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return optionalRows<T>(getDbExec(), sql, args);
}

async function viewerOrgRole(
  orgId: string | null,
  viewerEmail: string,
): Promise<string | null> {
  if (!orgId) return null;
  const rows = await currentDbRows<{ role?: string }>(
    `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    [orgId, viewerEmail.toLowerCase()],
  );
  return typeof rows[0]?.role === "string" ? rows[0].role : null;
}

async function currentOrgMembers(orgId: string | null): Promise<string[]> {
  if (!orgId) return [];
  const rows = await currentDbRows<{ email?: string }>(
    `SELECT email FROM org_members WHERE org_id = ?`,
    [orgId],
  );
  return rows.map((row) => String(row.email ?? "").trim()).filter(Boolean);
}

async function resolveDebugAccess(): Promise<DebugAccess> {
  const viewerEmail = currentOwnerEmail();
  const orgId = currentOrgId();
  const role = await viewerOrgRole(orgId, viewerEmail);
  const envAdmin = isEnvAdmin(viewerEmail);
  const canInspectAll = envAdmin || role === "owner" || role === "admin";
  const memberEmails = canInspectAll
    ? await currentOrgMembers(orgId)
    : [viewerEmail];
  return {
    viewerEmail,
    orgId,
    role,
    envAdmin,
    canInspectAll,
    memberEmails: memberEmails.length > 0 ? memberEmails : [viewerEmail],
  };
}

function assertSourceAccess(
  source: ThreadDebugSourceConfig,
  access: DebugAccess,
) {
  if (source.kind === "current") return;
  if (!access.canInspectAll) {
    throw new Error(
      "Only Dispatch admins can inspect thread databases from other apps.",
    );
  }
}

function ownerScope(access: DebugAccess, ownerEmail?: string): OwnerScope {
  const requested = ownerEmail?.trim();
  if (!access.canInspectAll) {
    return {
      sql: "owner_email = ?",
      args: [access.viewerEmail],
      label: access.viewerEmail,
    };
  }

  if (requested && requested !== "*") {
    return {
      sql: "owner_email = ?",
      args: [requested],
      label: requested,
    };
  }

  if (access.envAdmin && !access.orgId) {
    return { sql: "1 = 1", args: [], label: "all users" };
  }

  const emails = access.memberEmails;
  if (emails.length === 0) {
    return {
      sql: "owner_email = ?",
      args: [access.viewerEmail],
      label: access.viewerEmail,
    };
  }
  const placeholders = emails.map(() => "?").join(", ");
  return {
    sql: `owner_email IN (${placeholders})`,
    args: emails,
    label: access.orgId ? "current organization" : "all users",
  };
}

function serializeThreadSummary(row: ChatThreadRow, query = "") {
  return {
    id: String(row.id),
    ownerEmail: String(row.owner_email ?? ""),
    title: String(row.title ?? ""),
    preview: String(row.preview ?? ""),
    messageCount: numberField(row.message_count),
    createdAt: numberField(row.created_at),
    updatedAt: numberField(row.updated_at),
    snippet: snippetFor(row, query),
  };
}

function serializeRun(row: AgentRunRow, events: any[] = []) {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    status: String(row.status),
    abortReason: row.abort_reason ? String(row.abort_reason) : null,
    startedAt: numberField(row.started_at),
    completedAt: nullableNumberField(row.completed_at),
    heartbeatAt: nullableNumberField(row.heartbeat_at),
    events,
  };
}

function parseRunEvent(row: Record<string, unknown>) {
  const raw = String(row.event_data ?? "");
  return {
    runId: String(row.run_id ?? ""),
    seq: numberField(row.seq),
    event: safeJsonParse(raw, { type: "unparseable", raw }),
    rawEventData: raw,
  };
}

export async function listThreadDebugSources(): Promise<{
  access: Omit<DebugAccess, "memberEmails" | "envAdmin"> & {
    envAdmin: boolean;
    memberCount: number;
  };
  sources: ThreadDebugSource[];
}> {
  const access = await resolveDebugAccess();
  return {
    access: {
      viewerEmail: access.viewerEmail,
      orgId: access.orgId,
      role: access.role,
      envAdmin: access.envAdmin,
      canInspectAll: access.canInspectAll,
      memberCount: access.memberEmails.length,
    },
    sources: sourceConfigs().map((source) => ({
      id: source.id,
      label: source.label,
      kind: source.kind,
      current: source.kind === "current",
      connected: source.kind === "current" || Boolean(source.databaseUrl),
      databaseUrlEnv: source.databaseUrlEnv ?? null,
      databaseAuthTokenEnv: source.databaseAuthTokenEnv ?? null,
      canInspectAll: access.canInspectAll,
    })),
  };
}

export async function searchAgentThreads(input: {
  sourceId?: string;
  query?: string;
  ownerEmail?: string;
  limit?: number;
}) {
  const source = resolveSourceConfig(input.sourceId ?? "current");
  const access = await resolveDebugAccess();
  assertSourceAccess(source, access);
  const exec = await execForSource(source);
  const limit = Math.max(
    1,
    Math.min(MAX_SEARCH_LIMIT, input.limit ?? DEFAULT_SEARCH_LIMIT),
  );
  const q = input.query?.trim() ?? "";
  const scope = ownerScope(access, input.ownerEmail);
  const where = [scope.sql];
  const args: unknown[] = [...scope.args];
  if (q) {
    const pattern = `%${escapeLike(q.toLowerCase())}%`;
    where.push(
      `(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(preview) LIKE ? ESCAPE '\\' OR LOWER(thread_data) LIKE ? ESCAPE '\\')`,
    );
    args.push(pattern, pattern, pattern);
  }
  args.push(limit);

  const rows = await optionalRows<ChatThreadRow>(
    exec,
    `SELECT id, owner_email, title, preview, thread_data, message_count, created_at, updated_at
       FROM chat_threads
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?`,
    args,
  );
  return {
    source: {
      id: source.id,
      label: source.label,
      kind: source.kind,
      databaseUrlEnv: source.databaseUrlEnv ?? null,
    },
    access: {
      viewerEmail: access.viewerEmail,
      scope: scope.label,
      canInspectAll: access.canInspectAll,
    },
    query: q,
    count: rows.length,
    threads: rows.map((row) => serializeThreadSummary(row, q)),
  };
}

export async function getAgentThreadDebug(input: {
  sourceId?: string;
  threadId: string;
  ownerEmail?: string;
  maxRuns?: number;
  maxEvents?: number;
  maxTraceSpans?: number;
}) {
  const source = resolveSourceConfig(input.sourceId ?? "current");
  const access = await resolveDebugAccess();
  assertSourceAccess(source, access);
  const exec = await execForSource(source);
  const scope = ownerScope(access, input.ownerEmail);
  const rows = await queryRows<ChatThreadRow>(
    exec,
    `SELECT id, owner_email, title, preview, thread_data, message_count, created_at, updated_at
       FROM chat_threads
      WHERE id = ? AND ${scope.sql}
      LIMIT 1`,
    [input.threadId, ...scope.args],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Thread "${input.threadId}" was not found.`);
  }

  const threadData = safeJsonParse<Record<string, unknown>>(
    row.thread_data,
    {},
  );
  const maxRuns = Math.max(1, Math.min(50, input.maxRuns ?? DEFAULT_RUN_LIMIT));
  const maxEvents = Math.max(
    1,
    Math.min(2_000, input.maxEvents ?? DEFAULT_EVENT_LIMIT),
  );
  const maxTraceSpans = Math.max(
    1,
    Math.min(2_000, input.maxTraceSpans ?? DEFAULT_TRACE_SPAN_LIMIT),
  );

  const runRows = await optionalRows<AgentRunRow>(
    exec,
    `SELECT id, thread_id, status, abort_reason, started_at, heartbeat_at, completed_at
       FROM agent_runs
      WHERE thread_id = ?
      ORDER BY started_at DESC
      LIMIT ?`,
    [row.id, maxRuns],
  );

  const runs = [];
  for (const run of runRows) {
    const eventRows = await optionalRows<Record<string, unknown>>(
      exec,
      `SELECT run_id, seq, event_data
         FROM agent_run_events
        WHERE run_id = ?
        ORDER BY seq ASC
        LIMIT ?`,
      [run.id, maxEvents],
    );
    runs.push(serializeRun(run, eventRows.map(parseRunEvent)));
  }

  const runIds = runRows.map((run) => run.id);
  const runPlaceholders = runIds.map(() => "?").join(", ");
  const traceSummaryRows = await optionalRows<Record<string, unknown>>(
    exec,
    runIds.length > 0
      ? `SELECT *
           FROM agent_trace_summaries
          WHERE thread_id = ? OR run_id IN (${runPlaceholders})
          ORDER BY created_at DESC
          LIMIT 50`
      : `SELECT *
           FROM agent_trace_summaries
          WHERE thread_id = ?
          ORDER BY created_at DESC
          LIMIT 50`,
    runIds.length > 0 ? [row.id, ...runIds] : [row.id],
  );
  const traceSpanRows = await optionalRows<Record<string, unknown>>(
    exec,
    runIds.length > 0
      ? `SELECT *
           FROM agent_trace_spans
          WHERE thread_id = ? OR run_id IN (${runPlaceholders})
          ORDER BY created_at ASC
          LIMIT ?`
      : `SELECT *
           FROM agent_trace_spans
          WHERE thread_id = ?
          ORDER BY created_at ASC
          LIMIT ?`,
    runIds.length > 0
      ? [row.id, ...runIds, maxTraceSpans]
      : [row.id, maxTraceSpans],
  );
  const feedbackRows = await optionalRows<Record<string, unknown>>(
    exec,
    `SELECT *
       FROM agent_feedback
      WHERE thread_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [row.id],
  );
  const satisfactionRows = await optionalRows<Record<string, unknown>>(
    exec,
    `SELECT *
       FROM agent_satisfaction_scores
      WHERE thread_id = ?
      ORDER BY computed_at DESC
      LIMIT 10`,
    [row.id],
  );
  const evalRows = await optionalRows<Record<string, unknown>>(
    exec,
    runIds.length > 0
      ? `SELECT *
           FROM agent_evals
          WHERE thread_id = ? OR run_id IN (${runPlaceholders})
          ORDER BY created_at DESC
          LIMIT 50`
      : `SELECT *
           FROM agent_evals
          WHERE thread_id = ?
          ORDER BY created_at DESC
          LIMIT 50`,
    runIds.length > 0 ? [row.id, ...runIds] : [row.id],
  );
  const checkpointRows = await optionalRows<Record<string, unknown>>(
    exec,
    `SELECT id, thread_id, run_id, commit_sha, message, created_at
       FROM agent_checkpoints
      WHERE thread_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [row.id],
  );

  return {
    source: {
      id: source.id,
      label: source.label,
      kind: source.kind,
      databaseUrlEnv: source.databaseUrlEnv ?? null,
    },
    access: {
      viewerEmail: access.viewerEmail,
      scope: scope.label,
      canInspectAll: access.canInspectAll,
    },
    thread: {
      id: String(row.id),
      ownerEmail: String(row.owner_email ?? ""),
      title: String(row.title ?? ""),
      preview: String(row.preview ?? ""),
      messageCount: numberField(row.message_count),
      createdAt: numberField(row.created_at),
      updatedAt: numberField(row.updated_at),
    },
    messages: normalizeMessages(threadData),
    debug: (threadData as any)?._debug ?? null,
    debugRuns: Array.isArray((threadData as any)?._debugRuns)
      ? (threadData as any)._debugRuns
      : [],
    queuedMessages: (threadData as any)?.queuedMessages ?? [],
    threadData,
    rawThreadData: row.thread_data ?? "",
    runs,
    traces: {
      summaries: traceSummaryRows,
      spans: traceSpanRows,
    },
    feedback: feedbackRows,
    satisfaction: satisfactionRows,
    evals: evalRows,
    checkpoints: checkpointRows,
  };
}
