import { AsyncLocalStorage } from "node:async_hooks";
import path from "path";

import { getAppConfig } from "../app-config/index.js";
import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";
import { isEmbeddedRuntimeAuthorized } from "./embedded-runtime.js";
import { isMigrationAuthorizedRuntime } from "./migration-runtime.js";
import {
  beginDatabaseOperation,
  recordDatabaseRetry,
} from "./request-telemetry.js";
import { isServerRuntimeStarted } from "./server-runtime.js";

const recyclingPostgresPools = new WeakSet<object>();
const loggedNeonPools = new WeakSet<object>();

export interface DbExecQuery {
  sql: string;
  args?: unknown[];
  timeoutMs?: number;
  maxAttempts?: number;
}

export type DbExecStatement = string | DbExecQuery;

export interface DbExec {
  execute(sql: DbExecStatement): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: DbExec) => Promise<T>): Promise<T>;
  atomicBatch?(
    statements: readonly DbExecStatement[],
  ): Promise<Array<{ rows: any[]; rowsAffected: number }>>;
  close?(): Promise<void>;
}

export interface DbExecConfig {
  url?: string;
}

type PgliteTransactionContext = {
  client: any;
  exec: DbExec;
};

type PgliteTransactionContexts = ReadonlyMap<string, PgliteTransactionContext>;

type PgliteTransactionStorage = {
  getStore(): PgliteTransactionContexts | undefined;
  run<T>(store: PgliteTransactionContexts, callback: () => T): T;
};

const PgliteTransactionStorage = getAsyncLocalStorageCtor();
const pgliteTransactionGlobal = globalThis as typeof globalThis & {
  __agentNativePgliteTransactionStorage?: PgliteTransactionStorage;
};
const pgliteTransactionStorage =
  pgliteTransactionGlobal.__agentNativePgliteTransactionStorage ??
  (PgliteTransactionStorage
    ? (pgliteTransactionGlobal.__agentNativePgliteTransactionStorage =
        new PgliteTransactionStorage<PgliteTransactionContexts>())
    : undefined);

export function getActivePgliteTransactionClient(url: string): any | undefined {
  return pgliteTransactionStorage?.getStore()?.get(pgliteClientKeyFromUrl(url))
    ?.client;
}

function getActivePgliteTransactionExec(url: string): DbExec | undefined {
  return pgliteTransactionStorage?.getStore()?.get(pgliteClientKeyFromUrl(url))
    ?.exec;
}

function hasCloudflareRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __cf_env?: unknown;
    __env__?: unknown;
  };
  return runtime.__cf_env !== undefined || runtime.__env__ !== undefined;
}

export function getDatabaseUrl(fallback = ""): string {
  const testUrl = getIsolatedTestDatabaseUrl();
  if (testUrl) return testUrl;
  const appName = getAppEnvPrefix();
  if (appName) {
    const prefixed = process.env[`${appName}_DATABASE_URL`];
    if (prefixed) return prefixed;
  }
  return (
    process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || fallback
  );
}

function getConfiguredUnpooledDatabaseUrl(): string | undefined {
  return (
    getConfiguredAppDatabaseUrl("DATABASE_URL_UNPOOLED") ||
    getAppConfig().runtime.databaseUrlUnpooled
  );
}

function getConfiguredAppDatabaseUrl(
  suffix: "DATABASE_URL" | "DATABASE_URL_UNPOOLED",
): string | undefined {
  const appName = getAppEnvPrefix();
  return appName ? process.env[`${appName}_${suffix}`] : undefined;
}

function stripNeonPooler(url: string): string {
  return url.replace(/-pooler(\.[a-z0-9.-]+\.neon\.tech)/, "$1");
}

interface RuntimeDatabaseResolution {
  url: string;
  source: string;
}

function envDatabaseValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function isUsableRuntimeDatabaseUrl(value: string): boolean {
  if (isPgliteUrl(value)) return true;
  if (!/^postgres(?:ql)?:\/\//i.test(value)) return false;
  return URL.canParse(value) && Boolean(new URL(value).hostname);
}

function usableRuntimeDatabaseValue(key: string): string | undefined {
  const value = envDatabaseValue(key);
  return value && isUsableRuntimeDatabaseUrl(value) ? value : undefined;
}

export function getIsolatedTestDatabaseUrl(): string | undefined {
  const isTestProcess =
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST === "1";
  const url = isTestProcess ? envDatabaseValue("DATABASE_URL") : undefined;
  return url && isPgliteUrl(url) ? url : undefined;
}

function resolveRuntimeDatabase(fallback = ""): RuntimeDatabaseResolution {
  const testUrl = getIsolatedTestDatabaseUrl();
  if (testUrl) return { url: testUrl, source: "DATABASE_URL" };
  const appName = getAppEnvPrefix();
  if (appName) {
    const appUnpooled = usableRuntimeDatabaseValue(
      `${appName}_DATABASE_URL_UNPOOLED`,
    );
    if (appUnpooled) {
      return {
        url: stripNeonPooler(appUnpooled),
        source: `${appName}_DATABASE_URL_UNPOOLED`,
      };
    }

    const appUrl = usableRuntimeDatabaseValue(`${appName}_DATABASE_URL`);
    if (appUrl) {
      return {
        url: isServerlessRuntime() ? stripNeonPooler(appUrl) : appUrl,
        source: `${appName}_DATABASE_URL`,
      };
    }
  }

  const configuredUnpooled = getAppConfig().runtime.databaseUrlUnpooled;
  if (configuredUnpooled && isUsableRuntimeDatabaseUrl(configuredUnpooled)) {
    const netlifyUnpooled = usableRuntimeDatabaseValue(
      "NETLIFY_DATABASE_URL_UNPOOLED",
    );
    const databaseUnpooled = usableRuntimeDatabaseValue(
      "DATABASE_URL_UNPOOLED",
    );
    return {
      url: stripNeonPooler(configuredUnpooled),
      source:
        netlifyUnpooled === configuredUnpooled
          ? "NETLIFY_DATABASE_URL_UNPOOLED"
          : databaseUnpooled === configuredUnpooled
            ? "DATABASE_URL_UNPOOLED"
            : "DATABASE_URL_UNPOOLED",
    };
  }

  const netlifyUnpooled = usableRuntimeDatabaseValue(
    "NETLIFY_DATABASE_URL_UNPOOLED",
  );
  if (netlifyUnpooled) {
    return {
      url: stripNeonPooler(netlifyUnpooled),
      source: "NETLIFY_DATABASE_URL_UNPOOLED",
    };
  }

  const databaseUnpooled = usableRuntimeDatabaseValue("DATABASE_URL_UNPOOLED");
  if (databaseUnpooled) {
    return {
      url: stripNeonPooler(databaseUnpooled),
      source: "DATABASE_URL_UNPOOLED",
    };
  }

  const databaseUrl = usableRuntimeDatabaseValue("DATABASE_URL");
  const netlifyDatabaseUrl = usableRuntimeDatabaseValue("NETLIFY_DATABASE_URL");
  const url = databaseUrl || netlifyDatabaseUrl || fallback;
  return {
    url: isServerlessRuntime() ? stripNeonPooler(url) : url,
    source: databaseUrl
      ? "DATABASE_URL"
      : netlifyDatabaseUrl
        ? "NETLIFY_DATABASE_URL"
        : "default",
  };
}

export function getRuntimeDatabaseUrl(fallback = ""): string {
  return resolveRuntimeDatabase(fallback).url;
}

export function getRuntimeDatabaseSource(fallback = ""): string {
  return resolveRuntimeDatabase(fallback).source;
}

function getAppEnvPrefix(): string | undefined {
  const appConfig = getAppConfig().app;
  const appName = appConfig.workspaceId || appConfig.name;
  return appName?.toUpperCase().replace(/-/g, "_") || undefined;
}

export function getMigrationDatabaseUrl(): string {
  const url =
    getIsolatedTestDatabaseUrl() ||
    getConfiguredUnpooledDatabaseUrl() ||
    getDatabaseUrl();
  return stripNeonPooler(url);
}

export function isPgliteUrl(url: string): boolean {
  return url.toLowerCase().startsWith("pglite:");
}

export function pgliteDataDirFromUrl(url: string): string {
  const raw = url.slice("pglite:".length);
  const dataDir = raw.startsWith("//") ? raw.slice(2) : raw;
  if (!dataDir || dataDir === "/") return "./data/pglite";
  if (
    dataDir === "memory" ||
    dataDir === "/memory" ||
    dataDir === ":memory:" ||
    dataDir === "/:memory:" ||
    dataDir === "memory://"
  ) {
    return "memory://";
  }
  return dataDir;
}

export function pgliteRuntimeDataDir(dataDir: string): string {
  if (dataDir === "memory://") return dataDir;
  if (!isServerlessRuntime() || path.isAbsolute(dataDir)) return dataDir;

  const safeParts = dataDir
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..");
  const safeRelative =
    safeParts.length > 0
      ? path.join(...safeParts)
      : path.join("data", "pglite");
  return path.join("/tmp", safeRelative);
}

export function pgliteClientKeyFromUrl(url: string): string {
  return pgliteClientKey(pgliteRuntimeDataDir(pgliteDataDirFromUrl(url)));
}

async function preparePgliteDataDir(dataDir: string): Promise<string> {
  const runtimeDataDir = pgliteRuntimeDataDir(dataDir);
  if (runtimeDataDir === "memory://") return runtimeDataDir;

  try {
    const fs = await import("fs");
    fs.mkdirSync(runtimeDataDir, { recursive: true });
  } catch {
    // Edge runtimes may not expose fs. PGlite will surface any real open error.
  }
  return runtimeDataDir;
}

async function importOptionalModule(specifier: string): Promise<any> {
  return import(/* @vite-ignore */ specifier);
}

function isMissingPackageError(err: unknown, packageName: string): boolean {
  const anyErr = err as any;
  const message = String(anyErr?.message ?? anyErr ?? "");
  return (
    (anyErr?.code === "ERR_MODULE_NOT_FOUND" &&
      message.includes(packageName)) ||
    message.includes(`Cannot find package '${packageName}'`) ||
    message.includes(`Cannot find module '${packageName}'`)
  );
}

export async function loadPglitePackage(): Promise<{ PGlite: any }> {
  const packageName = "@electric-sql/pglite";
  try {
    return (await importOptionalModule(packageName)) as { PGlite: any };
  } catch (err) {
    if (isMissingPackageError(err, packageName)) {
      throw new Error(
        "PGlite database support requires @electric-sql/pglite. " +
          "Install dependencies and set `DATABASE_URL=pglite:./data/pglite`.",
      );
    }
    throw err;
  }
}

export async function loadPgliteDrizzle(): Promise<{
  PGlite: any;
  drizzle: any;
}> {
  const drizzlePackage = "drizzle-orm/pglite";
  const { PGlite } = await loadPglitePackage();
  const drizzleMod = await importOptionalModule(drizzlePackage);
  return {
    PGlite,
    drizzle: drizzleMod.drizzle,
  };
}

type PgliteClientRegistry = Map<string, Promise<any>>;
type PgliteProcessLock = {
  fd: number;
  fs: typeof import("fs");
  path: string;
  contents: string;
};
type PgliteProcessLockRegistry = Map<string, PgliteProcessLock>;

const pgliteProcess = process as NodeJS.Process & {
  __agentNativePgliteClients?: PgliteClientRegistry;
  __agentNativePgliteProcessLocks?: PgliteProcessLockRegistry;
  __agentNativePgliteProcessExitCleanupRegistered?: boolean;
};
const _pgliteClients = (pgliteProcess.__agentNativePgliteClients ??= new Map<
  string,
  Promise<any>
>());
const _pgliteProcessLocks = (pgliteProcess.__agentNativePgliteProcessLocks ??=
  new Map<string, PgliteProcessLock>());

function pgliteClientKey(dataDir: string): string {
  return dataDir === "memory://" ? dataDir : path.resolve(dataDir);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function readPgliteProcessLockOwner(
  fs: typeof import("fs"),
  lockPath: string,
  dataDir: string,
): { pid: number; token: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch (error) {
    throw new Error(
      `PGlite database directory "${dataDir}" has an unreadable process lock at "${lockPath}". ` +
        "Confirm no local process owns it before removing the lock.",
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `PGlite database directory "${dataDir}" has an invalid process lock at "${lockPath}". ` +
        "Confirm no local process owns it before removing the lock.",
      { cause: error },
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Number.isInteger((parsed as { pid?: unknown }).pid) ||
    typeof (parsed as { token?: unknown }).token !== "string"
  ) {
    throw new Error(
      `PGlite database directory "${dataDir}" has an invalid process lock at "${lockPath}". ` +
        "Confirm no local process owns it before removing the lock.",
    );
  }
  return parsed as { pid: number; token: string };
}

function releasePgliteProcessLock(lock: PgliteProcessLock): void {
  try {
    lock.fs.closeSync(lock.fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "EBADF") {
      console.warn(
        "[db/pglite] process lock descriptor cleanup failed:",
        error,
      );
    }
  }
  try {
    if (lock.fs.readFileSync(lock.path, "utf8") === lock.contents) {
      lock.fs.unlinkSync(lock.path);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      console.warn("[db/pglite] process lock cleanup failed:", error);
    }
  }
}

function registerPgliteProcessExitCleanup(): void {
  if (pgliteProcess.__agentNativePgliteProcessExitCleanupRegistered) return;
  pgliteProcess.__agentNativePgliteProcessExitCleanupRegistered = true;
  process.once("exit", () => {
    for (const lock of _pgliteProcessLocks.values()) {
      releasePgliteProcessLock(lock);
    }
    _pgliteProcessLocks.clear();
  });
}

async function acquirePgliteProcessLock(
  dataDir: string,
): Promise<PgliteProcessLock | undefined> {
  if (dataDir === "memory://") return undefined;

  let fs: typeof import("fs");
  try {
    fs = await import("fs");
  } catch (error) {
    throw new Error(
      "PGlite persistent database access requires filesystem support.",
      { cause: error },
    );
  }

  const clientKey = pgliteClientKey(dataDir);
  const existing = _pgliteProcessLocks.get(clientKey);
  if (existing) return existing;

  const lockPath = `${clientKey}.agent-native-pglite.lock`;
  const contents = JSON.stringify({
    pid: process.pid,
    token: `${process.pid}:${Date.now()}:${Math.random()}`,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(fd, contents, "utf8");
      const lock = { fd, fs, path: lockPath, contents };
      _pgliteProcessLocks.set(clientKey, lock);
      registerPgliteProcessExitCleanup();
      return lock;
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (cleanupError) {
          console.warn(
            "[db/pglite] process lock descriptor cleanup failed:",
            cleanupError,
          );
        }
        try {
          fs.unlinkSync(lockPath);
        } catch (cleanupError) {
          console.warn(
            "[db/pglite] process lock file cleanup failed:",
            cleanupError,
          );
        }
      }

      if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") {
        throw error;
      }

      const owner = readPgliteProcessLockOwner(fs, lockPath, dataDir);
      if (isProcessAlive(owner.pid)) {
        throw new Error(
          `PGlite database directory "${dataDir}" is already owned by process ${owner.pid}. ` +
            "Stop that local process before opening this directory from another process.",
        );
      }
      fs.unlinkSync(lockPath);
    }
  }

  throw new Error(
    `Could not acquire the PGlite process lock for database directory "${dataDir}".`,
  );
}

export async function getPgliteClient(url: string): Promise<any> {
  const dataDir = await preparePgliteDataDir(pgliteDataDirFromUrl(url));
  const clientKey = pgliteClientKey(dataDir);
  let ready = _pgliteClients.get(clientKey);
  if (!ready) {
    ready = (async () => {
      const lock = await acquirePgliteProcessLock(dataDir);
      try {
        const { PGlite } = await loadPglitePackage();
        return await PGlite.create(clientKey);
      } catch (error) {
        if (lock) {
          _pgliteProcessLocks.delete(clientKey);
          releasePgliteProcessLock(lock);
        }
        throw error;
      }
    })();
    _pgliteClients.set(clientKey, ready);
    ready.catch(() => {
      if (_pgliteClients.get(clientKey) === ready) {
        _pgliteClients.delete(clientKey);
      }
    });
  }
  return ready;
}

export async function closePgliteClients(): Promise<void> {
  const clients = [..._pgliteClients.entries()];
  _pgliteClients.clear();
  await Promise.allSettled(
    clients.map(async ([clientKey, ready]) => {
      try {
        const client = await ready;
        await client.close().catch(() => {});
      } finally {
        const lock = _pgliteProcessLocks.get(clientKey);
        if (lock) {
          _pgliteProcessLocks.delete(clientKey);
          releasePgliteProcessLock(lock);
        }
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Safe JSON column parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSON-serialized column value defensively. A malformed row — from a
 * hand-edit, dirty migration, or a misbehaving agent that wrote raw SQL —
 * must not break an entire list endpoint. Callers supply a fallback for the
 * malformed path; null/undefined values also fall back.
 */
export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export async function retryOnDdlRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (!isPgCatalogRace(e)) throw e;
    return await fn();
  }
}

function isPgCatalogRace(e: any): boolean {
  const msg = String(e?.message ?? "");
  if (e?.code === "42P07") return true;
  if (e?.code === "42710") {
    const routine = String(e?.routine ?? "");
    return routine === "TypeCreate" || /type .* already exists/i.test(msg);
  }
  if (e?.code !== "23505") return false;
  const constraint = String(e?.constraint_name ?? e?.constraint ?? "");
  const detail = String(e?.detail ?? "");
  return (
    constraint.startsWith("pg_type") ||
    constraint.startsWith("pg_class") ||
    detail.includes("pg_type") ||
    detail.includes("pg_class") ||
    /relation .* already exists/i.test(msg)
  );
}

export function isUniqueViolation(e: any): boolean {
  if (e?.code === "23505") return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return (
    msg.includes("unique constraint") ||
    msg.includes("primary key constraint") ||
    msg.includes("duplicate key")
  );
}

export function isLocalDatabase(): boolean {
  return isPgliteUrl(getRuntimeDatabaseUrl("pglite:./data/pglite"));
}

export function toPostgresParams(sql: string): string {
  let out = "";
  let param = 0;
  let i = 0;
  let mode:
    | "normal"
    | "single"
    | "double"
    | "line-comment"
    | "block-comment"
    | "dollar" = "normal";
  let dollarTag = "";

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === "line-comment") {
      out += ch;
      i++;
      if (ch === "\n") mode = "normal";
      continue;
    }

    if (mode === "block-comment") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 2;
        mode = "normal";
        continue;
      }
      i++;
      continue;
    }

    if (mode === "single") {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") mode = "normal";
      i++;
      continue;
    }

    if (mode === "double") {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') mode = "normal";
      i++;
      continue;
    }

    if (mode === "dollar") {
      if (dollarTag && sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        mode = "normal";
        dollarTag = "";
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === "-" && next === "-") {
      out += ch + next;
      i += 2;
      mode = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += ch + next;
      i += 2;
      mode = "block-comment";
      continue;
    }
    if (ch === "'") {
      out += ch;
      i++;
      mode = "single";
      continue;
    }
    if (ch === '"') {
      out += ch;
      i++;
      mode = "double";
      continue;
    }
    if (ch === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        out += dollarTag;
        i += dollarTag.length;
        mode = "dollar";
        continue;
      }
    }
    if (ch === "?") {
      out += `$${++param}`;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function sqlAndArgs(sql: DbExecStatement): {
  rawSql: string;
  args: unknown[];
} {
  return typeof sql === "string"
    ? { rawSql: sql, args: [] }
    : { rawSql: sql.sql, args: sql.args || [] };
}

const POSTGRES_STATEMENT_TIMEOUT_HEADROOM_MS = 250;
const POSTGRES_STATEMENT_TIMEOUT_RESET_MS = 5_000;
const POSTGRES_MAX_INT = 2_147_483_647;

function hasExplicitDbTimeout(statement: DbExecStatement): boolean {
  if (typeof statement === "string") return false;
  const timeoutMs = Number(statement.timeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0;
}

function postgresStatementTimeoutMs(clientTimeoutMs: number): number {
  const safeTimeoutMs = Math.max(
    1,
    Math.min(POSTGRES_MAX_INT, Math.floor(clientTimeoutMs)),
  );
  const headroomMs = Math.min(
    POSTGRES_STATEMENT_TIMEOUT_HEADROOM_MS,
    Math.max(1, Math.floor(safeTimeoutMs * 0.1)),
  );
  return Math.max(1, safeTimeoutMs - headroomMs);
}

export function dbExecQueryBudget(statement: DbExecStatement): {
  timeoutMs: number;
  maxAttempts: number;
} {
  if (typeof statement === "string") {
    return { timeoutMs: dbOpTimeoutMs(), maxAttempts: 3 };
  }
  const timeoutMs = Number(statement.timeoutMs);
  const maxAttempts = Number(statement.maxAttempts);
  return {
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.floor(timeoutMs)
        : dbOpTimeoutMs(),
    maxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0
        ? Math.floor(maxAttempts)
        : 3,
  };
}

function explicitTransaction(
  execute: DbExec["execute"],
  begin = "BEGIN",
): NonNullable<DbExec["transaction"]> {
  return async (fn) => {
    await execute(begin);
    try {
      const result = await fn({ execute });
      await execute("COMMIT");
      return result;
    } catch (err) {
      await execute("ROLLBACK").catch(() => {});
      throw err;
    }
  };
}

const CONNECTION_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EMAXCONN",
  "53300",
  "CONNECT_TIMEOUT",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
]);

export function isConnectionError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const name = err.name || err.cause?.name || "";
  if (name === "ErrorEvent") return true;
  const stack = String(err.stack || err.cause?.stack || "");
  if (
    /WebSocket\.#onSocketClose|failWebsocketConnection|onSocketClose/.test(
      stack,
    )
  ) {
    return true;
  }
  const msg = String(err.message || err.cause?.message || "");
  return /ECONNRESET|ETIMEDOUT|EPIPE|EMAXCONN|too many connections|max client connections|remaining connection slots|connection.*(closed|ended|terminated)|socket hang up|websocket/i.test(
    msg,
  );
}

export function isTransientDatabaseError(err: unknown): boolean {
  const error = err as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    cause?: {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
  };
  const code = String(error?.code ?? error?.cause?.code ?? "");
  if (
    code === "ECHECKOUTTIMEOUT" ||
    code === "DB_CONNECT_COOLDOWN" ||
    code === "EMAXCONN" ||
    code === "53300" ||
    code === "57014" ||
    /^08/.test(code) ||
    /^57P0[123]$/.test(code)
  ) {
    return true;
  }

  const message = [error?.message, error?.cause?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (
    /\bstatement timeout\b|\bdb (?:query|connect) timed out\b/i.test(message)
  ) {
    return true;
  }

  const databaseSurface = [
    error?.name,
    error?.cause?.name,
    error?.stack,
    error?.cause?.stack,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    isConnectionError(error) &&
    /@neondatabase|\bpostgres(?:ql)?\b|\bpg-pool\b|drizzle-orm|\/db\/client\.[cm]?[jt]s/i.test(
      databaseSurface,
    )
  );
}

export async function retryOnConnectionError<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isConnectionError(e) || attempt === maxAttempts - 1) throw e;
      recordDatabaseRetry();
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  throw last;
}

export function dbOpTimeoutMs(): number {
  const raw = Number(process.env.DB_OP_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return isServerlessRuntime() ? 8_000 : 30_000;
}

class DbTimeoutError extends Error {
  code = "CONNECT_TIMEOUT";
  constructor(op: string, ms: number) {
    super(`DB ${op} timed out after ${ms}ms (connection terminated)`);
    this.name = "DbTimeoutError";
  }
}

export async function withDbTimeout<T>(
  op: string,
  run: () => Promise<T>,
  ms = dbOpTimeoutMs(),
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const finishTelemetry = beginDatabaseOperation(
    op === "connect" ? "connect" : "query",
  );

  const runCleanup = async () => {
    if (!onTimeout) return;
    try {
      await onTimeout();
    } catch (err) {
      console.warn(
        `[db] timeout cleanup for ${op} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  return await new Promise<T>((resolve, reject) => {
    const finish = (
      complete: (value: T | PromiseLike<T>) => void,
      value: T | PromiseLike<T>,
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      finishTelemetry("success");
      complete(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      finishTelemetry("error");
      reject(err);
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void (async () => {
        await runCleanup();
        finishTelemetry("timeout");
        reject(new DbTimeoutError(op, ms));
      })();
    }, ms);

    let promise: Promise<T>;
    try {
      promise = run();
    } catch (err) {
      fail(err);
      return;
    }
    promise.then((value) => finish(resolve, value), fail);
  });
}

export function isServerlessRuntime(): boolean {
  return (
    !!process.env.NETLIFY ||
    !!process.env.NETLIFY_FUNCTION_NAME ||
    !!process.env.VERCEL ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.LAMBDA_TASK_ROOT ||
    !!process.env.CF_PAGES ||
    hasCloudflareRuntime()
  );
}

export function isProductionServerlessFunctionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production" || env.NETLIFY_LOCAL === "true") {
    return false;
  }

  return Boolean(
    env.NETLIFY === "true" ||
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_VERSION ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION ||
    env.VERCEL === "1",
  );
}

export function isHostedFunctionInvocationRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (hasCloudflareRuntime()) return true;

  if (env.NODE_ENV !== "production" || env.NETLIFY_LOCAL === "true") {
    return false;
  }

  return Boolean(
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION,
  );
}

export class HostedRuntimeLocalDatabaseError extends Error {
  constructor(source: string) {
    super(
      `Hosted function invocation resolved to local PGlite (source: ${source}). ` +
        "DATABASE_URL, DATABASE_URL_UNPOOLED, NETLIFY_DATABASE_URL, NETLIFY_DATABASE_URL_UNPOOLED " +
        "(and their <APP_NAME>_ prefixed variants) were all empty or masked — refusing to serve " +
        "requests off an ephemeral per-instance file instead of the shared database.",
    );
    this.name = "HostedRuntimeLocalDatabaseError";
  }
}

export function assertHostedRuntimeDatabase(): void {
  if (isMigrationAuthorizedRuntime()) return;
  if (!isLocalDatabase()) return;
  if (isHostedFunctionInvocationRuntime()) {
    throw new HostedRuntimeLocalDatabaseError(getRuntimeDatabaseSource());
  }
  if (isEmbeddedRuntimeAuthorized()) return;
  if (process.env.NODE_ENV === "production" && isServerRuntimeStarted()) {
    throw new HostedRuntimeLocalDatabaseError(getRuntimeDatabaseSource());
  }
}

const SCHEMA_MUTATION_STATEMENT =
  /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|COMMENT|REINDEX|GRANT|REVOKE)\b/i;

function rawSql(statement: DbExecStatement): string {
  return typeof statement === "string" ? statement : statement.sql;
}

export function isSchemaMutationStatement(statement: DbExecStatement): boolean {
  return SCHEMA_MUTATION_STATEMENT.test(rawSql(statement));
}

/**
 * Request functions must never be able to prepare or mutate schema. Throwing
 * here makes an unconverted ensureTable path fail loudly instead of silently
 * reporting success against a missing table. The release migration wrapper
 * is the only supported production opt-in.
 */
export function assertSchemaMutationAllowed(statement: DbExecStatement): void {
  if (
    isProductionServerlessFunctionRuntime() &&
    !isMigrationAuthorizedRuntime() &&
    isSchemaMutationStatement(statement)
  ) {
    throw new Error(
      "Schema mutation attempted in a production serverless request. Run migrations in the release job instead.",
    );
  }
}

function poolApplicationName(): string {
  const site =
    process.env.SITE_NAME ??
    process.env.NETLIFY_SITE_NAME ??
    process.env.AGENT_NATIVE_APP_NAME ??
    "app";
  return `agent-native:${site}`.slice(0, 63);
}

export function pgPoolOptions(url: string): Record<string, unknown> {
  const serverless = isServerlessRuntime();
  const max =
    getAppConfig().runtime.databasePoolMax ??
    (serverless ? serverlessPoolMax() : 20);
  return {
    onnotice: () => {},
    connection: { application_name: poolApplicationName() },
    max,
    idle_timeout: serverless ? 20 : 240,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    ...(serverless
      ? {
          connection: {
            application_name: poolApplicationName(),
            idle_in_transaction_session_timeout: 30_000,
          },
        }
      : {}),
    ...(url.includes("supabase") ? { prepare: false } : {}),
  };
}

export function neonPoolOptions(): {
  max: number;
  idle_in_transaction_session_timeout?: number;
} {
  return {
    max: neonPoolMax(),
    ...(isServerlessRuntime()
      ? { idle_in_transaction_session_timeout: 30_000 }
      : {}),
  };
}

export function neonPoolMax(): number {
  return (
    getAppConfig().runtime.databasePoolMax ??
    (isServerlessRuntime() ? serverlessPoolMax() : 20)
  );
}

function serverlessPoolMax(): number {
  if (isLowConnectionBackgroundRuntime()) return 1;
  if (isBackgroundFunctionPoolContext()) return 4;
  return 2;
}

function isLowConnectionBackgroundRuntime(): boolean {
  return (
    (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_LOW_CONNECTION_BACKGROUND_RUNTIME__ === true
  );
}

export function isBackgroundFunctionPoolContext(): boolean {
  if (
    (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_BACKGROUND_RUNTIME__ === true
  ) {
    return true;
  }
  const lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (
    typeof lambdaName === "string" &&
    lambdaName.toLowerCase().endsWith("-background")
  ) {
    return true;
  }
  const forced = process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME;
  if (forced != null) {
    const v = forced.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return false;
}

export function describeDbError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const evt = err as {
      message?: unknown;
      error?: { message?: unknown };
      type?: unknown;
    };
    const msg = evt.message ?? evt.error?.message;
    if (typeof msg === "string" && msg) return msg;
    if (evt.type === "error") {
      return "WebSocket ErrorEvent (connection failed; no message attached)";
    }
  }
  return String(err);
}

function connectCooldownMs(): number {
  const raw = Number(process.env.DB_CONNECT_COOLDOWN_MS);
  const base = Number.isFinite(raw) && raw > 0 ? raw : 2_000;
  return Math.round(base * (0.5 + Math.random()));
}

export class DbConnectCooldownError extends Error {
  code = "DB_CONNECT_COOLDOWN";
  constructor(remainingMs: number, refusedBy: string) {
    super(
      `Database is refusing connection attempts; not attempting again for ${remainingMs}ms. Last failure: ${refusedBy}`,
    );
    this.name = "DbConnectCooldownError";
  }
}

const connectCooldowns = new Map<
  string,
  { until: number; refusedBy: string }
>();

function gateNeonConnect(
  pool: Record<string, any>,
  url: string,
  label: string,
): void {
  const connect = pool.connect;
  if (typeof connect !== "function") return;
  const gated = function gatedConnect(this: unknown, ...args: unknown[]) {
    const idle = typeof pool.idleCount === "number" ? pool.idleCount : 0;
    const gate = connectCooldowns.get(url);
    if (idle === 0 && gate && Date.now() < gate.until) {
      return Promise.reject(
        new DbConnectCooldownError(gate.until - Date.now(), gate.refusedBy),
      );
    }
    return Promise.resolve(connect.apply(this, args)).then(
      (client: unknown) => {
        connectCooldowns.delete(url);
        return client;
      },
      (err: unknown) => {
        const refusedBy = describeDbError(err);
        const ms = connectCooldownMs();
        if (!gate || Date.now() >= gate.until) {
          console.warn(
            `[${label}] connection attempt refused; pausing attempts ${ms}ms:`,
            refusedBy,
          );
        }
        connectCooldowns.set(url, { until: Date.now() + ms, refusedBy });
        throw err;
      },
    );
  };
  Object.assign(gated, connect);
  pool.connect = gated;
}

export function guardNeonPool(
  pool: unknown,
  url: string,
  label = "db/neon",
): void {
  if (!pool || typeof pool !== "object") return;
  if (loggedNeonPools.has(pool)) return;
  const withEvents = pool as {
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
  if (typeof withEvents.on !== "function") return;

  loggedNeonPools.add(pool);
  gateNeonConnect(pool as Record<string, any>, url, label);
  withEvents.on("error", (err: unknown) => {
    console.warn(
      `[${label}] pool error (will reconnect on next query):`,
      describeDbError(err),
    );
  });

  withEvents.on("connect", (client: unknown) => {
    if (!client || typeof client !== "object") return;
    const clientEvents = client as {
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    };
    if (typeof clientEvents.on !== "function") return;
    clientEvents.on("error", (err: unknown) => {
      console.warn(
        `[${label}] client connection error (connection discarded, next query reconnects):`,
        describeDbError(err),
      );
    });
  });
}

interface ClosablePool {
  end(): Promise<unknown>;
}

const _sharedDbPools = new Map<string, ClosablePool>();
const _sharedDbPoolCloseHooks = new Set<() => void>();
const _sharedDbPoolReplacementHooks = new Map<string, Set<() => void>>();

/**
 * One connection pool per (driver, URL) for the whole process.
 *
 * Opening a connection to a remote database costs a full TCP + TLS + auth
 * round-trip chain (~300-800ms measured against Neon in-region), and it used
 * to be paid once per CONSUMER: the `getDbExec` singleton, Better Auth, and one
 * more for every `createGetDb()` schema module (four in core alone, plus each
 * app's). Their `max` values also multiplied against the provider's connection
 * cap, which forced each pool down to a size too small to run a request's reads
 * concurrently.
 *
 * TRAP: only consumers that live as long as the process may share. Anything
 * handed a `close()` — `createDbExec()`, the migration exec on the direct
 * endpoint — must keep a private pool, or closing it takes the whole process's
 * database access down with it.
 */
export function sharedDbPool<T extends ClosablePool>(
  driver: string,
  url: string,
  create: () => T,
): T {
  const key = `${driver}\u0000${url}`;
  const existing = _sharedDbPools.get(key);
  if (existing) return existing as T;
  const created = create();
  _sharedDbPools.set(key, created);
  return created;
}

export function replaceSharedDbPool<T extends ClosablePool>(
  driver: string,
  url: string,
  previous: T,
  next: T,
): void {
  const key = `${driver}\u0000${url}`;
  if (_sharedDbPools.get(key) !== previous) return;
  _sharedDbPools.set(key, next);
  for (const hook of _sharedDbPoolReplacementHooks.get(key) ?? []) {
    try {
      hook();
    } catch {
      // A consumer's reset must not block the replacement from being used.
    }
  }
}

export function onSharedDbPoolReplaced(
  driver: string,
  url: string,
  hook: () => void,
): void {
  const key = `${driver}${String.fromCharCode(0)}${url}`;
  const hooks = _sharedDbPoolReplacementHooks.get(key) ?? new Set();
  hooks.add(hook);
  _sharedDbPoolReplacementHooks.set(key, hooks);
}

export function onSharedDbPoolsClosed(hook: () => void): void {
  _sharedDbPoolCloseHooks.add(hook);
}

export async function closeSharedDbPools(): Promise<void> {
  const pools = [..._sharedDbPools.values()];
  _sharedDbPools.clear();
  for (const hook of _sharedDbPoolCloseHooks) {
    try {
      hook();
    } catch {
      // A consumer's reset must not block the rest from being released.
    }
  }
  await Promise.all(
    pools.map((pool) =>
      Promise.resolve(pool.end()).catch(() => {
        // Already closed (process exiting, provider hung up) — nothing to do.
      }),
    ),
  );
}

function disposePostgresPoolEventually(
  pool: { end: () => Promise<unknown> },
  label: string,
): void {
  if (!pool || typeof pool !== "object") return;
  if (recyclingPostgresPools.has(pool)) return;
  recyclingPostgresPools.add(pool);
  void pool.end().catch((err: unknown) => {
    console.warn(
      `[db/postgres] ${label} cleanup failed:`,
      err instanceof Error ? err.message : err,
    );
  });
}

let _exec: DbExec | undefined;
let _initPromise: Promise<void> | undefined;

async function executePglite(
  client: {
    query: (
      sql: string,
      args?: any[],
    ) => Promise<{ rows?: any[]; affectedRows?: number; rowCount?: number }>;
  },
  sql: Parameters<DbExec["execute"]>[0],
): ReturnType<DbExec["execute"]> {
  const { rawSql, args } = sqlAndArgs(sql);
  const pgSql = toPostgresParams(rawSql);
  const result = await client.query(pgSql, args as any[]);
  return {
    rows: Array.from(result.rows ?? []),
    rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
  };
}

function runPgliteTransaction<T>(
  url: string,
  client: any,
  fn: (tx: any, transactionExec: DbExec) => Promise<T>,
): Promise<T> {
  if (getActivePgliteTransactionExec(url)) {
    throw new Error(
      "Nested PGlite transactions are not supported; reuse the active transaction handle.",
    );
  }
  if (!pgliteTransactionStorage) {
    throw new Error(
      "PGlite transactions require AsyncLocalStorage so database access stays on the active transaction handle.",
    );
  }
  const clientKey = pgliteClientKeyFromUrl(url);
  return client.transaction((tx: any) => {
    const transactionExec: DbExec = {
      execute: (sql) => executePglite(tx, sql),
    };
    const activeTransactions = new Map(pgliteTransactionStorage.getStore());
    activeTransactions.set(clientKey, {
      client: tx,
      exec: transactionExec,
    });
    return pgliteTransactionStorage.run(activeTransactions, () =>
      fn(tx, transactionExec),
    );
  });
}

export function pgliteDrizzleClient(url: string, client: any): any {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "transaction") {
        return (fn: (tx: any) => Promise<unknown>) =>
          runPgliteTransaction(url, target, (tx) => fn(tx));
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

async function createDbExecInternal(
  config: DbExecConfig = {},
  trackSingletonResources = false,
): Promise<DbExec> {
  const url = config.url || "pglite:./data/pglite";
  if (!isPgliteUrl(url) && !/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL or a pglite: URL.");
  }

  if (isPgliteUrl(url)) {
    const client = await getPgliteClient(url);
    return {
      execute: (sql) =>
        executePglite(getActivePgliteTransactionClient(url) ?? client, sql),
      transaction: (fn) =>
        runPgliteTransaction(url, client, (_tx, transactionExec) =>
          fn(transactionExec),
        ),
    };
  }

  const { isNeonUrl } = await import("./create-get-db.js");

  if (isNeonUrl(url)) {
    const { Pool, neon } = await import("@neondatabase/serverless");
    const bgHttp = isBackgroundFunctionPoolContext();
    const makePool = () =>
      new Pool({ connectionString: url, ...neonPoolOptions() });
    const pool = trackSingletonResources
      ? sharedDbPool("neon", url, makePool)
      : makePool();
    guardNeonPool(pool, url);
    const httpSql = bgHttp ? neon(url, { fullResults: true }) : null;
    async function queryNeonClient(
      client: any,
      sql: Parameters<DbExec["execute"]>[0],
      timeoutOverrideMs?: number,
    ) {
      const { rawSql, args } = sqlAndArgs(sql);
      const { timeoutMs } = dbExecQueryBudget(sql);
      const pgSql = toPostgresParams(rawSql);
      const runQuery = () =>
        args.length === 0 && rawSql.includes(";")
          ? client.query(pgSql)
          : client.query(pgSql, args as any[]);
      const result = await withDbTimeout(
        "query",
        () => runQuery() as Promise<{ rows: unknown[]; rowCount?: number }>,
        timeoutOverrideMs ?? timeoutMs,
      );
      return {
        rows: result.rows,
        rowsAffected: result.rowCount ?? 0,
      };
    }
    async function queryNeonClientWithStatementTimeout(
      client: any,
      sql: Parameters<DbExec["execute"]>[0],
      remainingMs: () => number,
      markClientForDiscard: () => void,
    ) {
      const statementTimeoutMs = postgresStatementTimeoutMs(remainingMs());
      await queryNeonClient(
        client,
        `SET statement_timeout = ${statementTimeoutMs}`,
        remainingMs(),
      );
      try {
        return await queryNeonClient(client, sql, remainingMs());
      } finally {
        try {
          await queryNeonClient(
            client,
            "RESET statement_timeout",
            Math.max(remainingMs(), POSTGRES_STATEMENT_TIMEOUT_RESET_MS),
          );
        } catch (err) {
          markClientForDiscard();
          console.warn(
            "[db/neon] statement timeout reset failed; discarding connection:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
    async function queryNeonHttp(sql: Parameters<DbExec["execute"]>[0]) {
      if (!httpSql) {
        throw new Error("Neon HTTP query used outside a background function");
      }
      const { rawSql, args } = sqlAndArgs(sql);
      const { timeoutMs } = dbExecQueryBudget(sql);
      const pgSql = toPostgresParams(rawSql);
      const controller = new AbortController();
      const run = async () => {
        if (!hasExplicitDbTimeout(sql)) {
          return httpSql.query(pgSql, args as any[], {
            fetchOptions: { signal: controller.signal },
          });
        }
        const statementDeadlineMs =
          Date.now() + postgresStatementTimeoutMs(timeoutMs);
        const results = await httpSql.transaction(
          [
            httpSql.query(
              `SELECT set_config(
                  'statement_timeout',
                  GREATEST(
                    1,
                    $1::bigint -
                      FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
                  )::text,
                  true
                )`,
              [statementDeadlineMs],
            ),
            httpSql.query(pgSql, args as any[]),
          ],
          { fetchOptions: { signal: controller.signal } },
        );
        return results[1];
      };
      const result = await withDbTimeout("query", run, timeoutMs, () =>
        controller.abort(),
      );
      return {
        rows: result.rows,
        rowsAffected: result.rowCount ?? 0,
      };
    }
    return {
      async execute(sql) {
        const { timeoutMs, maxAttempts } = dbExecQueryBudget(sql);
        if (bgHttp) {
          return retryOnConnectionError<{
            rows: unknown[];
            rowsAffected: number;
          }>(() => queryNeonHttp(sql), maxAttempts);
        }
        const result = await retryOnConnectionError<{
          rows: unknown[];
          rowsAffected: number;
        }>(async () => {
          const attemptStartedAt = Date.now();
          const remainingAttemptMs = () =>
            Math.max(1, timeoutMs - (Date.now() - attemptStartedAt));
          let acquireTimedOut = false;
          const client = await withDbTimeout(
            "connect",
            () =>
              pool.connect().then((c) => {
                if (acquireTimedOut) c.release();
                return c;
              }),
            remainingAttemptMs(),
            () => {
              acquireTimedOut = true;
            },
          );
          let released = false;
          const releaseClient = (err?: Error | boolean) => {
            if (released) return;
            released = true;
            client.release(err);
          };
          let discardClient = false;

          try {
            const result = hasExplicitDbTimeout(sql)
              ? await queryNeonClientWithStatementTimeout(
                  client,
                  sql,
                  remainingAttemptMs,
                  () => {
                    discardClient = true;
                  },
                )
              : await queryNeonClient(client, sql, remainingAttemptMs());
            releaseClient(discardClient ? true : undefined);
            return result;
          } catch (err) {
            releaseClient(
              discardClient || isConnectionError(err) ? true : undefined,
            );
            throw err;
          }
        }, maxAttempts);
        return {
          rows: result.rows,
          rowsAffected: result.rowsAffected,
        };
      },
      async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
        return retryOnConnectionError(async () => {
          let acquireTimedOut = false;
          const client = await withDbTimeout(
            "connect",
            () =>
              pool.connect().then((c) => {
                if (acquireTimedOut) c.release();
                return c;
              }),
            dbOpTimeoutMs(),
            () => {
              acquireTimedOut = true;
            },
          );
          let released = false;
          const releaseClient = (err?: Error | boolean) => {
            if (released) return;
            released = true;
            client.release(err);
          };
          const tx: DbExec = {
            execute: async (sql) => {
              if (!hasExplicitDbTimeout(sql)) {
                return queryNeonClient(client, sql);
              }
              const { timeoutMs } = dbExecQueryBudget(sql);
              const startedAt = Date.now();
              const remainingMs = () =>
                Math.max(1, timeoutMs - (Date.now() - startedAt));
              const statementTimeoutMs =
                postgresStatementTimeoutMs(remainingMs());
              await queryNeonClient(
                client,
                `SET LOCAL statement_timeout = ${statementTimeoutMs}`,
                remainingMs(),
              );
              return queryNeonClient(client, sql, remainingMs());
            },
          };
          try {
            await queryNeonClient(
              client,
              "BEGIN; SET LOCAL idle_in_transaction_session_timeout = 30000",
            );
            const result = await fn(tx);
            await queryNeonClient(client, "COMMIT");
            releaseClient();
            return result;
          } catch (err) {
            let rollbackFailed = false;
            try {
              await queryNeonClient(client, "ROLLBACK");
            } catch {
              rollbackFailed = true;
            }
            releaseClient(
              isConnectionError(err) || rollbackFailed ? true : undefined,
            );
            throw err;
          }
        }, 1);
      },
      async close() {
        if (trackSingletonResources) return closeSharedDbPools();
        await pool.end();
      },
    };
  }

  const { default: postgres } = await import("postgres");
  const isWorkers =
    "__cf_env" in globalThis ||
    (typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers");

  if (isWorkers) {
    return {
      async execute(sql) {
        const conn = postgres(url, {
          max: 1,
          idle_timeout: 0,
          onnotice: () => {},
        });
        let timedOut = false;
        try {
          const rawSql = typeof sql === "string" ? sql : sql.sql;
          const args = typeof sql === "string" ? [] : sql.args || [];
          const { timeoutMs } = dbExecQueryBudget(sql);
          const pgSql = toPostgresParams(rawSql);
          const result = await withDbTimeout<
            ArrayLike<unknown> & { count?: number }
          >(
            "query",
            () =>
              conn.unsafe(pgSql, args as any[]) as Promise<
                ArrayLike<unknown> & { count?: number }
              >,
            timeoutMs,
            () => {
              timedOut = true;
              disposePostgresPoolEventually(conn, "timed-out worker query");
            },
          );
          return {
            rows: Array.from(result),
            rowsAffected: result.count ?? 0,
          };
        } finally {
          if (!timedOut) {
            await conn.end().catch((err: unknown) => {
              console.warn(
                "[db/postgres] worker query cleanup failed:",
                err instanceof Error ? err.message : err,
              );
            });
          }
        }
      },
      async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
        const conn = postgres(url, {
          max: 1,
          idle_timeout: 0,
          onnotice: () => {},
        });
        try {
          const result = await conn.begin(async (txSql: any) => {
            const tx: DbExec = {
              async execute(sql) {
                const { rawSql, args } = sqlAndArgs(sql);
                const { timeoutMs } = dbExecQueryBudget(sql);
                const pgSql = toPostgresParams(rawSql);
                const result = await withDbTimeout<
                  ArrayLike<unknown> & { count?: number }
                >(
                  "query",
                  () =>
                    txSql.unsafe(pgSql, args as any[]) as Promise<
                      ArrayLike<unknown> & { count?: number }
                    >,
                  timeoutMs,
                );
                return {
                  rows: Array.from(result),
                  rowsAffected: result.count ?? 0,
                };
              },
            };
            return fn(tx);
          });
          return result as T;
        } finally {
          await conn.end().catch((err: unknown) => {
            console.warn(
              "[db/postgres] worker transaction cleanup failed:",
              err instanceof Error ? err.message : err,
            );
          });
        }
      },
    };
  } else {
    const createPool = () => postgres(url, pgPoolOptions(url));
    type PostgresPool = ReturnType<typeof createPool>;
    let pool = trackSingletonResources
      ? sharedDbPool("postgres-js", url, createPool)
      : createPool();
    const recyclePool = (timedOutPool: PostgresPool) => {
      if (pool === timedOutPool) {
        pool = createPool();
        if (trackSingletonResources) {
          replaceSharedDbPool("postgres-js", url, timedOutPool, pool);
        }
      }
      disposePostgresPoolEventually(timedOutPool, "timed-out pooled query");
    };

    return {
      async execute(sql) {
        const { rawSql, args } = sqlAndArgs(sql);
        const { timeoutMs, maxAttempts } = dbExecQueryBudget(sql);
        const pgSql = toPostgresParams(rawSql);
        const result = await retryOnConnectionError<
          ArrayLike<unknown> & { count?: number }
        >(() => {
          const queryPool = pool;
          const query = queryPool.unsafe(pgSql, args as any[]);
          return withDbTimeout(
            "query",
            () => query,
            timeoutMs,
            () => recyclePool(queryPool),
          );
        }, maxAttempts);
        return {
          rows: Array.from(result),
          rowsAffected: result.count ?? 0,
        };
      },
      async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
        const result = await pool.begin(async (txSql: any) => {
          const tx: DbExec = {
            async execute(sql) {
              const { rawSql, args } = sqlAndArgs(sql);
              const { timeoutMs } = dbExecQueryBudget(sql);
              const pgSql = toPostgresParams(rawSql);
              const result = await withDbTimeout<
                ArrayLike<unknown> & { count?: number }
              >(
                "query",
                () =>
                  txSql.unsafe(pgSql, args as any[]) as Promise<
                    ArrayLike<unknown> & { count?: number }
                  >,
                timeoutMs,
              );
              return {
                rows: Array.from(result),
                rowsAffected: result.count ?? 0,
              };
            },
          };
          return fn(tx);
        });
        return result as T;
      },
      async close() {
        if (trackSingletonResources) return closeSharedDbPools();
        await pool.end();
      },
    };
  }
}

export async function createDbExec(config: DbExecConfig = {}): Promise<DbExec> {
  const exec = await createDbExecInternal(config, false);
  return guardSchemaMutations(exec);
}

function guardSchemaMutations(exec: DbExec): DbExec {
  const guarded: DbExec = {
    async execute(statement) {
      assertSchemaMutationAllowed(statement);
      return exec.execute(statement);
    },
  };
  if (exec.atomicBatch) {
    guarded.atomicBatch = async (statements) => {
      for (const statement of statements) {
        assertSchemaMutationAllowed(statement);
      }
      return exec.atomicBatch!(statements);
    };
  }
  if (exec.transaction) {
    guarded.transaction = (fn) =>
      exec.transaction!((tx) =>
        fn({
          ...tx,
          execute: async (statement) => {
            assertSchemaMutationAllowed(statement);
            return tx.execute(statement);
          },
        }),
      );
  }
  if (exec.close) guarded.close = () => exec.close!();
  return guarded;
}

async function initClient(): Promise<void> {
  if (_exec) return;

  assertHostedRuntimeDatabase();

  const url = getRuntimeDatabaseUrl("pglite:./data/pglite");
  _exec = await createDbExecInternal({ url }, true);
}

export function annotateMissingTable(err: unknown, sql: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const match = /relation\s+["'`]?([\w.]+)["'`]?\s+does not exist/i.exec(
    err.message,
  );
  if (!match) return err;
  if (err.message.includes("server/plugins/db.ts")) return err;
  const statement =
    typeof sql === "string" ? sql : (sql as { sql?: string })?.sql;
  err.message =
    `${err.message}\n` +
    `  [agent-native] Table "${match[1]}" does not exist. App tables are created by migrations in ` +
    `server/plugins/db.ts — check that the plugin exists and declares a migration for this table, ` +
    `then restart the dev server so it runs.` +
    (statement ? `\n  Statement: ${statement.slice(0, 200)}` : "");
  return err;
}

const scopedDbExec = new AsyncLocalStorage<DbExec>();

export function withDbExec<T>(exec: DbExec, run: () => T): T {
  return scopedDbExec.run(exec, run);
}

export function getDbExec(): DbExec {
  const scoped = scopedDbExec.getStore();
  if (scoped) return scoped;
  if (_exec) return _exec;

  function sanitize(
    sql: string | { sql: string; args?: unknown[] },
  ): string | { sql: string; args?: unknown[] } {
    if (typeof sql === "object" && sql.args) {
      return { ...sql, args: sql.args.map((a) => a ?? null) };
    }
    return sql;
  }

  async function execAnnotated(
    s: string | { sql: string; args?: unknown[] },
  ): ReturnType<DbExec["execute"]> {
    assertSchemaMutationAllowed(s);
    try {
      return await _exec!.execute(sanitize(s));
    } catch (err) {
      throw annotateMissingTable(err, s);
    }
  }

  const proxy: DbExec = {
    async execute(sql) {
      assertSchemaMutationAllowed(sql);
      if (!_initPromise) _initPromise = initClient();
      try {
        await _initPromise;
      } catch (err) {
        _initPromise = undefined;
        _exec = undefined;
        throw err;
      }
      const wrapper: DbExec = {
        execute: (s) => execAnnotated(s),
        atomicBatch: _exec!.atomicBatch
          ? async (statements) => {
              for (const statement of statements) {
                assertSchemaMutationAllowed(statement);
              }
              return _exec!.atomicBatch!(statements.map((s) => sanitize(s)));
            }
          : undefined,
        transaction: _exec!.transaction
          ? (fn) =>
              _exec!.transaction!((tx) =>
                fn({
                  execute: (s) => {
                    assertSchemaMutationAllowed(s);
                    return tx.execute(sanitize(s));
                  },
                  transaction: tx.transaction?.bind(tx),
                }),
              )
          : undefined,
      };
      Object.assign(proxy, wrapper);
      return execAnnotated(sql);
    },
    async transaction(fn) {
      if (!_initPromise) _initPromise = initClient();
      try {
        await _initPromise;
      } catch (err) {
        _initPromise = undefined;
        _exec = undefined;
        throw err;
      }
      const wrapper: DbExec = {
        execute: (s) => execAnnotated(s),
        atomicBatch: _exec!.atomicBatch
          ? async (statements) => {
              for (const statement of statements) {
                assertSchemaMutationAllowed(statement);
              }
              return _exec!.atomicBatch!(statements.map((s) => sanitize(s)));
            }
          : undefined,
        transaction: _exec!.transaction
          ? (innerFn) =>
              _exec!.transaction!((tx) =>
                innerFn({
                  execute: (s) => {
                    assertSchemaMutationAllowed(s);
                    return tx.execute(sanitize(s));
                  },
                  transaction: tx.transaction?.bind(tx),
                }),
              )
          : undefined,
      };
      Object.assign(proxy, wrapper);
      if (_exec!.transaction) {
        return _exec!.transaction((tx) =>
          fn({
            execute: (s) => {
              assertSchemaMutationAllowed(s);
              return tx.execute(sanitize(s));
            },
            transaction: tx.transaction?.bind(tx),
          }),
        );
      }
      if (_exec!.atomicBatch) {
        throw new Error(
          "This database supports atomic batches, not interactive transactions.",
        );
      }
      return explicitTransaction(wrapper.execute.bind(wrapper))(fn);
    },
    async atomicBatch(statements) {
      for (const statement of statements) {
        assertSchemaMutationAllowed(statement);
      }
      if (!_initPromise) _initPromise = initClient();
      try {
        await _initPromise;
      } catch (err) {
        _initPromise = undefined;
        _exec = undefined;
        throw err;
      }
      if (!_exec!.atomicBatch) {
        throw new Error("This database does not support atomic batches.");
      }
      const batch = async (items: typeof statements) => {
        for (const item of items) {
          assertSchemaMutationAllowed(item);
        }
        return _exec!.atomicBatch!(items.map((item) => sanitize(item)));
      };
      Object.assign(proxy, { atomicBatch: batch });
      return batch(statements);
    },
  };
  return proxy;
}

export async function closeDbExec(): Promise<void> {
  await closeSharedDbPools();
  await closePgliteClients();
  _exec = undefined;
  _initPromise = undefined;
}
