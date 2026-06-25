/**
 * Custom provider registry — runtime storage and resolution.
 *
 * Lets apps register arbitrary HTTP API providers at runtime without touching
 * the static PROVIDER_CONFIGS list. Provider rows live in the
 * `custom_api_providers` SQL table (created on first use). Credentials
 * referenced in the provider row continue to live in the existing secrets /
 * credentials store — this table stores only key NAMES, never values.
 *
 * Scoping mirrors the `app_secrets` table: each row is scoped to a user
 * (by email) or an organisation (by orgId).
 *
 * Supported auth kinds for custom providers:
 *   - bearer         → Authorization: Bearer <credential>
 *   - basic          → Authorization: Basic base64(user:pass)
 *   - api-key-header → custom header: <credential>
 *
 * google-service-account and oauth-bearer are intentionally unsupported for
 * custom providers because they require additional out-of-band setup that
 * cannot be expressed in the simple header/key model.
 */

import { getDbExec, isPostgres } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { isBlockedExtensionUrlWithDns } from "../extensions/url-safety.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomProviderScope = "user" | "org";

export type CustomProviderAuthKind =
  | { type: "bearer"; credentialKey: string }
  | { type: "basic"; usernameKey: string; passwordKey: string }
  | { type: "api-key-header"; credentialKey: string; headerName: string }
  | { type: "none" };

export interface CustomProviderConfig {
  id: string;
  scope: CustomProviderScope;
  scopeId: string;
  label: string;
  baseUrl: string;
  auth: CustomProviderAuthKind;
  docsUrls: string[];
  allowedHostSuffixes: string[];
  defaultHeaders: Record<string, string>;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertCustomProviderArgs {
  scope: CustomProviderScope;
  scopeId: string;
  /** Slug used as the provider id (e.g. "my-api"). Must be lowercase, letters/digits/hyphens. */
  id: string;
  label: string;
  baseUrl: string;
  auth: CustomProviderAuthKind;
  docsUrls?: string[];
  allowedHostSuffixes?: string[];
  defaultHeaders?: Record<string, string>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Table bootstrap
// ---------------------------------------------------------------------------

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS custom_api_providers (
  id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_json TEXT NOT NULL,
  docs_urls_json TEXT NOT NULL,
  allowed_host_suffixes_json TEXT NOT NULL,
  default_headers_json TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, scope_id, id)
)`;

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();

      if (isPostgres()) {
        const pgSql = CREATE_SQL.replace(/\bINTEGER\b/g, "BIGINT");
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("custom_api_providers", pgSql);
        // Widen any pre-existing int4 timestamp columns to BIGINT (no-op once done)
        await widenIntColumnsToBigInt("custom_api_providers", [
          "created_at",
          "updated_at",
        ]);
        return;
      }
      // SQLite (local dev): keep existing behavior
      await client.execute(CREATE_SQL);
      // Fresh Postgres tables get BIGINT via the replace above, but tables
      // created before that compat existed kept int4 timestamp columns; widen
      // them so `Date.now()` writes don't overflow. No-op once done.
      await widenIntColumnsToBigInt("custom_api_providers", [
        "created_at",
        "updated_at",
      ]);
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Validate and normalise a custom provider base URL. Throws when the URL is
 * invalid, uses a non-http(s) scheme, or resolves to a private/internal host.
 */
export async function validateCustomBaseUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid base URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `Custom provider base URL must use https: or http: (got ${url.protocol})`,
    );
  }
  if (await isBlockedExtensionUrlWithDns(url.href)) {
    throw new Error(
      `Custom provider base URL resolves to a private/internal address — SSRF not allowed.`,
    );
  }
  return url;
}

function validateProviderId(id: string): void {
  if (!PROVIDER_ID_RE.test(id)) {
    throw new Error(
      `Custom provider id must be 1–64 lowercase letters, digits, or hyphens (got "${id}").`,
    );
  }
}

function validateAuth(auth: CustomProviderAuthKind): void {
  if (auth.type === "bearer") {
    if (!auth.credentialKey)
      throw new Error("bearer auth requires credentialKey");
  } else if (auth.type === "basic") {
    if (!auth.usernameKey || !auth.passwordKey)
      throw new Error("basic auth requires usernameKey and passwordKey");
  } else if (auth.type === "api-key-header") {
    if (!auth.credentialKey || !auth.headerName)
      throw new Error(
        "api-key-header auth requires credentialKey and headerName",
      );
    if (!HEADER_NAME_RE.test(auth.headerName)) {
      throw new Error(
        `Invalid header name for api-key-header auth: ${auth.headerName}`,
      );
    }
  }
}

/**
 * Public suffixes that must never be used as an allowed host suffix — a
 * suffix like "com" would attach the provider's credentials to requests for
 * any host under that TLD, creating a credential-exfiltration vector. Not an
 * exhaustive public-suffix list; combined with the structural checks below.
 */
const FORBIDDEN_HOST_SUFFIXES = new Set([
  "com",
  "net",
  "org",
  "io",
  "co",
  "dev",
  "app",
  "ai",
  "cloud",
  "info",
  "biz",
  "xyz",
  "me",
  "us",
  "uk",
  "eu",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "com.br",
  "com.cn",
  "co.in",
  "com.mx",
  "co.za",
  "github.io",
  "herokuapp.com",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
  "ngrok.io",
  "ngrok.app",
]);

const HOST_SUFFIX_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Validate user-supplied allowed host suffixes. Each suffix must look like a
 * real registrable domain (at least two labels) and must not be a bare TLD or
 * shared-hosting public suffix where unrelated parties control subdomains.
 */
export function validateAllowedHostSuffixes(suffixes: string[]): string[] {
  const normalized: string[] = [];
  for (const raw of suffixes) {
    const suffix = String(raw).trim().toLowerCase().replace(/^\.+/, "");
    if (!suffix) continue;
    if (!HOST_SUFFIX_RE.test(suffix)) {
      throw new Error(
        `Invalid allowed host suffix "${raw}": must be a domain like "api.example.com" with at least two labels.`,
      );
    }
    if (FORBIDDEN_HOST_SUFFIXES.has(suffix)) {
      throw new Error(
        `Allowed host suffix "${raw}" is too broad: it would attach this provider's credentials to any host under a public suffix. Use the provider's own registrable domain (e.g. "example.com").`,
      );
    }
    normalized.push(suffix);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create or update a custom provider. Validates the base URL against SSRF
 * rules at write time. Returns the provider id.
 */
export async function upsertCustomProvider(
  args: UpsertCustomProviderArgs,
): Promise<string> {
  await ensureTable();
  validateProviderId(args.id);
  validateAuth(args.auth);
  const url = await validateCustomBaseUrl(args.baseUrl);
  const baseUrl = url.href.replace(/\/+$/, "");
  const allowedHostSuffixes = validateAllowedHostSuffixes(
    args.allowedHostSuffixes ?? [],
  );

  const now = Date.now();
  const client = getDbExec();

  const { rows } = await client.execute({
    sql: `SELECT created_at FROM custom_api_providers WHERE scope = ? AND scope_id = ? AND id = ?`,
    args: [args.scope, args.scopeId, args.id],
  });

  if (rows.length > 0) {
    await client.execute({
      sql: `UPDATE custom_api_providers SET label=?, base_url=?, auth_json=?, docs_urls_json=?, allowed_host_suffixes_json=?, default_headers_json=?, notes=?, updated_at=? WHERE scope=? AND scope_id=? AND id=?`,
      args: [
        args.label,
        baseUrl,
        JSON.stringify(args.auth),
        JSON.stringify(args.docsUrls ?? []),
        JSON.stringify(allowedHostSuffixes),
        JSON.stringify(args.defaultHeaders ?? {}),
        args.notes ?? "",
        now,
        args.scope,
        args.scopeId,
        args.id,
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO custom_api_providers (id, scope, scope_id, label, base_url, auth_json, docs_urls_json, allowed_host_suffixes_json, default_headers_json, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        args.id,
        args.scope,
        args.scopeId,
        args.label,
        baseUrl,
        JSON.stringify(args.auth),
        JSON.stringify(args.docsUrls ?? []),
        JSON.stringify(allowedHostSuffixes),
        JSON.stringify(args.defaultHeaders ?? {}),
        args.notes ?? "",
        now,
        now,
      ],
    });
  }

  return args.id;
}

/**
 * Delete a custom provider. Returns true if a row was deleted.
 */
export async function deleteCustomProvider(
  scope: CustomProviderScope,
  scopeId: string,
  id: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `DELETE FROM custom_api_providers WHERE scope=? AND scope_id=? AND id=?`,
    args: [scope, scopeId, id],
  });
  return rowsAffected > 0;
}

/**
 * List all custom providers visible to a given (scope, scopeId) pair.
 */
export async function listCustomProviders(
  scope: CustomProviderScope,
  scopeId: string,
): Promise<CustomProviderConfig[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, scope, scope_id, label, base_url, auth_json, docs_urls_json, allowed_host_suffixes_json, default_headers_json, notes, created_at, updated_at FROM custom_api_providers WHERE scope=? AND scope_id=? ORDER BY updated_at DESC`,
    args: [scope, scopeId],
  });
  return rows.map(rowToConfig);
}

/**
 * Look up one custom provider. Returns null when not found.
 */
export async function getCustomProvider(
  scope: CustomProviderScope,
  scopeId: string,
  id: string,
): Promise<CustomProviderConfig | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, scope, scope_id, label, base_url, auth_json, docs_urls_json, allowed_host_suffixes_json, default_headers_json, notes, created_at, updated_at FROM custom_api_providers WHERE scope=? AND scope_id=? AND id=? LIMIT 1`,
    args: [scope, scopeId, id],
  });
  if (rows.length === 0) return null;
  return rowToConfig(rows[0]);
}

function rowToConfig(row: Record<string, unknown>): CustomProviderConfig {
  return {
    id: row.id as string,
    scope: row.scope as CustomProviderScope,
    scopeId: row.scope_id as string,
    label: row.label as string,
    baseUrl: row.base_url as string,
    auth: JSON.parse(row.auth_json as string) as CustomProviderAuthKind,
    docsUrls: JSON.parse(row.docs_urls_json as string) as string[],
    allowedHostSuffixes: JSON.parse(
      row.allowed_host_suffixes_json as string,
    ) as string[],
    defaultHeaders: JSON.parse(row.default_headers_json as string) as Record<
      string,
      string
    >,
    notes: row.notes as string,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
