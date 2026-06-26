import { createHash } from "node:crypto";

import type { CredentialContext } from "../credentials/index.js";
import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";

export interface ProviderQuotaIdentityInput {
  appId: string;
  providerId: string;
  ctx: CredentialContext;
  credentialSources: readonly Record<string, unknown>[];
  connectionId?: string | null;
  accountId?: string | null;
}

export interface ProviderQuotaIdentity {
  quotaKey: string;
  providerId: string;
  scopeKey: string;
  credentialFingerprint: string;
}

export interface ProviderQuotaRequest {
  identity: ProviderQuotaIdentity;
  method: string;
  target: string;
  requestKey?: string;
}

export interface ProviderQuotaObservedResult {
  status?: number;
  headers?: Record<string, string>;
}

export interface ProviderQuotaExhaustedDetail {
  providerId: string;
  scopeKey: string;
  quotaKey: string;
  method: string;
  target: string;
  retryAfterMs: number;
  retryAt: string;
  reason: "cooldown" | "retry_after" | "max_attempts";
}

export interface ExecuteWithProviderQuotaOptions<T> {
  request: ProviderQuotaRequest;
  execute: () => Promise<T>;
  inspect: (result: T) => ProviderQuotaObservedResult;
  buildQuotaExhaustedResult: (detail: ProviderQuotaExhaustedDetail) => T;
  maxAttempts?: number;
  maxWaitMs?: number;
}

interface QueueState {
  tail: Promise<void>;
}

interface CooldownEntry {
  until: number;
  providerId: string;
  scopeKey: string;
  status?: number;
  reason?: string;
}

interface ProviderQuotaState {
  queues: Map<string, QueueState>;
  inflight: Map<string, Promise<unknown>>;
  cooldowns: Map<string, CooldownEntry>;
  initPromise?: Promise<void>;
  persistenceUnavailableUntil?: number;
}

const GLOBAL_KEY = "__agentNativeProviderApiQuotaGovernor" as const;
type GlobalWithProviderQuota = typeof globalThis & {
  [GLOBAL_KEY]?: ProviderQuotaState;
};

const globalRef = globalThis as GlobalWithProviderQuota;
const initialState: ProviderQuotaState = {
  queues: new Map(),
  inflight: new Map(),
  cooldowns: new Map(),
};
const state: ProviderQuotaState =
  globalRef[GLOBAL_KEY] ?? (globalRef[GLOBAL_KEY] = initialState);

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_WAIT_MS = 55_000;
const MAX_FALLBACK_BACKOFF_MS = 30_000;
const PERSISTENCE_RETRY_MS = 60_000;

export function createProviderQuotaIdentity(
  input: ProviderQuotaIdentityInput,
): ProviderQuotaIdentity {
  const scopeKey = input.ctx.orgId
    ? `org:${input.ctx.orgId}`
    : input.ctx.userEmail
      ? `user:${input.ctx.userEmail}`
      : "anonymous";
  const credentialSources = input.credentialSources
    .map((source) => ({
      provider: String(source.provider ?? input.providerId),
      key: String(source.key ?? ""),
      source: String(source.source ?? ""),
      connectionId: stringOrNull(source.connectionId) ?? input.connectionId,
      accountId: stringOrNull(source.accountId) ?? input.accountId,
      scope: stringOrNull(source.scope),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const credentialFingerprint = hashStable({
    providerId: input.providerId,
    connectionId: input.connectionId ?? null,
    accountId: input.accountId ?? null,
    credentialSources,
  });
  return {
    providerId: input.providerId,
    scopeKey,
    credentialFingerprint,
    quotaKey: hashStable({
      appId: input.appId,
      providerId: input.providerId,
      scopeKey,
      credentialFingerprint,
    }),
  };
}

export function createProviderRequestDedupeKey(input: {
  method: string;
  url: string;
  body?: BodyInit;
  headers?: Record<string, string>;
}): string | undefined {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return undefined;
  return hashStable({
    method,
    url: input.url,
    headers: dedupeHeaders(input.headers),
    body:
      typeof input.body === "string"
        ? input.body
        : input.body == null
          ? null
          : "[body]",
  });
}

export async function executeWithProviderQuota<T>(
  options: ExecuteWithProviderQuotaOptions<T>,
): Promise<T> {
  if (isQuotaGovernorDisabled()) return options.execute();

  const dedupeKey = options.request.requestKey
    ? `${options.request.identity.quotaKey}:${options.request.requestKey}`
    : null;
  if (dedupeKey) {
    const existing = state.inflight.get(dedupeKey);
    if (existing) return existing as Promise<T>;
  }

  const run = runInQueue(options.request.identity.quotaKey, () =>
    executeWithCooldown(options),
  );
  if (dedupeKey) {
    state.inflight.set(dedupeKey, run);
    run
      .finally(() => {
        state.inflight.delete(dedupeKey);
      })
      .catch(() => undefined);
  }
  return run;
}

export function resetProviderQuotaStateForTests(): void {
  state.queues.clear();
  state.inflight.clear();
  state.cooldowns.clear();
  state.initPromise = undefined;
  state.persistenceUnavailableUntil = undefined;
}

async function executeWithCooldown<T>(
  options: ExecuteWithProviderQuotaOptions<T>,
): Promise<T> {
  const maxAttempts = positiveIntFromEnv(
    "AGENT_NATIVE_PROVIDER_API_MAX_ATTEMPTS",
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  );
  const maxWaitMs = positiveIntFromEnv(
    "AGENT_NATIVE_PROVIDER_API_MAX_WAIT_MS",
    options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
  );
  const deadline = Date.now() + maxWaitMs;

  for (let attempt = 0; ; attempt++) {
    const cooldownUntil = await getCooldownUntil(options.request.identity);
    if (cooldownUntil > Date.now()) {
      const waitMs = cooldownUntil - Date.now();
      if (waitMs > Math.max(0, deadline - Date.now())) {
        return options.buildQuotaExhaustedResult(
          quotaExhaustedDetail(options.request, waitMs, "cooldown"),
        );
      }
      await sleepMs(waitMs);
    }

    const result = await options.execute();
    const observed = options.inspect(result);
    if (observed.status !== 429) {
      return result;
    }

    const retryAfterMs = retryDelayMs(observed.headers, attempt);
    await setCooldownUntil(
      options.request.identity,
      Date.now() + retryAfterMs,
      {
        status: observed.status,
        reason: "429",
      },
    );

    if (attempt + 1 >= maxAttempts) {
      return options.buildQuotaExhaustedResult(
        quotaExhaustedDetail(options.request, retryAfterMs, "max_attempts"),
      );
    }

    if (retryAfterMs > Math.max(0, deadline - Date.now())) {
      return options.buildQuotaExhaustedResult(
        quotaExhaustedDetail(options.request, retryAfterMs, "retry_after"),
      );
    }

    await sleepMs(retryAfterMs);
  }
}

async function runInQueue<T>(
  quotaKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const queue = state.queues.get(quotaKey) ?? { tail: Promise.resolve() };
  state.queues.set(quotaKey, queue);

  const previous = queue.tail.catch(() => undefined);
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queue.tail = tail;

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (queue.tail === tail) state.queues.delete(quotaKey);
  }
}

async function getCooldownUntil(
  identity: ProviderQuotaIdentity,
): Promise<number> {
  const memory = state.cooldowns.get(identity.quotaKey);
  const now = Date.now();
  if (memory && memory.until <= now) {
    state.cooldowns.delete(identity.quotaKey);
  }
  let until = memory && memory.until > now ? memory.until : 0;

  const persisted = await readPersistedCooldown(identity.quotaKey);
  if (persisted && persisted.until > now) {
    state.cooldowns.set(identity.quotaKey, persisted);
    until = Math.max(until, persisted.until);
  }
  return until;
}

async function setCooldownUntil(
  identity: ProviderQuotaIdentity,
  until: number,
  options: { status?: number; reason?: string } = {},
): Promise<void> {
  const entry: CooldownEntry = {
    until,
    providerId: identity.providerId,
    scopeKey: identity.scopeKey,
    status: options.status,
    reason: options.reason,
  };
  state.cooldowns.set(identity.quotaKey, entry);
  await writePersistedCooldown(identity.quotaKey, entry);
}

function quotaExhaustedDetail(
  request: ProviderQuotaRequest,
  retryAfterMs: number,
  reason: ProviderQuotaExhaustedDetail["reason"],
): ProviderQuotaExhaustedDetail {
  const retryAtMs = Date.now() + Math.max(0, retryAfterMs);
  return {
    providerId: request.identity.providerId,
    scopeKey: request.identity.scopeKey,
    quotaKey: request.identity.quotaKey,
    method: request.method,
    target: request.target,
    retryAfterMs: Math.max(0, retryAfterMs),
    retryAt: new Date(retryAtMs).toISOString(),
    reason,
  };
}

function retryDelayMs(
  headers: Record<string, string> | undefined,
  attempt: number,
): number {
  const retryAfter = retryAfterMs(headers);
  if (retryAfter !== null) return retryAfter;
  const base = Math.min(1000 * 2 ** attempt, MAX_FALLBACK_BACKOFF_MS);
  return Math.min(
    base + Math.floor(Math.random() * 250),
    MAX_FALLBACK_BACKOFF_MS,
  );
}

function retryAfterMs(
  headers: Record<string, string> | undefined,
): number | null {
  const raw = headerValue(headers, "retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return undefined;
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
}

function isQuotaGovernorDisabled(): boolean {
  const raw = process.env.AGENT_NATIVE_PROVIDER_API_QUOTA_GOVERNOR;
  return raw === "0" || raw?.toLowerCase() === "false";
}

function shouldPersistCooldowns(): boolean {
  const raw = process.env.AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS;
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  if (raw === "1" || raw?.toLowerCase() === "true") return true;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return false;
  return Boolean(
    process.env.DATABASE_URL ||
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.APP_NAME,
  );
}

function persistenceTemporarilyUnavailable(): boolean {
  return Boolean(
    state.persistenceUnavailableUntil &&
    state.persistenceUnavailableUntil > Date.now(),
  );
}

async function ensureCooldownTable(): Promise<void> {
  if (!shouldPersistCooldowns()) return;
  if (persistenceTemporarilyUnavailable()) return;
  if (!state.initPromise) {
    state.initPromise = (async () => {
      const db = getDbExec();
      const integerType = intType();
      const createSql = `
        CREATE TABLE IF NOT EXISTS provider_api_cooldowns (
          quota_key TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          scope_key TEXT NOT NULL,
          cooldown_until ${integerType} NOT NULL,
          status ${integerType},
          reason TEXT,
          updated_at ${integerType} NOT NULL,
          PRIMARY KEY (quota_key)
        )
      `;
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("provider_api_cooldowns", createSql);
        await ensureIndexExists(
          "provider_api_cooldowns_provider_idx",
          `CREATE INDEX IF NOT EXISTS provider_api_cooldowns_provider_idx ON provider_api_cooldowns (provider_id, cooldown_until)`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await db.execute(createSql);
      try {
        await db.execute(
          `CREATE INDEX IF NOT EXISTS provider_api_cooldowns_provider_idx ON provider_api_cooldowns (provider_id, cooldown_until)`,
        );
      } catch {
        // Index already exists or the backend rejected best-effort indexing.
      }
    })().catch((err) => {
      state.initPromise = undefined;
      state.persistenceUnavailableUntil = Date.now() + PERSISTENCE_RETRY_MS;
      throw err;
    });
  }
  await state.initPromise;
}

async function readPersistedCooldown(
  quotaKey: string,
): Promise<CooldownEntry | null> {
  try {
    if (!shouldPersistCooldowns() || persistenceTemporarilyUnavailable()) {
      return null;
    }
    await ensureCooldownTable();
    if (!shouldPersistCooldowns() || persistenceTemporarilyUnavailable()) {
      return null;
    }
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: `SELECT provider_id, scope_key, cooldown_until, status, reason FROM provider_api_cooldowns WHERE quota_key = ?`,
      args: [quotaKey],
    });
    const row = rows[0];
    if (!row) return null;
    const until = Number(row.cooldown_until);
    if (!Number.isFinite(until) || until <= Date.now()) {
      await db
        .execute({
          sql: `DELETE FROM provider_api_cooldowns WHERE quota_key = ?`,
          args: [quotaKey],
        })
        .catch(() => undefined);
      return null;
    }
    return {
      until,
      providerId: String(row.provider_id ?? ""),
      scopeKey: String(row.scope_key ?? ""),
      status: row.status == null ? undefined : Number(row.status),
      reason: row.reason == null ? undefined : String(row.reason),
    };
  } catch {
    state.persistenceUnavailableUntil = Date.now() + PERSISTENCE_RETRY_MS;
    return null;
  }
}

async function writePersistedCooldown(
  quotaKey: string,
  entry: CooldownEntry,
): Promise<void> {
  try {
    if (!shouldPersistCooldowns() || persistenceTemporarilyUnavailable()) {
      return;
    }
    await ensureCooldownTable();
    if (!shouldPersistCooldowns() || persistenceTemporarilyUnavailable()) {
      return;
    }
    const db = getDbExec();
    await db.execute({
      sql: `
        INSERT INTO provider_api_cooldowns
          (quota_key, provider_id, scope_key, cooldown_until, status, reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (quota_key) DO UPDATE SET
          provider_id = excluded.provider_id,
          scope_key = excluded.scope_key,
          cooldown_until = excluded.cooldown_until,
          status = excluded.status,
          reason = excluded.reason,
          updated_at = excluded.updated_at
      `,
      args: [
        quotaKey,
        entry.providerId,
        entry.scopeKey,
        Math.floor(entry.until),
        entry.status ?? null,
        entry.reason ?? null,
        Date.now(),
      ],
    });
  } catch {
    state.persistenceUnavailableUntil = Date.now() + PERSISTENCE_RETRY_MS;
  }
}

function hashStable(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 24);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function dedupeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const blocked = new Set([
    "authorization",
    "cookie",
    "proxy-authorization",
    "set-cookie",
    "x-api-key",
    "api-key",
  ]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !blocked.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
