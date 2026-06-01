import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
  safeJsonParse,
} from "../db/client.js";
import type {
  AgentNativeBrowserSession,
  AgentNativeBrowserSessionAction,
  AgentNativeBrowserSessionRecord,
  AgentNativeBrowserSessionRequest,
  AgentNativeBrowserSessionRequestStatus,
  AgentNativeBrowserSessionRequestType,
  CreateAgentNativeBrowserSessionRequestInput,
  RegisterAgentNativeBrowserSessionInput,
} from "./types.js";

export const DEFAULT_BROWSER_SESSION_TTL_MS = 45_000;
export const DEFAULT_BROWSER_SESSION_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_BROWSER_SESSION_REQUEST_POLL_MS = 250;

const SESSION_TABLE = "agent_native_browser_sessions";
const REQUEST_TABLE = "agent_native_browser_session_requests";
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;

let initPromise: Promise<void> | undefined;

function nowMs(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getDbExec();
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS ${SESSION_TABLE} (
            owner_email TEXT NOT NULL,
            session_id TEXT NOT NULL,
            label TEXT,
            url TEXT,
            session_json TEXT NOT NULL,
            context_json TEXT,
            actions_json TEXT,
            connected_at ${intType()} NOT NULL,
            last_seen_at ${intType()} NOT NULL,
            expires_at ${intType()} NOT NULL,
            PRIMARY KEY (owner_email, session_id)
          )
        `),
      );
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE INDEX IF NOT EXISTS agent_native_browser_sessions_owner_seen_idx
          ON ${SESSION_TABLE} (owner_email, last_seen_at)
        `),
      );
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS ${REQUEST_TABLE} (
            owner_email TEXT NOT NULL,
            session_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            type TEXT NOT NULL,
            name TEXT,
            command TEXT,
            payload_json TEXT,
            status TEXT NOT NULL,
            created_at ${intType()} NOT NULL,
            claimed_at ${intType()},
            completed_at ${intType()},
            expires_at ${intType()} NOT NULL,
            result_json TEXT,
            error TEXT,
            PRIMARY KEY (owner_email, request_id)
          )
        `),
      );
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE INDEX IF NOT EXISTS agent_native_browser_session_requests_pending_idx
          ON ${REQUEST_TABLE} (owner_email, session_id, status, created_at)
        `),
      );
    })().catch((err) => {
      // Don't cache a transient init failure — otherwise every browser-session
      // call re-awaits the same rejected promise until the process restarts.
      initPromise = undefined;
      throw err;
    });
  }
  return initPromise;
}

function assertOwnerEmail(ownerEmail: string): string {
  const trimmed = ownerEmail.trim();
  if (!trimmed) throw new Error("ownerEmail is required");
  return trimmed;
}

function assertSafeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID_RE.test(trimmed)) {
    throw new Error(
      `${label} must be 1-160 characters using letters, numbers, dot, underscore, colon, or dash`,
    );
  }
  return trimmed;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseOptionalObject(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  const parsed = safeJsonParse<unknown>(value, undefined);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function parseActions(value: unknown): AgentNativeBrowserSessionAction[] {
  const parsed = safeJsonParse<unknown>(value, []);
  return Array.isArray(parsed)
    ? (parsed.filter(
        (action) =>
          action &&
          typeof action === "object" &&
          typeof (action as { name?: unknown }).name === "string",
      ) as AgentNativeBrowserSessionAction[])
    : [];
}

function parseSession(
  value: unknown,
  sessionId: string,
): AgentNativeBrowserSession {
  const parsed = safeJsonParse<unknown>(value, { id: sessionId });
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? ({
        id: sessionId,
        ...(parsed as Record<string, unknown>),
      } as AgentNativeBrowserSession)
    : { id: sessionId };
}

function coerceTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeSessionInput(input: RegisterAgentNativeBrowserSessionInput): {
  sessionId: string;
  session: AgentNativeBrowserSession;
  label?: string;
  url?: string;
  context?: Record<string, unknown>;
  actions: AgentNativeBrowserSessionAction[];
  connectedAt: number;
  ttlMs: number;
} {
  const sessionRecord: Partial<AgentNativeBrowserSession> =
    input.session && typeof input.session === "object" ? input.session : {};
  const rawId = input.sessionId || sessionRecord.id;
  if (typeof rawId !== "string") {
    throw new Error("session.id is required");
  }
  const sessionId = assertSafeId(rawId, "session.id");
  const now = nowMs();
  const connectedAt = coerceTime(sessionRecord.connectedAt) ?? now;
  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim()
      : typeof sessionRecord.label === "string" && sessionRecord.label.trim()
        ? sessionRecord.label.trim()
        : undefined;
  const url =
    typeof input.url === "string" && input.url.trim()
      ? input.url.trim()
      : typeof sessionRecord.url === "string" && sessionRecord.url.trim()
        ? sessionRecord.url.trim()
        : undefined;
  const session: AgentNativeBrowserSession = {
    ...sessionRecord,
    id: sessionId,
    ...(label ? { label } : {}),
    connectedAt: new Date(connectedAt).toISOString(),
    ...(url ? { url } : {}),
  };
  return {
    sessionId,
    session,
    label,
    url,
    context:
      input.context &&
      typeof input.context === "object" &&
      !Array.isArray(input.context)
        ? input.context
        : undefined,
    actions: Array.isArray(input.actions) ? input.actions : [],
    connectedAt,
    ttlMs:
      typeof input.ttlMs === "number" && input.ttlMs > 0
        ? Math.min(input.ttlMs, 5 * 60 * 1000)
        : DEFAULT_BROWSER_SESSION_TTL_MS,
  };
}

function rowToSession(
  row: Record<string, unknown>,
  now = nowMs(),
): AgentNativeBrowserSessionRecord {
  const sessionId = String(row.session_id ?? "");
  const expiresAt = Number(row.expires_at ?? 0);
  return {
    sessionId,
    session: parseSession(row.session_json, sessionId),
    label: typeof row.label === "string" ? row.label : undefined,
    url: typeof row.url === "string" ? row.url : undefined,
    context: parseOptionalObject(row.context_json),
    actions: parseActions(row.actions_json),
    connectedAt: Number(row.connected_at ?? 0),
    lastSeenAt: Number(row.last_seen_at ?? 0),
    expiresAt,
    active: expiresAt > now,
  };
}

function rowToRequest(
  row: Record<string, unknown>,
): AgentNativeBrowserSessionRequest {
  const type = String(
    row.type ?? "get-context",
  ) as AgentNativeBrowserSessionRequestType;
  const payload = safeJsonParse<unknown>(row.payload_json, undefined);
  const result = safeJsonParse<unknown>(row.result_json, undefined);
  const request: AgentNativeBrowserSessionRequest = {
    id: String(row.request_id ?? ""),
    sessionId: String(row.session_id ?? ""),
    type,
    status: String(
      row.status ?? "pending",
    ) as AgentNativeBrowserSessionRequestStatus,
    createdAt: Number(row.created_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
    ...(typeof row.name === "string" && row.name ? { name: row.name } : {}),
    ...(typeof row.command === "string" && row.command
      ? { command: row.command }
      : {}),
    ...(row.claimed_at != null ? { claimedAt: Number(row.claimed_at) } : {}),
    ...(row.completed_at != null
      ? { completedAt: Number(row.completed_at) }
      : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    ...(row.result_json != null ? { result } : {}),
  };
  if (type === "run-action") request.args = payload;
  else request.payload = payload;
  return request;
}

async function expireOldRequests(
  ownerEmail: string,
  sessionId?: string,
): Promise<void> {
  await ensureTables();
  const client = getDbExec();
  const now = nowMs();
  await client.execute({
    sql: sessionId
      ? `UPDATE ${REQUEST_TABLE}
         SET status = 'expired', completed_at = ?, error = 'Browser-session request expired'
         WHERE owner_email = ? AND session_id = ? AND status IN ('pending', 'claimed') AND expires_at < ?`
      : `UPDATE ${REQUEST_TABLE}
         SET status = 'expired', completed_at = ?, error = 'Browser-session request expired'
         WHERE owner_email = ? AND status IN ('pending', 'claimed') AND expires_at < ?`,
    args: sessionId
      ? [now, ownerEmail, sessionId, now]
      : [now, ownerEmail, now],
  });
}

export async function registerBrowserSession(
  ownerEmailInput: string,
  input: RegisterAgentNativeBrowserSessionInput,
): Promise<AgentNativeBrowserSessionRecord> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const normalized = normalizeSessionInput(input);
  await ensureTables();
  const client = getDbExec();
  const now = nowMs();
  const expiresAt = now + normalized.ttlMs;

  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO ${SESSION_TABLE}
          (owner_email, session_id, label, url, session_json, context_json, actions_json, connected_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (owner_email, session_id) DO UPDATE SET
          label = EXCLUDED.label,
          url = EXCLUDED.url,
          session_json = EXCLUDED.session_json,
          context_json = EXCLUDED.context_json,
          actions_json = EXCLUDED.actions_json,
          last_seen_at = EXCLUDED.last_seen_at,
          expires_at = EXCLUDED.expires_at`
      : `INSERT OR REPLACE INTO ${SESSION_TABLE}
          (owner_email, session_id, label, url, session_json, context_json, actions_json, connected_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      ownerEmail,
      normalized.sessionId,
      normalized.label ?? null,
      normalized.url ?? null,
      json(normalized.session),
      normalized.context ? json(normalized.context) : null,
      json(normalized.actions),
      normalized.connectedAt,
      now,
      expiresAt,
    ],
  });

  const saved = await getBrowserSession(ownerEmail, normalized.sessionId, {
    includeExpired: true,
  });
  if (!saved) throw new Error("Failed to register browser session");
  return saved;
}

export async function listBrowserSessions(
  ownerEmailInput: string,
  options: { includeExpired?: boolean; limit?: number } = {},
): Promise<AgentNativeBrowserSessionRecord[]> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  await ensureTables();
  await expireOldRequests(ownerEmail);
  const client = getDbExec();
  const limit =
    typeof options.limit === "number" && options.limit > 0
      ? Math.min(Math.floor(options.limit), 100)
      : 25;
  const now = nowMs();
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${SESSION_TABLE}
          WHERE owner_email = ?
          ORDER BY last_seen_at DESC
          LIMIT ?`,
    args: [ownerEmail, limit],
  });
  const sessions = rows.map((row) => rowToSession(row, now));
  return options.includeExpired
    ? sessions
    : sessions.filter((session) => session.active);
}

export async function getBrowserSession(
  ownerEmailInput: string,
  sessionIdInput: string,
  options: { includeExpired?: boolean } = {},
): Promise<AgentNativeBrowserSessionRecord | null> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const sessionId = assertSafeId(sessionIdInput, "sessionId");
  await ensureTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${SESSION_TABLE} WHERE owner_email = ? AND session_id = ?`,
    args: [ownerEmail, sessionId],
  });
  if (rows.length === 0) return null;
  const session = rowToSession(rows[0]);
  return options.includeExpired || session.active ? session : null;
}

export async function disconnectBrowserSession(
  ownerEmailInput: string,
  sessionIdInput: string,
): Promise<boolean> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const sessionId = assertSafeId(sessionIdInput, "sessionId");
  await ensureTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE ${REQUEST_TABLE}
          SET status = 'expired', completed_at = ?, error = 'Browser session disconnected'
          WHERE owner_email = ? AND session_id = ? AND status IN ('pending', 'claimed')`,
    args: [nowMs(), ownerEmail, sessionId],
  });
  const result = await client.execute({
    sql: `DELETE FROM ${SESSION_TABLE} WHERE owner_email = ? AND session_id = ?`,
    args: [ownerEmail, sessionId],
  });
  return result.rowsAffected > 0;
}

function normalizeRequestInput(
  input: CreateAgentNativeBrowserSessionRequestInput,
): {
  type: AgentNativeBrowserSessionRequestType;
  name?: string;
  command?: string;
  payload?: unknown;
  timeoutMs: number;
} {
  if (
    input.type !== "get-context" &&
    input.type !== "list-actions" &&
    input.type !== "run-action" &&
    input.type !== "command"
  ) {
    throw new Error(
      "request type must be get-context, list-actions, run-action, or command",
    );
  }
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : undefined;
  if (input.type === "run-action" && !name) {
    throw new Error("name is required for run-action requests");
  }
  const command =
    typeof input.command === "string" && input.command.trim()
      ? input.command.trim()
      : input.type === "command"
        ? "refreshData"
        : undefined;
  return {
    type: input.type,
    name,
    command,
    payload: input.type === "run-action" ? input.args : input.payload,
    timeoutMs:
      typeof input.timeoutMs === "number" && input.timeoutMs > 0
        ? Math.min(input.timeoutMs, 2 * 60 * 1000)
        : DEFAULT_BROWSER_SESSION_REQUEST_TIMEOUT_MS,
  };
}

export async function createBrowserSessionRequest(
  ownerEmailInput: string,
  sessionIdInput: string,
  input: CreateAgentNativeBrowserSessionRequestInput,
): Promise<AgentNativeBrowserSessionRequest> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const sessionId = assertSafeId(sessionIdInput, "sessionId");
  const session = await getBrowserSession(ownerEmail, sessionId);
  if (!session) {
    throw new Error(`No active browser session found for "${sessionId}"`);
  }
  const normalized = normalizeRequestInput(input);
  await ensureTables();
  const client = getDbExec();
  const createdAt = nowMs();
  const requestId = generateId("browser-request");
  const expiresAt = createdAt + normalized.timeoutMs + 15_000;
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO ${REQUEST_TABLE}
          (owner_email, session_id, request_id, type, name, command, payload_json, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT (owner_email, request_id) DO NOTHING`
      : `INSERT OR IGNORE INTO ${REQUEST_TABLE}
          (owner_email, session_id, request_id, type, name, command, payload_json, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [
      ownerEmail,
      sessionId,
      requestId,
      normalized.type,
      normalized.name ?? null,
      normalized.command ?? null,
      json(normalized.payload),
      createdAt,
      expiresAt,
    ],
  });
  const request = await getBrowserSessionRequest(ownerEmail, requestId);
  if (!request) throw new Error("Failed to create browser-session request");
  return request;
}

export async function getBrowserSessionRequest(
  ownerEmailInput: string,
  requestIdInput: string,
): Promise<AgentNativeBrowserSessionRequest | null> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const requestId = assertSafeId(requestIdInput, "requestId");
  await ensureTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM ${REQUEST_TABLE} WHERE owner_email = ? AND request_id = ?`,
    args: [ownerEmail, requestId],
  });
  return rows.length ? rowToRequest(rows[0]) : null;
}

export async function claimBrowserSessionRequest(
  ownerEmailInput: string,
  sessionIdInput: string,
): Promise<AgentNativeBrowserSessionRequest | null> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const sessionId = assertSafeId(sessionIdInput, "sessionId");
  await ensureTables();
  await expireOldRequests(ownerEmail, sessionId);
  const client = getDbExec();
  const now = nowMs();

  for (let attempt = 0; attempt < 3; attempt++) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM ${REQUEST_TABLE}
            WHERE owner_email = ? AND session_id = ? AND status = 'pending' AND expires_at >= ?
            ORDER BY created_at ASC
            LIMIT 1`,
      args: [ownerEmail, sessionId, now],
    });
    if (rows.length === 0) return null;
    const candidate = rowToRequest(rows[0]);
    const updated = await client.execute({
      sql: `UPDATE ${REQUEST_TABLE}
            SET status = 'claimed', claimed_at = ?
            WHERE owner_email = ? AND request_id = ? AND status = 'pending'`,
      args: [now, ownerEmail, candidate.id],
    });
    if (updated.rowsAffected > 0) {
      return getBrowserSessionRequest(ownerEmail, candidate.id);
    }
  }
  return null;
}

export async function completeBrowserSessionRequest(
  ownerEmailInput: string,
  sessionIdInput: string,
  requestIdInput: string,
  result:
    | { ok: true; result?: unknown }
    | { ok: false; error?: string; result?: unknown },
): Promise<AgentNativeBrowserSessionRequest> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const sessionId = assertSafeId(sessionIdInput, "sessionId");
  const requestId = assertSafeId(requestIdInput, "requestId");
  await ensureTables();
  const client = getDbExec();
  const completedAt = nowMs();
  const status: AgentNativeBrowserSessionRequestStatus =
    result.ok === true ? "completed" : "failed";
  const error =
    result.ok === false
      ? result.error || "Browser-session request failed"
      : null;
  const updated = await client.execute({
    sql: `UPDATE ${REQUEST_TABLE}
          SET status = ?, completed_at = ?, result_json = ?, error = ?
          WHERE owner_email = ? AND session_id = ? AND request_id = ? AND status IN ('pending', 'claimed')`,
    args: [
      status,
      completedAt,
      "result" in result ? json(result.result) : null,
      error,
      ownerEmail,
      sessionId,
      requestId,
    ],
  });
  if (updated.rowsAffected === 0) {
    const existing = await getBrowserSessionRequest(ownerEmail, requestId);
    if (existing) return existing;
    throw new Error(`No browser-session request found for "${requestId}"`);
  }
  const request = await getBrowserSessionRequest(ownerEmail, requestId);
  if (!request)
    throw new Error(`No browser-session request found for "${requestId}"`);
  return request;
}

export async function waitForBrowserSessionRequest(
  ownerEmailInput: string,
  requestIdInput: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<unknown> {
  const ownerEmail = assertOwnerEmail(ownerEmailInput);
  const requestId = assertSafeId(requestIdInput, "requestId");
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_BROWSER_SESSION_REQUEST_TIMEOUT_MS;
  const pollMs =
    typeof options.pollMs === "number" && options.pollMs > 0
      ? options.pollMs
      : DEFAULT_BROWSER_SESSION_REQUEST_POLL_MS;
  const deadline = nowMs() + timeoutMs;

  while (nowMs() <= deadline) {
    const request = await getBrowserSessionRequest(ownerEmail, requestId);
    if (!request)
      throw new Error(`No browser-session request found for "${requestId}"`);
    if (request.status === "completed") return request.result;
    if (request.status === "failed") {
      throw new Error(request.error || "Browser-session request failed");
    }
    if (request.status === "expired" || request.expiresAt < nowMs()) {
      await expireOldRequests(ownerEmail, request.sessionId);
      throw new Error(request.error || "Browser-session request expired");
    }
    await sleep(Math.min(pollMs, Math.max(1, deadline - nowMs())));
  }

  const request = await getBrowserSessionRequest(ownerEmail, requestId);
  if (request) {
    await completeBrowserSessionRequest(
      ownerEmail,
      request.sessionId,
      requestId,
      {
        ok: false,
        error: "Timed out waiting for browser-session response",
      },
    );
  }
  throw new Error("Timed out waiting for browser-session response");
}

export async function callBrowserSession(
  ownerEmailInput: string,
  sessionIdInput: string,
  input: CreateAgentNativeBrowserSessionRequestInput,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<unknown> {
  const request = await createBrowserSessionRequest(
    ownerEmailInput,
    sessionIdInput,
    {
      ...input,
      timeoutMs: input.timeoutMs ?? options.timeoutMs,
    },
  );
  return waitForBrowserSessionRequest(ownerEmailInput, request.id, {
    timeoutMs: options.timeoutMs ?? input.timeoutMs,
    pollMs: options.pollMs,
  });
}
