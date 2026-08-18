import {
  classifyAgentFailure,
  type AgentFailureRegime,
} from "@agent-native/core/agent/engine";
import { createDbExec, getDbExec, type DbExec } from "@agent-native/core/db";
import { ForbiddenError } from "@agent-native/core/sharing";

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

export interface DebugAccess {
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
  turn_id?: string | null;
  last_progress_at?: number | string | null;
  error_code?: string | null;
  error_detail?: string | null;
  terminal_reason?: string | null;
  dispatch_mode?: string | null;
  worker_stage?: string | null;
  diag_stage?: string | null;
  peak_rss_mb?: number | string | null;
  in_flight_since?: number | string | null;
  dispatch_payload?: string | null;
}

const execCache = new Map<string, Promise<DbExec>>();

const UNSUCCESSFUL_RUN_STATUSES = ["errored", "aborted", "truncated"] as const;

export type AgentRunFailureStatus = (typeof UNSUCCESSFUL_RUN_STATUSES)[number];

type ThreadDebugSourceHealthStatus =
  | "ok"
  | "disconnected"
  | "unsupported"
  | "unavailable";

interface AgentRunFailureRow extends AgentRunRow {
  debug_owner_email: string;
  debug_thread_title?: string | null;
  debug_thread_preview?: string | null;
  debug_terminal_event_data?: string | null;
}

class UnsupportedThreadDebugSchemaError extends Error {
  readonly code = "thread_debug_schema_unsupported";

  constructor(readonly table: string) {
    super(`This database does not have the required "${table}" table.`);
    this.name = "UnsupportedThreadDebugSchemaError";
  }
}

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

function missingTableName(error: unknown): string | null {
  const message = String((error as Error)?.message ?? error);
  const patterns = [
    /no such table:\s*(?:(?:main|public)\.)?["'`]?([a-zA-Z_][\w$]*)/i,
    /relation\s+["'`](?:(?:public)\.)?([a-zA-Z_][\w$]*)["'`]\s+does not exist/i,
    /table\s+["'`](?:[^"'`.]+\.)?([a-zA-Z_][\w$]*)["'`]\s+does(?:n't| not)\s+exist/i,
    /unknown table\s+["'`]?(?:[^"'`.\s]+\.)?([a-zA-Z_][\w$]*)/i,
    /undefined table[^a-zA-Z_]+(?:[^.\s]+\.)?([a-zA-Z_][\w$]*)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

function isMissingTableError(error: unknown): boolean {
  return missingTableName(error) !== null;
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
    const missingTable = missingTableName(error);
    if (missingTable) {
      throw new UnsupportedThreadDebugSchemaError(missingTable);
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
  if (direct) {
    if (direct.kind !== "current" && !direct.databaseUrl) {
      throw new Error(
        `Thread debug source "${normalized}" is configured but disconnected.`,
      );
    }
    return direct;
  }

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
  if (!source.databaseUrl) {
    throw new Error(
      `Thread debug source "${source.id}" is configured but disconnected.`,
    );
  }
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
    throw new ForbiddenError(
      "Only Dispatch admins can inspect thread databases from other apps.",
    );
  }
}

function ownerScope(
  access: DebugAccess,
  ownerEmail?: string,
  column = "owner_email",
): OwnerScope {
  const requested = ownerEmail?.trim();
  if (!access.canInspectAll) {
    return {
      sql: `${column} = ?`,
      args: [access.viewerEmail],
      label: access.viewerEmail,
    };
  }

  if (requested && requested !== "*") {
    if (
      access.orgId &&
      !access.memberEmails.some(
        (email) => email.toLowerCase() === requested.toLowerCase(),
      )
    ) {
      throw new Error(
        "The requested owner is not a member of the current organization.",
      );
    }
    return {
      sql: `${column} = ?`,
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
      sql: `${column} = ?`,
      args: [access.viewerEmail],
      label: access.viewerEmail,
    };
  }
  const placeholders = emails.map(() => "?").join(", ");
  return {
    sql: `${column} IN (${placeholders})`,
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
    turnId: row.turn_id ? String(row.turn_id) : null,
    status: String(row.status),
    abortReason: row.abort_reason ? String(row.abort_reason) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorDetail: row.error_detail ? String(row.error_detail) : null,
    terminalReason: row.terminal_reason ? String(row.terminal_reason) : null,
    startedAt: numberField(row.started_at),
    completedAt: nullableNumberField(row.completed_at),
    heartbeatAt: nullableNumberField(row.heartbeat_at),
    lastProgressAt: nullableNumberField(row.last_progress_at),
    dispatchMode: row.dispatch_mode ? String(row.dispatch_mode) : null,
    workerStage: row.worker_stage ? String(row.worker_stage) : null,
    diagStage: row.diag_stage ? String(row.diag_stage) : null,
    peakRssMb: nullableNumberField(row.peak_rss_mb),
    inFlightSince: nullableNumberField(row.in_flight_since),
    hasDispatchPayload:
      row.dispatch_payload !== null &&
      row.dispatch_payload !== undefined &&
      String(row.dispatch_payload).length > 0,
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

function publicSource(source: ThreadDebugSourceConfig) {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    databaseUrlEnv: source.databaseUrlEnv ?? null,
  };
}

function parseTerminalEvent(value: unknown): Record<string, unknown> | null {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : { type: "unparseable" };
  } catch {
    return { type: "unparseable" };
  }
}

function serializeRunFailure(
  row: AgentRunFailureRow,
  source: ThreadDebugSourceConfig,
) {
  const startedAt = numberField(row.started_at);
  const completedAt = nullableNumberField(row.completed_at);
  const terminalEvent = parseTerminalEvent(row.debug_terminal_event_data);
  const failureTaxonomy = classifyAgentFailure({
    runId: row.id,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    terminalReason: row.terminal_reason,
    terminalEvent,
  });
  return {
    source: publicSource(source),
    id: String(row.id),
    threadId: String(row.thread_id),
    turnId: row.turn_id ? String(row.turn_id) : null,
    ownerEmail: String(row.debug_owner_email ?? ""),
    threadTitle: String(row.debug_thread_title ?? ""),
    threadPreview: String(row.debug_thread_preview ?? ""),
    status: String(row.status) as AgentRunFailureStatus,
    abortReason: row.abort_reason ? String(row.abort_reason) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorDetail: row.error_detail ? String(row.error_detail) : null,
    terminalReason: row.terminal_reason ? String(row.terminal_reason) : null,
    startedAt,
    completedAt,
    heartbeatAt: nullableNumberField(row.heartbeat_at),
    lastProgressAt: nullableNumberField(row.last_progress_at),
    durationMs: completedAt == null ? null : completedAt - startedAt,
    dispatchMode: row.dispatch_mode ? String(row.dispatch_mode) : null,
    workerStage: row.worker_stage ? String(row.worker_stage) : null,
    diagStage: row.diag_stage ? String(row.diag_stage) : null,
    peakRssMb: nullableNumberField(row.peak_rss_mb),
    terminalEvent,
    regime: failureTaxonomy.regime,
    failureTaxonomy,
  };
}

function sourceHealth(
  source: ThreadDebugSourceConfig,
  status: ThreadDebugSourceHealthStatus,
  failureCount: number,
  errorCode:
    | null
    | "thread_debug_source_disconnected"
    | "thread_debug_schema_unsupported"
    | "thread_debug_source_unavailable",
) {
  return {
    source: publicSource(source),
    status,
    failureCount,
    errorCode,
  };
}

async function failuresForSource(
  source: ThreadDebugSourceConfig,
  scope: OwnerScope,
  input: {
    status: AgentRunFailureStatus | "all";
    regime: AgentFailureRegime | "all";
    cutoff: number;
    limit: number;
  },
) {
  const exec = await execForSource(source);
  const statuses =
    input.status === "all" ? [...UNSUCCESSFUL_RUN_STATUSES] : [input.status];
  const statusPlaceholders = statuses.map(() => "?").join(", ");
  const regimeClause =
    input.regime === "scheduled"
      ? "AND r.id LIKE 'job-%'"
      : input.regime === "interactive"
        ? "AND r.id NOT LIKE 'job-%'"
        : "";
  const rows = await queryRows<AgentRunFailureRow>(
    exec,
    `SELECT r.*,
            t.owner_email AS debug_owner_email,
            t.title AS debug_thread_title,
            t.preview AS debug_thread_preview,
            (
              SELECT e.event_data
                FROM agent_run_events e
               WHERE e.run_id = r.id
               ORDER BY e.seq DESC
               LIMIT 1
            ) AS debug_terminal_event_data
       FROM agent_runs r
       JOIN chat_threads t ON t.id = r.thread_id
      WHERE r.status IN (${statusPlaceholders})
        AND ${scope.sql}
        ${regimeClause}
        AND COALESCE(r.completed_at, r.started_at) >= ?
      ORDER BY COALESCE(r.completed_at, r.started_at) DESC, r.id DESC
      LIMIT ?`,
    [...statuses, ...scope.args, input.cutoff, input.limit],
  );
  return rows.map((row) => serializeRunFailure(row, source));
}

export async function listAgentRunFailures(input: {
  sourceId?: string;
  ownerEmail?: string;
  status?: AgentRunFailureStatus | "all";
  regime?: AgentFailureRegime | "all";
  lookbackHours?: number;
  limit?: number;
}) {
  const access = await resolveDebugAccess();
  const requestedSourceId = input.sourceId?.trim() || "all";
  const status = input.status ?? "all";
  const regime = input.regime ?? "all";
  const lookbackHours = Math.max(1, Math.min(720, input.lookbackHours ?? 168));
  const limit = Math.max(1, Math.min(100, input.limit ?? DEFAULT_SEARCH_LIMIT));
  const scope = ownerScope(access, input.ownerEmail, "t.owner_email");
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

  let sources: ThreadDebugSourceConfig[];
  if (requestedSourceId === "all") {
    sources = sourceConfigs().filter(
      (source) => source.kind === "current" || access.canInspectAll,
    );
  } else {
    const configured = sourceConfigs().find(
      (source) => source.id === requestedSourceId,
    );
    const source = configured ?? resolveSourceConfig(requestedSourceId);
    assertSourceAccess(source, access);
    if (source.kind !== "current" && !source.databaseUrl) {
      throw new Error(
        `Thread debug source "${requestedSourceId}" is configured but disconnected.`,
      );
    }
    sources = [source];
  }

  const results = await Promise.all(
    sources.map(async (source) => {
      if (source.kind !== "current" && !source.databaseUrl) {
        return {
          failures: [] as ReturnType<typeof serializeRunFailure>[],
          health: sourceHealth(
            source,
            "disconnected",
            0,
            "thread_debug_source_disconnected",
          ),
        };
      }
      try {
        const failures = await failuresForSource(source, scope, {
          status,
          regime,
          cutoff,
          limit,
        });
        return {
          failures,
          health: sourceHealth(source, "ok", failures.length, null),
        };
      } catch (error) {
        if (error instanceof UnsupportedThreadDebugSchemaError) {
          return {
            failures: [] as ReturnType<typeof serializeRunFailure>[],
            health: sourceHealth(
              source,
              "unsupported",
              0,
              "thread_debug_schema_unsupported",
            ),
          };
        }
        return {
          failures: [] as ReturnType<typeof serializeRunFailure>[],
          health: sourceHealth(
            source,
            "unavailable",
            0,
            "thread_debug_source_unavailable",
          ),
        };
      }
    }),
  );

  const failures = results
    .flatMap((result) => result.failures)
    .sort(
      (a, b) =>
        (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt) ||
        b.id.localeCompare(a.id) ||
        b.source.id.localeCompare(a.source.id),
    )
    .slice(0, limit);

  return {
    sourceId: requestedSourceId,
    status,
    regime,
    lookbackHours,
    limit,
    count: failures.length,
    partial: results.some((result) => result.health.status !== "ok"),
    access: {
      viewerEmail: access.viewerEmail,
      scope: scope.label,
      canInspectAll: access.canInspectAll,
    },
    sources: results.map((result) => result.health),
    failures,
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
  const runThreadIds = q
    ? (
        await optionalRows<{ thread_id: string }>(
          exec,
          "SELECT thread_id FROM agent_runs WHERE id = ? LIMIT 1",
          [q],
        )
      )
        .map((row) => String(row.thread_id ?? "").trim())
        .filter(Boolean)
    : [];
  if (q) {
    const pattern = "%" + escapeLike(q.toLowerCase()) + "%";
    const runIdClause =
      runThreadIds.length > 0
        ? " OR id IN (" + runThreadIds.map(() => "?").join(", ") + ")"
        : "";
    where.push(
      "(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(preview) LIKE ? ESCAPE '\\' OR LOWER(owner_email) LIKE ? ESCAPE '\\' OR LOWER(thread_data) LIKE ? ESCAPE '\\'" +
        runIdClause +
        ")",
    );
    args.push(pattern, pattern, pattern, pattern);
    args.push(...runThreadIds);
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
  threadId?: string;
  runId?: string;
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
  const requestedId = input.runId?.trim() || input.threadId?.trim() || "";
  if (!requestedId) {
    throw new Error("A thread ID or request/run ID is required.");
  }

  let rows = await queryRows<ChatThreadRow>(
    exec,
    `SELECT id, owner_email, title, preview, thread_data, message_count, created_at, updated_at
       FROM chat_threads
      WHERE id = ? AND ${scope.sql}
      LIMIT 1`,
    [input.threadId?.trim() || requestedId, ...scope.args],
  );
  let resolvedRunId = input.runId?.trim() || null;

  if (!rows[0]) {
    const runRows = await optionalRows<{ id: string; thread_id: string }>(
      exec,
      `SELECT id, thread_id
         FROM agent_runs
        WHERE id = ?
        LIMIT 1`,
      [requestedId],
    );
    const threadId = runRows[0]?.thread_id
      ? String(runRows[0].thread_id).trim()
      : "";
    if (threadId) {
      rows = await queryRows<ChatThreadRow>(
        exec,
        `SELECT id, owner_email, title, preview, thread_data, message_count, created_at, updated_at
           FROM chat_threads
          WHERE id = ? AND ${scope.sql}
          LIMIT 1`,
        [threadId, ...scope.args],
      );
      if (rows[0]) resolvedRunId = requestedId;
    }
  }

  const row = rows[0];
  if (!row) {
    throw new Error(`Thread or request/run ID "${requestedId}" was not found.`);
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
    `SELECT r.*
       FROM agent_runs r
      WHERE r.thread_id = ?
      ORDER BY r.started_at DESC
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
    lookup: {
      requestedId,
      threadId: String(row.id),
      runId: resolvedRunId,
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
