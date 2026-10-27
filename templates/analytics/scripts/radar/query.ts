import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import postgres from "postgres";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../../..");
export const RADAR_TMP_DIR = path.join(REPO_ROOT, ".tmp/first-touch-radar");
const CACHE_DIR = path.join(RADAR_TMP_DIR, "cache");
const CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_GB = 20;
const MAX_BQ_ROWS = 50_000;
const MAX_BQ_PAGE_SIZE = 10_000;
const MAX_BQ_RESULT_BYTES = 20 * 1024 * 1024;
const MAX_POSTGRES_ROWS = 50_000;
const MAX_POSTGRES_RESULT_BYTES = 20 * 1024 * 1024;

export type BqParameterType =
  | "STRING"
  | "DATE"
  | "TIMESTAMP"
  | "INT64"
  | "FLOAT64"
  | "BOOL";

export interface BqParameter {
  name: string;
  type: BqParameterType;
  value: string | number | boolean;
}

export interface RadarJsonbParameter {
  readonly __radarJsonbParameter: true;
  readonly value: postgres.JSONValue;
}

export function radarJsonbParam(
  value: postgres.JSONValue,
): RadarJsonbParameter {
  return { __radarJsonbParameter: true, value };
}

export function bindRadarPostgresParams(
  params: readonly unknown[],
  json: (value: postgres.JSONValue) => unknown,
): unknown[] {
  return params.map((param) =>
    isRadarJsonbParameter(param) ? json(param.value) : param,
  );
}

function isRadarJsonbParameter(value: unknown): value is RadarJsonbParameter {
  return (
    typeof value === "object" &&
    value !== null &&
    "__radarJsonbParameter" in value &&
    value.__radarJsonbParameter === true
  );
}

export interface RadarQueryResult {
  rows: Record<string, unknown>[];
  bytesProcessed: number | null;
  cacheHit: boolean;
}

export class RadarQueryError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message);
    this.name = "RadarQueryError";
  }
}

interface EnvConfig {
  values: Record<string, string | undefined>;
  encryptionMaterials: Set<string>;
}

interface BigQueryServiceAccount {
  private_key: string;
  client_email: string;
  project_id?: string;
}

interface BqField {
  name: string;
  type?: string;
  mode?: string;
  fields?: BqField[];
}

interface BqCell {
  v?: unknown;
}

interface BqRow {
  f?: BqCell[];
}

interface BqPayload extends Record<string, unknown> {
  error?: unknown;
  status?: { errorResult?: unknown };
  totalBytesProcessed?: string | number;
  jobReference?: { jobId?: string; location?: string };
  schema?: { fields?: BqField[] };
  rows?: BqRow[];
  pageToken?: string;
  jobComplete?: boolean;
}

let loadedEnv: EnvConfig | undefined;
let loadedOrganizationId: string | undefined;
let loadedFirstPartyBackend:
  | { sink: "postgres" | "dual" | "bigquery"; table: string | null }
  | undefined;
let pgClient: ReturnType<typeof postgres> | undefined;
let bqAuth: { token: string; project: string; expiresAt: number } | undefined;

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  if (index < 0 || index >= items.length) return undefined;
  return items[index];
}

function stringAt(value: string, index: number): string | undefined {
  if (index < 0 || index >= value.length) return undefined;
  return value[index];
}

function configuredProjectId(
  values: Record<string, string | undefined>,
  serviceAccount: BigQueryServiceAccount,
): string | undefined {
  const configured = values["BIGQUERY_PROJECT_ID"];
  if (typeof configured === "string") return configured;
  const analyticsConfigured = values["ANALYTICS_BIGQUERY_PROJECT_ID"];
  if (typeof analyticsConfigured === "string") return analyticsConfigured;
  return serviceAccount.project_id;
}

export function isLocalDatabaseUrl(value: string): boolean {
  if (/^(pglite|file|sqlite):/i.test(value)) return true;
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (!authority) return false;
  const hostname = authority
    .slice(authority.lastIndexOf("@") + 1)
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function loadEnv(): EnvConfig {
  if (loadedEnv) return loadedEnv;

  const templateDir = path.join(REPO_ROOT, "templates/analytics");
  const override = process.env.ANALYTICS_ENV;
  const files = override
    ? [
        override,
        ...(override.endsWith(".env")
          ? [override.replace(/\.env$/, ".env.local")]
          : []),
      ]
    : [path.join(templateDir, ".env"), path.join(templateDir, ".env.local")];
  const values: Record<string, string | undefined> = {};
  const encryptionMaterials = new Set<string>();

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf8");
    } catch {
      throw new RadarQueryError("Analytics environment file is unreadable.", 2);
    }

    for (const [key, value] of Object.entries(dotenv.parse(contents))) {
      if (
        key === "DATABASE_URL" &&
        values.DATABASE_URL &&
        !isLocalDatabaseUrl(values.DATABASE_URL) &&
        isLocalDatabaseUrl(value)
      ) {
        continue;
      }
      values[key] = value;
    }
    for (const match of contents.matchAll(/^#\s*([A-Z0-9_]+)=(.*)$/gm)) {
      const key = itemAt(match, 1);
      const raw = itemAt(match, 2);
      if (key === undefined || raw === undefined) continue;
      if (!isEncryptionKey(key)) continue;
      const value = raw.trim().replace(/^["']|["']$/g, "");
      if (value) encryptionMaterials.add(value);
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      key === "DATABASE_URL" &&
      values.DATABASE_URL &&
      !isLocalDatabaseUrl(values.DATABASE_URL) &&
      isLocalDatabaseUrl(value)
    ) {
      continue;
    }
    values[key] = value;
  }
  for (const [key, value] of Object.entries(values)) {
    if (isEncryptionKey(key) && value) encryptionMaterials.add(value);
    if (key === "A2A_SECRET" && value) {
      encryptionMaterials.add(value);
      encryptionMaterials.add(
        crypto
          .createHmac("sha256", value)
          .update("agent-native:derived-secret:v1:secrets-encryption")
          .digest("hex"),
      );
    }
  }

  loadedEnv = { values, encryptionMaterials };
  return loadedEnv;
}

function isEncryptionKey(key: string): boolean {
  return /^(SECRETS_ENCRYPTION_KEY|BETTER_AUTH_SECRET|[A-Z0-9_]*SECRETS_ENCRYPTION_KEY(_PREVIOUS)?)$/.test(
    key,
  );
}

function getPostgres(): ReturnType<typeof postgres> {
  if (pgClient) return pgClient;
  const configured = process.env.ANALYTICS_RADAR_DATABASE_URL;
  const databaseUrl = configured ?? loadEnv().values.DATABASE_URL;
  if (!databaseUrl) {
    throw new RadarQueryError(
      "Analytics DATABASE_URL is missing from the environment.",
      2,
    );
  }
  if (!configured && isLocalDatabaseUrl(databaseUrl)) {
    throw new RadarQueryError(
      "Radar requires a remote PostgreSQL URL; set ANALYTICS_RADAR_DATABASE_URL for an explicit local override.",
      2,
    );
  }
  pgClient = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 20,
    prepare: false,
  });
  return pgClient;
}

export function isReadOnlySql(sql: string): boolean {
  const tokens: string[] = [];
  let statementEnded = false;
  for (let index = 0; index < sql.length; ) {
    const char = stringAt(sql, index);
    if (char === undefined) return false;
    const next = sql[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (sql[index] === "*" && sql[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else index += 1;
      }
      if (depth !== 0) return false;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      if (statementEnded) return false;
      const quote = char;
      const escapeBackslashes =
        quote === "'" &&
        /^[eE]$/.test(sql[index - 1] ?? "") &&
        !/[A-Za-z0-9_$]/.test(sql[index - 2] ?? "");
      index += 1;
      let closed = false;
      let quotedIdentifier = "";
      while (index < sql.length) {
        if (escapeBackslashes && sql[index] === "\\") {
          index += 2;
        } else if (sql[index] === quote && sql[index + 1] === quote) {
          if (quote === '"') quotedIdentifier += quote;
          index += 2;
        } else if (sql[index] === quote) {
          index += 1;
          closed = true;
          break;
        } else {
          if (quote === '"') quotedIdentifier += sql[index];
          index += 1;
        }
      }
      if (!closed) return false;
      tokens.push(
        quote === '"'
          ? `<identifier:${quotedIdentifier.toLowerCase()}>`
          : "<quoted>",
      );
      continue;
    }
    if (char === "$") {
      const delimiter = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        sql.slice(index),
      )?.[0];
      if (delimiter) {
        if (statementEnded) return false;
        const end = sql.indexOf(delimiter, index + delimiter.length);
        if (end < 0) return false;
        index = end + delimiter.length;
        tokens.push("<quoted>");
        continue;
      }
    }
    if (char === ";") {
      if (statementEnded) return false;
      statementEnded = true;
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      if (statementEnded) return false;
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index));
      if (!match) return false;
      tokens.push(match[0].toLowerCase());
      index += match[0].length;
      continue;
    }
    if (statementEnded) return false;
    tokens.push(char);
    index += 1;
  }

  const firstKeyword = tokens[0];
  if (firstKeyword !== "select" && firstKeyword !== "with") return false;
  const forbidden = new Set([
    "insert",
    "update",
    "delete",
    "merge",
    "drop",
    "create",
    "alter",
    "truncate",
    "grant",
    "revoke",
    "call",
    "copy",
    "set",
    "reset",
    "into",
    "vacuum",
    "analyze",
    "refresh",
    "do",
    "begin",
    "commit",
    "rollback",
    "savepoint",
    "release",
    "start",
    "prepare",
    "execute",
    "explain",
    "discard",
    "listen",
    "notify",
    "unlisten",
    "lock",
  ]);
  const forbiddenFunctions = new Set([
    "pg_sleep",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "pg_stat_file",
    "lo_import",
    "lo_export",
    "dblink_exec",
    "dblink",
    "dblink_connect",
    "dblink_connect_u",
    "dblink_open",
    "dblink_fetch",
    "dblink_close",
    "set_config",
    "pg_notify",
    "pg_advisory_lock",
    "pg_try_advisory_lock",
    "pg_advisory_unlock",
    "pg_try_advisory_unlock",
    "pg_advisory_lock_shared",
    "pg_try_advisory_lock_shared",
    "pg_advisory_unlock_shared",
    "pg_try_advisory_unlock_shared",
    "pg_advisory_xact_lock",
    "pg_advisory_xact_lock_shared",
    "pg_advisory_unlock_all",
    "nextval",
    "setval",
    "pg_reload_conf",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_logical_emit_message",
    "pg_replication_origin_advance",
    "pg_rotate_logfile",
    "pg_create_restore_point",
    "pg_switch_wal",
    "pg_stat_reset",
    "pg_stat_reset_shared",
    "pg_stat_reset_single_table_counters",
    "pg_stat_reset_single_function_counters",
  ]);
  return !tokens.some((token, index) => {
    const quotedIdentifier = token.startsWith("<identifier:")
      ? token.slice("<identifier:".length, -1)
      : undefined;
    const keyword = quotedIdentifier === undefined ? token : "";
    const functionName = quotedIdentifier ?? token;
    return (
      forbidden.has(keyword) ||
      (forbiddenFunctions.has(functionName) && tokens[index + 1] === "(")
    );
  });
}

function queryKey(source: string, sql: string, params: unknown[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([source, sql, params]))
    .digest("hex");
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

export function ensurePrivateRadarCacheDirectory(repoRoot = REPO_ROOT): string {
  const repoTmpDir = path.join(repoRoot, ".tmp");
  const radarTmpDir = path.join(repoTmpDir, "first-touch-radar");
  const cacheDir = path.join(radarTmpDir, "cache");
  const uid = process.getuid?.();

  try {
    for (const directory of [repoTmpDir, radarTmpDir, cacheDir]) {
      try {
        fs.mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        ) {
          throw error;
        }
      }
      let info = fs.lstatSync(directory);
      if (
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        (uid !== undefined && info.uid !== uid)
      ) {
        throw new RadarQueryError(
          "Radar cache path is not a trusted directory.",
          2,
        );
      }
      if (directory === repoTmpDir) {
        if (info.mode & 0o022) {
          throw new RadarQueryError(
            "Radar cache parent is writable by other users.",
            2,
          );
        }
      } else {
        fs.chmodSync(directory, 0o700);
        info = fs.lstatSync(directory);
        if ((info.mode & 0o777) !== 0o700) {
          throw new RadarQueryError(
            "Radar cache directory permissions could not be secured.",
            2,
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof RadarQueryError) throw error;
    throw new RadarQueryError("Radar cache directory is unavailable.", 2);
  }

  return cacheDir;
}

function prepareCacheDirectory(): void {
  ensurePrivateRadarCacheDirectory();
}

function readCache(key: string, ttlMs: number): RadarQueryResult | undefined {
  prepareCacheDirectory();
  const file = cachePath(key);
  const uid = process.getuid?.();
  try {
    const fileStat = fs.lstatSync(file);
    if (
      fileStat.isSymbolicLink() ||
      !fileStat.isFile() ||
      fileStat.nlink !== 1 ||
      (uid !== undefined && fileStat.uid !== uid)
    ) {
      throw new RadarQueryError("Radar cache file is not a trusted file.", 2);
    }
    if ((fileStat.mode & 0o777) !== 0o600) {
      fs.chmodSync(file, 0o600);
      const secured = fs.lstatSync(file);
      if ((secured.mode & 0o777) !== 0o600) {
        throw new RadarQueryError(
          "Radar cache file permissions could not be secured.",
          2,
        );
      }
    }
    if (fileStat.size > MAX_BQ_RESULT_BYTES * 2) return undefined;
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cachedAt: number;
      bytesProcessed: number | null;
      rows: Record<string, unknown>[];
    };
    if (Date.now() - cached.cachedAt > ttlMs) return undefined;
    if (!Array.isArray(cached.rows) || cached.rows.length > MAX_BQ_ROWS) {
      return undefined;
    }
    let cachedResultBytes = 0;
    for (const row of cached.rows) {
      const serialized = JSON.stringify(row);
      if (typeof serialized !== "string") return undefined;
      cachedResultBytes += Buffer.byteLength(serialized, "utf8");
      if (cachedResultBytes > MAX_BQ_RESULT_BYTES) return undefined;
    }
    return {
      rows: cached.rows,
      bytesProcessed: cached.bytesProcessed,
      cacheHit: true,
    };
  } catch (error) {
    if (error instanceof RadarQueryError) throw error;
    return undefined;
  }
}

function writeCache(key: string, result: RadarQueryResult): void {
  prepareCacheDirectory();
  const file = cachePath(key);
  const uid = process.getuid?.();
  try {
    const existing = fs.lstatSync(file);
    if (
      existing.isSymbolicLink() ||
      !existing.isFile() ||
      existing.nlink !== 1 ||
      (uid !== undefined && existing.uid !== uid)
    ) {
      throw new RadarQueryError("Radar cache file is not a regular file.", 2);
    }
  } catch (error) {
    if (error instanceof RadarQueryError) throw error;
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(
      fd,
      JSON.stringify({
        cachedAt: Date.now(),
        bytesProcessed: result.bytesProcessed,
        rows: result.rows,
      }),
    );
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}

function requireReadOnly(sql: string): void {
  if (!isReadOnlySql(sql)) {
    throw new RadarQueryError(
      "Only one read-only SELECT/WITH query is allowed.",
      2,
    );
  }
}

export async function runPostgresQuery(
  query: string,
  params: readonly unknown[] = [],
  options: { fresh?: boolean; cache?: boolean; cacheTtlMs?: number } = {},
): Promise<RadarQueryResult> {
  requireReadOnly(query);
  const db = getPostgres();
  const key = queryKey("postgres", query, [...params]);
  const boundParams = bindRadarPostgresParams(params, (value) =>
    db.json(value),
  );
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled && !options.fresh) {
    const cached = readCache(key, options.cacheTtlMs ?? CACHE_TTL_MS);
    if (cached) {
      return {
        ...cached,
        rows: await collectPostgresRows(
          (async function* () {
            yield cached.rows;
          })(),
        ),
      };
    }
  }

  try {
    const rows = await db.begin("read only", async (tx) => {
      await tx.unsafe("SET LOCAL statement_timeout = '120s'");
      return collectPostgresRows(
        tx.unsafe(query, boundParams as never[]).cursor(1),
      );
    });
    const result: RadarQueryResult = {
      rows: rows as Record<string, unknown>[],
      bytesProcessed: null,
      cacheHit: false,
    };
    if (cacheEnabled) writeCache(key, result);
    return result;
  } catch (error) {
    if (error instanceof RadarQueryError) throw error;
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown";
    const position =
      error && typeof error === "object" && "position" in error
        ? String(error.position)
        : "";
    const routine =
      error && typeof error === "object" && "routine" in error
        ? String(error.routine)
        : "";
    const positionLocation = /^\d+$/.test(position)
      ? " at SQL position " + position
      : "";
    const routineLocation = /^[A-Za-z0-9_]+$/.test(routine)
      ? " in " + routine
      : "";
    throw new RadarQueryError(
      `PostgreSQL query failed (${code}${routineLocation}${positionLocation}).`,
      1,
    );
  }
}

export async function collectPostgresRows(
  batches: AsyncIterable<readonly Record<string, unknown>[]>,
  limits: { maxRows?: number; maxBytes?: number } = {},
): Promise<Record<string, unknown>[]> {
  const maxRows = limits.maxRows ?? MAX_POSTGRES_ROWS;
  const maxBytes = limits.maxBytes ?? MAX_POSTGRES_RESULT_BYTES;
  const rows: Record<string, unknown>[] = [];
  let resultBytes = 0;

  for await (const batch of batches) {
    for (const row of batch) {
      let rowBytes: number;
      try {
        const serialized = JSON.stringify(row);
        if (typeof serialized !== "string") throw new TypeError();
        rowBytes = Buffer.byteLength(serialized, "utf8");
      } catch {
        throw new RadarQueryError(
          "PostgreSQL returned a row that cannot be measured safely.",
          1,
        );
      }
      if (rows.length >= maxRows || resultBytes + rowBytes > maxBytes) {
        throw new RadarQueryError(
          `PostgreSQL result exceeded the ${maxRows}-row or ${Math.floor(maxBytes / (1024 * 1024))}-MiB safety cap; aggregate in SQL.`,
          1,
        );
      }
      rows.push(row);
      resultBytes += rowBytes;
    }
  }
  return rows;
}

function parseMaxGb(value: number | undefined): number {
  const maxGb = value ?? DEFAULT_MAX_GB;
  if (!Number.isFinite(maxGb) || maxGb <= 0) {
    throw new RadarQueryError("--max-gb must be a positive number.", 2);
  }
  return maxGb;
}

function secretHash(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest();
}

function decryptSecret(value: string, materials: Set<string>): string | null {
  if (!/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value)) return value;
  const parts = value.split(":");
  const iv = itemAt(parts, 1);
  const ciphertext = itemAt(parts, 2);
  const tag = itemAt(parts, 3);
  if (iv === undefined || ciphertext === undefined || tag === undefined) {
    return null;
  }
  for (const material of materials) {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        secretHash(material),
        Buffer.from(iv, "hex"),
      );
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "hex")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // coercion-ok: a failed key authentication tries the remaining rotation keys; null reports if all fail.
      // Try the next configured key without exposing ciphertext or key material.
    }
  }
  return null;
}

export async function resolveRadarOrganizationId(): Promise<string> {
  if (loadedOrganizationId) return loadedOrganizationId;
  const configured = loadEnv().values.ANALYTICS_RADAR_ORG_ID;
  if (configured) {
    loadedOrganizationId = configured;
    return configured;
  }

  const domain = loadEnv().values.ANALYTICS_RADAR_ORG_DOMAIN ?? "builder.io";
  const { rows } = await runPostgresQuery(
    "SELECT id FROM organizations WHERE lower(allowed_domain) = lower($1)",
    [domain],
    { cache: false },
  );
  if (rows.length !== 1 || typeof rows[0]?.id !== "string") {
    throw new RadarQueryError(
      "Could not resolve one Analytics organization for the configured domain.",
      2,
    );
  }
  loadedOrganizationId = rows[0].id;
  return loadedOrganizationId;
}

export async function resolveRadarFirstPartyBackend(): Promise<{
  sink: "postgres" | "dual" | "bigquery";
  table: string | null;
}> {
  if (loadedFirstPartyBackend) return loadedFirstPartyBackend;
  const orgId = await resolveRadarOrganizationId();
  const { rows } = await runPostgresQuery(
    "SELECT value FROM settings WHERE key = $1",
    [`o:${orgId}:first-party-analytics-backend`],
    { cache: false },
  );
  if (rows.length > 1) {
    throw new RadarQueryError(
      "Analytics first-party backend setting is ambiguous.",
      2,
    );
  }
  if (rows.length === 0) {
    loadedFirstPartyBackend = { sink: "postgres", table: null };
    return loadedFirstPartyBackend;
  }

  let value: unknown = rows[0]?.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new RadarQueryError(
        "Analytics first-party backend setting is unreadable.",
        2,
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RadarQueryError(
      "Analytics first-party backend setting is unreadable.",
      2,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.sink !== "postgres" &&
    record.sink !== "dual" &&
    record.sink !== "bigquery"
  ) {
    throw new RadarQueryError(
      "Analytics first-party backend setting is unrecognized.",
      2,
    );
  }
  loadedFirstPartyBackend = {
    sink: record.sink,
    table: typeof record.table === "string" ? record.table : null,
  };
  return loadedFirstPartyBackend;
}

export function parseRadarBigQueryTableParts(
  configured: string | null | undefined,
): string[] {
  const raw = configured?.trim().replace(/^`|`$/g, "");
  const parts = raw ? raw.split(".") : [];
  if (
    parts.length !== 0 &&
    ((parts.length !== 2 && parts.length !== 3) ||
      parts.some((part) => part.length === 0))
  ) {
    throw new RadarQueryError(
      "Analytics first-party BigQuery table reference is invalid.",
      2,
    );
  }
  return parts;
}

export async function resolveRadarBigQueryEventsTable(): Promise<string> {
  const backend = await resolveRadarFirstPartyBackend();
  const parts = parseRadarBigQueryTableParts(backend.table);
  const { project } = await getBigQueryAuth();
  let projectId = project;
  let datasetId = "analytics";
  let tableId = "first_party_analytics_events_raw";
  if (parts.length === 3) {
    const configuredProject = itemAt(parts, 0);
    const configuredDataset = itemAt(parts, 1);
    const configuredTable = itemAt(parts, 2);
    if (
      configuredProject === undefined ||
      configuredDataset === undefined ||
      configuredTable === undefined
    ) {
      throw new RadarQueryError(
        "Analytics first-party BigQuery table reference is invalid.",
        2,
      );
    }
    projectId = configuredProject;
    datasetId = configuredDataset;
    tableId = configuredTable;
  } else if (parts.length === 2) {
    const configuredDataset = itemAt(parts, 0);
    const configuredTable = itemAt(parts, 1);
    if (configuredDataset === undefined || configuredTable === undefined) {
      throw new RadarQueryError(
        "Analytics first-party BigQuery table reference is invalid.",
        2,
      );
    }
    datasetId = configuredDataset;
    tableId = configuredTable;
  }
  if (
    !/^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/.test(projectId) ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(datasetId) ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableId)
  ) {
    throw new RadarQueryError(
      "Analytics first-party BigQuery table reference is invalid.",
      2,
    );
  }
  return `\`${projectId}.${datasetId}.${tableId}_query_range\``;
}

interface LoadedCredentials {
  values: Record<string, string | undefined>;
  unreadable: number;
}

const BIGQUERY_KEY = /(BIGQUERY|GOOGLE_APPLICATION_CREDENTIALS|GCP_)/i;

async function loadBigQueryCredentials(): Promise<LoadedCredentials> {
  const orgId = await resolveRadarOrganizationId();
  const { rows: secretRows } = await runPostgresQuery(
    `SELECT key, encrypted_value, shared_encrypted_value
       FROM app_secrets
      WHERE scope IN ('org', 'workspace')
        AND scope_id = $1
        AND (key ILIKE '%BIGQUERY%'
          OR key ILIKE 'GOOGLE_APPLICATION_CREDENTIALS%'
          OR key ILIKE 'GCP_%')`,
    [orgId],
    { cache: false },
  );
  const out: Record<string, string> = {};
  let unreadable = 0;
  const materials = loadEnv().encryptionMaterials;

  for (const row of secretRows) {
    const key = String(row.key ?? "");
    const candidates = [row.encrypted_value, row.shared_encrypted_value].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    for (const candidate of candidates) {
      const value = decryptSecret(candidate, materials);
      if (value == null) {
        unreadable += 1;
        continue;
      }
      out[key] = value;
      break;
    }
  }

  const { rows: settingRows } = await runPostgresQuery(
    "SELECT key, value FROM settings WHERE key LIKE $1",
    [`o:${orgId}:credential:%`],
    { cache: false },
  );
  for (const row of settingRows) {
    const key = String(row.key ?? "").replace(/^o:.*?:credential:/, "");
    if (!BIGQUERY_KEY.test(key) || out[key]) continue;
    try {
      const stored = JSON.parse(String(row.value ?? "")) as { value?: unknown };
      if (typeof stored.value !== "string") continue;
      const value = decryptSecret(stored.value, materials);
      if (value == null) unreadable += 1;
      else out[key] = value;
    } catch {
      unreadable += 1;
    }
  }

  return { values: out, unreadable };
}

function decodeServiceAccount(
  value: string,
): BigQueryServiceAccount | undefined {
  const candidates = [value];
  candidates.push(Buffer.from(value, "base64").toString("utf8"));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as Record<string, unknown>;
      if (
        typeof parsed.private_key === "string" &&
        typeof parsed.client_email === "string"
      ) {
        return {
          private_key: parsed.private_key,
          client_email: parsed.client_email,
          ...(typeof parsed.project_id === "string"
            ? { project_id: parsed.project_id }
            : {}),
        };
      }
    } catch {
      // coercion-ok: malformed candidates are skipped; getBigQueryAuth fails if no credential validates.
      // Try the next encoding without exposing the credential value.
    }
  }
  return undefined;
}

async function getBigQueryAuth(): Promise<{ token: string; project: string }> {
  if (bqAuth && bqAuth.expiresAt > Date.now() + 60_000) {
    return { token: bqAuth.token, project: bqAuth.project };
  }
  const { values, unreadable } = await loadBigQueryCredentials();
  const serviceAccount = Object.values(values)
    .filter((value): value is string => value !== undefined)
    .map(decodeServiceAccount)
    .find((value) => value !== undefined);
  if (!serviceAccount) {
    throw new RadarQueryError(
      unreadable
        ? "A BigQuery vault credential exists but could not be decrypted with the local key material."
        : "No BigQuery service-account credential is available in the Analytics organization vault.",
      2,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const base64Url = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${base64Url({ alg: "RS256", typ: "JWT" })}.${base64Url({
    iss: serviceAccount.client_email,
    scope:
      "https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/cloud-platform.read-only",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key, "base64url");

  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });
  } catch {
    throw new RadarQueryError("BigQuery authentication request failed.", 1);
  }
  if (!response.ok) {
    throw new RadarQueryError(
      `BigQuery authentication failed (HTTP ${response.status}).`,
      1,
    );
  }
  const tokenResponse = (await response.json()) as {
    access_token?: string;
  };
  if (!tokenResponse.access_token) {
    throw new RadarQueryError("BigQuery authentication returned no token.", 1);
  }

  const project = configuredProjectId(values, serviceAccount);
  if (!project) {
    throw new RadarQueryError("BigQuery project id is not configured.", 2);
  }
  bqAuth = {
    token: tokenResponse.access_token,
    project,
    expiresAt: Date.now() + 3_500_000,
  };
  return { token: bqAuth.token, project: bqAuth.project };
}

function encodeParameters(params: readonly BqParameter[] = []) {
  return params.map((parameter) => ({
    name: parameter.name,
    parameterType: { type: parameter.type },
    parameterValue: { value: String(parameter.value) },
  }));
}

export async function bqRequest(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<BqPayload> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new RadarQueryError("BigQuery request failed or timed out.", 1);
  }
  if (!response.ok) {
    throw new RadarQueryError(
      `BigQuery request failed (HTTP ${response.status}).`,
      1,
    );
  }
  const payload = (await response.json()) as BqPayload;
  if (payload.error) {
    throw new RadarQueryError("BigQuery rejected the read-only query.", 1);
  }
  if (payload.status?.errorResult) {
    throw new RadarQueryError("BigQuery query job completed with an error.", 1);
  }
  return payload;
}

export function parseBigQueryTimestamp(value: unknown): string {
  const source =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const seconds = Number(source);
  const date = Number.isFinite(seconds)
    ? new Date(seconds * 1000)
    : new Date(source);
  if (!source || !Number.isFinite(date.getTime())) {
    throw new RadarQueryError(
      "BigQuery returned a malformed timestamp value.",
      1,
    );
  }
  return date.toISOString();
}

function convertBigQueryValue(field: BqField, value: unknown): unknown {
  if (value == null) return null;
  if (field.mode === "REPEATED") {
    if (!Array.isArray(value)) {
      throw new RadarQueryError(
        "BigQuery returned a malformed repeated value.",
        1,
      );
    }
    return value.map((item) =>
      convertBigQueryValue({ ...field, mode: "NULLABLE" }, (item as BqCell).v),
    );
  }
  if (field.type === "RECORD") {
    const cells = (value as { f?: BqCell[] }).f;
    if (!Array.isArray(cells) || !field.fields) {
      throw new RadarQueryError(
        "BigQuery returned a malformed record value.",
        1,
      );
    }
    return Object.fromEntries(
      field.fields.map((child, index) => [
        child.name,
        convertBigQueryValue(child, cells[index]?.v),
      ]),
    );
  }
  if (
    ["INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC"].includes(
      field.type ?? "",
    )
  ) {
    return Number(value);
  }
  if (field.type === "BOOLEAN" || field.type === "BOOL")
    return value === "true";
  if (field.type === "TIMESTAMP") return parseBigQueryTimestamp(value);
  return value;
}

function convertBigQueryRows(
  fields: BqField[],
  rows: BqRow[] = [],
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      fields.map((field, index) => [
        field.name,
        convertBigQueryValue(field, row.f?.[index]?.v),
      ]),
    ),
  );
}

export interface BigQueryRowsAccumulator {
  rows: Record<string, unknown>[];
  bytes: number;
}

function appendBigQueryPayloadRows(
  accumulator: BigQueryRowsAccumulator,
  fields: BqField[],
  rows: BqRow[],
): void {
  for (const row of rows) {
    appendBigQueryRows(accumulator, convertBigQueryRows(fields, [row]));
  }
}

export function appendBigQueryRows(
  accumulator: BigQueryRowsAccumulator,
  rows: readonly Record<string, unknown>[],
  limits: { maxRows?: number; maxBytes?: number } = {},
): void {
  const maxRows = limits.maxRows ?? MAX_BQ_ROWS;
  const maxBytes = limits.maxBytes ?? MAX_BQ_RESULT_BYTES;
  for (const row of rows) {
    let rowBytes: number;
    try {
      const serialized = JSON.stringify(row);
      if (typeof serialized !== "string") throw new TypeError();
      rowBytes = Buffer.byteLength(serialized, "utf8");
    } catch {
      throw new RadarQueryError(
        "BigQuery returned a row that cannot be measured safely.",
        1,
      );
    }
    if (
      accumulator.rows.length >= maxRows ||
      accumulator.bytes + rowBytes > maxBytes
    ) {
      throw new RadarQueryError(
        `BigQuery result exceeded the ${maxRows}-row or ${Math.floor(maxBytes / (1024 * 1024))}-MiB safety cap; aggregate in SQL.`,
        1,
      );
    }
    accumulator.rows.push(row);
    accumulator.bytes += rowBytes;
  }
}

export async function runBigQuery(
  query: string,
  options: {
    maxGb?: number;
    params?: readonly BqParameter[];
    fresh?: boolean;
    cache?: boolean;
    cacheTtlMs?: number;
  } = {},
): Promise<RadarQueryResult> {
  requireReadOnly(query);
  const maxGb = parseMaxGb(options.maxGb);
  const { token, project } = await getBigQueryAuth();
  const params = options.params ?? [];
  const key = queryKey("bigquery", query, [...params]);
  const baseUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}`;
  const postUrl = `${baseUrl}/queries`;
  const payload = {
    query,
    useLegacySql: false,
    timeoutMs: 10_000,
    parameterMode: params.length ? "NAMED" : undefined,
    queryParameters: params.length ? encodeParameters(params) : undefined,
  };
  const dryRun = await bqRequest(postUrl, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, dryRun: true }),
  });
  const bytesProcessed = Number(dryRun.totalBytesProcessed ?? 0);
  const maxBytes = maxGb * 1_000_000_000;
  if (bytesProcessed > maxBytes) {
    throw new RadarQueryError(
      `BigQuery dry run is ${(bytesProcessed / 1_000_000_000).toFixed(2)} GB, above --max-gb ${maxGb}.`,
      2,
    );
  }

  const cacheEnabled = options.cache !== false;
  if (cacheEnabled && !options.fresh) {
    const cached = readCache(key, options.cacheTtlMs ?? CACHE_TTL_MS);
    if (cached) {
      if (cached.bytesProcessed !== bytesProcessed) {
        cached.bytesProcessed = bytesProcessed;
        writeCache(key, cached);
      }
      return cached;
    }
  }

  const startedAt = Date.now();
  const first = await bqRequest(postUrl, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      maximumBytesBilled: Math.floor(maxBytes),
      maxResults: MAX_BQ_PAGE_SIZE,
    }),
  });
  const jobId = first.jobReference?.jobId;
  if (!jobId) {
    throw new RadarQueryError("BigQuery did not return a query job id.", 1);
  }

  const fields = first.schema?.fields ?? [];
  const accumulator: BigQueryRowsAccumulator = { rows: [], bytes: 0 };
  appendBigQueryPayloadRows(accumulator, fields, first.rows ?? []);
  const rows = accumulator.rows;
  let pageToken = first.pageToken as string | undefined;
  let jobComplete = first.jobComplete === true;
  let location = first.jobReference?.location as string | undefined;

  while (!jobComplete || pageToken) {
    if (Date.now() - startedAt > 180_000) {
      throw new RadarQueryError(
        "BigQuery query did not finish within 180 seconds.",
        1,
      );
    }
    if (rows.length >= MAX_BQ_ROWS) {
      throw new RadarQueryError(
        `BigQuery result exceeded the ${MAX_BQ_ROWS}-row safety cap; aggregate in SQL.`,
        1,
      );
    }
    const queryParams = new URLSearchParams({
      maxResults: String(Math.min(MAX_BQ_PAGE_SIZE, MAX_BQ_ROWS - rows.length)),
      timeoutMs: "10000",
    });
    if (pageToken) queryParams.set("pageToken", pageToken);
    if (location) queryParams.set("location", location);
    const page = await bqRequest(
      `${baseUrl}/queries/${encodeURIComponent(jobId)}?${queryParams.toString()}`,
      token,
    );
    if (page.schema?.fields) {
      fields.splice(0, fields.length, ...page.schema.fields);
    }
    appendBigQueryPayloadRows(accumulator, fields, page.rows ?? []);
    pageToken = page.pageToken as string | undefined;
    jobComplete = page.jobComplete === true;
    location = page.jobReference?.location ?? location;
  }

  const result: RadarQueryResult = {
    rows,
    bytesProcessed,
    cacheHit: false,
  };
  if (cacheEnabled) writeCache(key, result);
  return result;
}

export async function closeRadarQueries(): Promise<void> {
  if (!pgClient) return;
  const client = pgClient;
  pgClient = undefined;
  await client.end({ timeout: 2 });
}

export function radarCliExitCode(error: unknown): 1 | 2 {
  return error instanceof RadarQueryError ? error.exitCode : 1;
}

export function radarRunCliExitCode(_error: unknown): 2 {
  return 2;
}

function parseCliArgs(args: string[]): {
  mode: string;
  query?: string;
  maxGb: number;
  fresh: boolean;
} {
  const mode = itemAt(args, 0);
  const query = itemAt(args, 1);
  const rest = args.slice(2);
  if (mode === undefined) {
    throw new RadarQueryError("Missing query helper mode.", 2);
  }
  let maxGb = DEFAULT_MAX_GB;
  let fresh = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--fresh") fresh = true;
    else if (arg === "--max-gb") {
      const value = Number(rest[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new RadarQueryError("--max-gb must be a positive number.", 2);
      }
      maxGb = value;
      index += 1;
    } else {
      throw new RadarQueryError("Unknown query helper option.", 2);
    }
  }
  return {
    mode,
    ...(query !== undefined ? { query } : {}),
    maxGb,
    fresh,
  };
}

async function main(): Promise<void> {
  try {
    const { mode, query, maxGb, fresh } = parseCliArgs(process.argv.slice(2));
    if (mode === "creds") {
      const { values, unreadable } = await loadBigQueryCredentials();
      console.log(JSON.stringify({ keys: Object.keys(values), unreadable }));
      return;
    }
    if ((mode !== "bq" && mode !== "pg") || !query) {
      throw new RadarQueryError(
        "Usage: query.ts bq|pg '<read-only SQL>' [--max-gb N] [--fresh] | query.ts creds",
        2,
      );
    }
    const result =
      mode === "bq"
        ? await runBigQuery(query, { maxGb, fresh, cache: false })
        : await runPostgresQuery(query, [], { fresh, cache: false });
    console.log(JSON.stringify(result.rows));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Radar query could not run.",
    );
    process.exitCode = radarCliExitCode(error);
  } finally {
    await closeRadarQueries();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
