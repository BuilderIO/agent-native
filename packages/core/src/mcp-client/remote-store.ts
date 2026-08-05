/**
 * Persistent store for user-added remote MCP servers.
 *
 * Servers added through the settings UI live in the framework's `settings`
 * table, keyed by scope:
 *   - User scope: `u:<email>:mcp-servers-remote`
 *   - Org scope:  `o:<orgId>:mcp-servers-remote`
 *
 * Both scopes store the same shape — a list of `StoredRemoteMcpServer`
 * records. The running MCP manager merges this list with the file-based
 * `mcp.config.json` on startup and after every mutation.
 *
 * SECURITY: HTTP MCP servers commonly require a bearer token in the
 * `Authorization` header. Those values are written to the encrypted
 * `app_secrets` table (AES-256-GCM via writeAppSecret). The settings row
 * stores only the secret-key reference (`headerSecretKey`), not the raw
 * value. Callers retrieving headers must call `materializeHeaders` to
 * fetch the cleartext at request time. Legacy rows that wrote headers
 * cleartext into `headers` continue to work read-only — they should be
 * re-saved to migrate.
 */

import { createHash } from "node:crypto";

import type { SecretScope } from "../secrets/register.js";
import {
  writeAppSecret,
  readAppSecret,
  deleteAppSecret,
} from "../secrets/storage.js";
import {
  getOrgSetting,
  putOrgSetting,
  deleteOrgSetting,
} from "../settings/org-settings.js";
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import type { McpHttpServerConfig } from "./config.js";
import {
  deleteMcpOAuthCredentials,
  getMcpOAuthAccessToken,
  saveMcpOAuthCredentials,
  type McpOAuthCredentialBundle,
} from "./oauth-client.js";
import { validateRemoteUrl } from "./remote-url.js";

export { validateRemoteUrl } from "./remote-url.js";

const SETTINGS_KEY = "mcp-servers-remote";

export type RemoteMcpScope = "user" | "org";

function toSecretScope(scope: RemoteMcpScope): SecretScope {
  return scope === "user" ? "user" : "workspace";
}

export interface StoredRemoteMcpServer {
  /** Stable unique id — used for removal / URLs. */
  id: string;
  /** Human-readable name. Also used as the MCP server id (prefixed with scope). */
  name: string;
  /** Streamable HTTP MCP server URL. */
  url: string;
  /**
   * Optional non-secret headers to pass to the MCP server. SECURITY: secret
   * material (Authorization, X-Api-Key, …) is moved out of this field at
   * write time and stored encrypted in `app_secrets`; see
   * `headerSecretKey`. Legacy rows may still contain cleartext headers and
   * are honored read-only.
   */
  headers?: Record<string, string>;
  /**
   * Reference to the encrypted secret holding the JSON-stringified secret
   * headers map (e.g. `{"Authorization":"Bearer …"}`). Resolved at request
   * time via `readAppSecret`. Undefined when no secret-class headers were
   * supplied (or for legacy cleartext rows).
   */
  headerSecretKey?: string;
  /** Reference to the encrypted OAuth credential bundle for this server. */
  oauthSecretKey?: string;
  /**
   * Trusted first-party Agent-Native app. Only framework-controlled
   * registrations should set this; management routes intentionally do not
   * expose it for arbitrary user-added MCP servers.
   */
  firstParty?: boolean;
  /** Canonical first-party app id from the org directory, e.g. `assets`. */
  firstPartyAppId?: string;
  /** Optional description shown in the UI. */
  description?: string;
  /** ms since epoch. */
  createdAt: number;
}

/**
 * Header names that are routed through the encrypted-at-rest secrets store
 * instead of being written to the plaintext `settings` row. Match is
 * case-insensitive and substring-based to catch one-off names like
 * `x-zapier-api-key`.
 */
const SECRET_HEADER_NAME_PATTERNS = [
  /authorization/i,
  /api[-_]?key/i,
  /token/i,
  /secret/i,
  /bearer/i,
  /x-.*-key/i,
];

function isSecretHeaderName(name: string): boolean {
  return SECRET_HEADER_NAME_PATTERNS.some((re) => re.test(name));
}

/** Split a headers map into (cleartext, secret) buckets. */
function partitionHeaders(headers: Record<string, string> | undefined): {
  cleartext: Record<string, string> | undefined;
  secret: Record<string, string> | undefined;
} {
  if (!headers) return { cleartext: undefined, secret: undefined };
  const cleartext: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") continue;
    if (isSecretHeaderName(k)) secret[k] = v;
    else cleartext[k] = v;
  }
  return {
    cleartext: Object.keys(cleartext).length > 0 ? cleartext : undefined,
    secret: Object.keys(secret).length > 0 ? secret : undefined,
  };
}

/** Tiny nanoid — matches the inline helper used elsewhere in this package. */
function shortId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    Math.random().toString(36).slice(2) + Date.now().toString(36);
  return rand.slice(0, 16);
}

/**
 * Validate a candidate MCP server name — used as a key in the merged config
 * and as part of the prefixed tool name (`mcp__<merged-key>__<tool>`).
 *
 * Allowed: letters, digits, hyphen; 1–40 chars. Lowercased. Underscores are
 * excluded on purpose — the merged-key format uses `_` as a separator between
 * `<scope>`, `<owner>`, and `<name>`, so allowing `_` in names would make the
 * parse ambiguous.
 */
export function normalizeServerName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);
}

/**
 * Short, deterministic, URL-safe hash of an email. Used as the owner
 * discriminator in user-scope merged keys so two users with the same server
 * name don't collide in the global MCP manager.
 */
export function hashEmail(email: string): string {
  return createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 10);
}

/**
 * Sanitise an org id to the character set allowed in merged keys.
 * Org ids are already nanoid-style alphanumeric, but we normalise defensively.
 */
function sanitiseOrgId(orgId: string): string {
  return orgId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

async function readList(
  scope: RemoteMcpScope,
  scopeId: string,
): Promise<StoredRemoteMcpServer[]> {
  const raw =
    scope === "user"
      ? await getUserSetting(scopeId, SETTINGS_KEY)
      : await getOrgSetting(scopeId, SETTINGS_KEY);
  if (!raw || !Array.isArray((raw as any).servers)) return [];
  return ((raw as any).servers as StoredRemoteMcpServer[]).filter(
    (s) => s && typeof s.id === "string" && typeof s.url === "string",
  );
}

async function writeList(
  scope: RemoteMcpScope,
  scopeId: string,
  servers: StoredRemoteMcpServer[],
): Promise<void> {
  if (scope === "user") {
    await putUserSetting(scopeId, SETTINGS_KEY, { servers });
  } else {
    await putOrgSetting(scopeId, SETTINGS_KEY, { servers });
  }
}

export async function listRemoteServers(
  scope: RemoteMcpScope,
  scopeId: string,
): Promise<StoredRemoteMcpServer[]> {
  return readList(scope, scopeId);
}

export async function addRemoteServer(
  scope: RemoteMcpScope,
  scopeId: string,
  input: {
    name: string;
    url: string;
    headers?: Record<string, string>;
    description?: string;
    firstParty?: boolean;
  },
): Promise<
  { ok: true; server: StoredRemoteMcpServer } | { ok: false; error: string }
> {
  if (input.firstParty) {
    return {
      ok: false,
      error:
        "First-party MCP servers must be registered through the trusted first-party registration path",
    };
  }
  return addRemoteServerInternal(scope, scopeId, input);
}

/**
 * Persist a remote MCP server whose authorization is managed by the MCP
 * server's OAuth 2.1 metadata and token endpoints. OAuth credentials are
 * stored separately from the settings row and never returned to clients.
 */
export async function addOAuthRemoteServer(
  scope: RemoteMcpScope,
  scopeId: string,
  input: {
    name: string;
    url: string;
    description?: string;
    credentials: McpOAuthCredentialBundle;
  },
): Promise<
  { ok: true; server: StoredRemoteMcpServer } | { ok: false; error: string }
> {
  const oauthSecretKey = `mcp_oauth:${shortId()}`;
  try {
    await saveMcpOAuthCredentials({
      key: oauthSecretKey,
      scope,
      scopeId,
      credentials: input.credentials,
    });
    const result = await addRemoteServerInternal(scope, scopeId, {
      name: input.name,
      url: input.url,
      description: input.description,
      oauthSecretKey,
    });
    if (!result.ok) {
      await deleteMcpOAuthCredentials({
        key: oauthSecretKey,
        scope,
        scopeId,
      });
    }
    return result;
  } catch (err: any) {
    await deleteMcpOAuthCredentials({
      key: oauthSecretKey,
      scope,
      scopeId,
    }).catch(() => {});
    return {
      ok: false,
      error: `Failed to save MCP OAuth credentials: ${err?.message ?? err}`,
    };
  }
}

export async function addFirstPartyRemoteServer(
  orgId: string,
  input: {
    appId: string;
    name: string;
    url: string;
    description?: string;
  },
): Promise<
  { ok: true; server: StoredRemoteMcpServer } | { ok: false; error: string }
> {
  const trust = await isFirstPartyRemoteEndpointTrusted(
    orgId,
    input.appId,
    input.url,
  );
  if (!trust.ok) return { ok: false, error: trust.error };
  return addRemoteServerInternal("org", orgId, {
    name: input.name,
    url: input.url,
    description: input.description,
    firstParty: true,
    firstPartyAppId: input.appId.trim().toLowerCase(),
  });
}

async function addRemoteServerInternal(
  scope: RemoteMcpScope,
  scopeId: string,
  input: {
    name: string;
    url: string;
    headers?: Record<string, string>;
    description?: string;
    firstParty?: boolean;
    firstPartyAppId?: string;
    oauthSecretKey?: string;
  },
): Promise<
  { ok: true; server: StoredRemoteMcpServer } | { ok: false; error: string }
> {
  const name = normalizeServerName(input.name);
  if (!name) return { ok: false, error: "Name is required" };
  if (input.firstParty && scope !== "org") {
    return { ok: false, error: "First-party MCP servers must be org-scoped" };
  }
  const urlCheck = validateRemoteUrl(input.url);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error ?? "Bad URL" };

  const existing = await readList(scope, scopeId);
  if (existing.some((s) => s.name === name)) {
    return { ok: false, error: `A server named "${name}" already exists` };
  }

  const id = `mcps_${shortId()}`;
  const { cleartext, secret } = partitionHeaders(input.headers);

  // Persist secret-class headers in the encrypted secrets table; the
  // settings row only references the secret key, never the cleartext.
  let headerSecretKey: string | undefined;
  if (secret) {
    headerSecretKey = `mcp_headers:${id}`;
    try {
      await writeAppSecret({
        key: headerSecretKey,
        value: JSON.stringify(secret),
        scope: toSecretScope(scope),
        scopeId,
        description: `Encrypted MCP headers for ${name}`,
      });
    } catch (err: any) {
      return {
        ok: false,
        error: `Failed to encrypt MCP headers: ${err?.message ?? err}`,
      };
    }
  }

  const server: StoredRemoteMcpServer = {
    id,
    name,
    url: urlCheck.url!.toString(),
    headers: cleartext,
    headerSecretKey,
    ...(input.firstParty ? { firstParty: true } : {}),
    ...(input.firstPartyAppId
      ? { firstPartyAppId: input.firstPartyAppId }
      : {}),
    ...(input.oauthSecretKey ? { oauthSecretKey: input.oauthSecretKey } : {}),
    description: input.description?.trim() || undefined,
    createdAt: Date.now(),
  };
  await writeList(scope, scopeId, [...existing, server]);
  return { ok: true, server };
}

function normalizeEndpointPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function expectedFirstPartyMcpUrls(appUrl: string): URL[] {
  try {
    const base = appUrl.replace(/\/+$/, "");
    return [new URL(`${base}/mcp`), new URL(`${base}/_agent-native/mcp`)];
  } catch {
    return [];
  }
}

function sameFirstPartyMcpEndpoint(endpointUrl: URL, appUrl: string): boolean {
  return expectedFirstPartyMcpUrls(appUrl).some(
    (expected) =>
      endpointUrl.origin === expected.origin &&
      normalizeEndpointPath(endpointUrl.pathname) ===
        normalizeEndpointPath(expected.pathname) &&
      endpointUrl.search === expected.search,
  );
}

export async function isFirstPartyRemoteEndpointTrusted(
  orgId: string,
  appId: string,
  endpoint: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedAppId = appId.trim().toLowerCase();
  if (!orgId.trim()) {
    return { ok: false, error: "Organization id is required" };
  }
  if (!normalizedAppId) {
    return { ok: false, error: "First-party app id is required" };
  }

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }

  try {
    const { getRequestOrgId } = await import("../server/request-context.js");
    const requestOrgId = getRequestOrgId();
    if (requestOrgId && requestOrgId !== orgId) {
      return {
        ok: false,
        error:
          "First-party MCP server org does not match the active request organization",
      };
    }
  } catch {
    // No request context helper available: the org-directory lookup below will
    // still fail closed if it cannot authenticate a first-party app list.
  }

  const { fetchOrgApps } = await import("../mcp/org-directory.js");
  const apps = await fetchOrgApps({ serviceOrgId: orgId });
  const app = apps.find((candidate) => candidate.id === normalizedAppId);
  if (!app) {
    return {
      ok: false,
      error: "Could not verify the first-party app in the org directory",
    };
  }
  if (!sameFirstPartyMcpEndpoint(endpointUrl, app.url)) {
    return {
      ok: false,
      error:
        "First-party MCP URL does not match the org-directory app endpoint",
    };
  }
  return { ok: true };
}

export async function removeRemoteServer(
  scope: RemoteMcpScope,
  scopeId: string,
  id: string,
): Promise<boolean> {
  const existing = await readList(scope, scopeId);
  const removed = existing.find((s) => s.id === id);
  const next = existing.filter((s) => s.id !== id);
  if (next.length === existing.length) return false;
  if (next.length === 0) {
    if (scope === "user") {
      await deleteUserSetting(scopeId, SETTINGS_KEY);
    } else {
      await deleteOrgSetting(scopeId, SETTINGS_KEY);
    }
  } else {
    await writeList(scope, scopeId, next);
  }
  // Best-effort: drop the encrypted-headers secret too. Errors are logged
  // but don't fail the deletion — the settings row is already gone, so a
  // dangling secret is harmless (it just can't be read back).
  if (removed?.headerSecretKey) {
    try {
      await deleteAppSecret({
        key: removed.headerSecretKey,
        scope: toSecretScope(scope),
        scopeId,
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-client] Failed to delete MCP header secret ${removed.headerSecretKey}: ${err?.message ?? err}`,
      );
    }
  }
  if (removed?.oauthSecretKey) {
    try {
      await deleteMcpOAuthCredentials({
        key: removed.oauthSecretKey,
        scope,
        scopeId,
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-client] Failed to delete MCP OAuth credentials ${removed.oauthSecretKey}: ${err?.message ?? err}`,
      );
    }
  }
  return true;
}

/**
 * Resolve the full headers map (cleartext + decrypted secret headers) for a
 * stored MCP server. Used when projecting the stored record into the
 * runtime `McpHttpServerConfig` shape that `McpClientManager` consumes.
 *
 * For legacy rows that wrote secrets cleartext into `headers`, this
 * returns those cleartext values unchanged — they should be re-saved
 * through `addRemoteServer` to migrate to encrypted storage.
 */
export async function materializeHeaders(
  scope: RemoteMcpScope,
  scopeId: string,
  stored: StoredRemoteMcpServer,
): Promise<Record<string, string> | undefined> {
  const merged: Record<string, string> = { ...(stored.headers ?? {}) };
  if (stored.headerSecretKey) {
    try {
      const secret = await readAppSecret({
        key: stored.headerSecretKey,
        scope: toSecretScope(scope),
        scopeId,
      });
      if (secret) {
        const parsed = JSON.parse(secret.value) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") merged[k] = v;
        }
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-client] Failed to decrypt MCP headers for ${stored.name}: ${err?.message ?? err}`,
      );
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Project a stored server into the runtime `McpHttpServerConfig` shape that
 * `McpClientManager` consumes. The merged-config key is the scope + name
 * so a user-scope and org-scope server can both share a readable name
 * without clobbering each other.
 *
 * SECURITY: when the stored row references encrypted headers
 * (`headerSecretKey`), callers should use `toHttpServerConfigAsync`
 * instead — this synchronous variant returns ONLY the cleartext headers
 * already present on the row. Returning the row's literal headers without
 * the secret material means the runtime client would call the MCP server
 * without auth (request will fail), but never leaks the encrypted secret.
 */
export function toHttpServerConfig(
  stored: StoredRemoteMcpServer,
): McpHttpServerConfig {
  return {
    type: "http",
    url: stored.url,
    headers: stored.headers,
    ...(stored.firstParty ? { firstParty: true } : {}),
    ...(stored.firstPartyAppId
      ? { firstPartyAppId: stored.firstPartyAppId }
      : {}),
    description: stored.description,
  };
}

/**
 * Async variant of `toHttpServerConfig` that resolves any encrypted
 * `headerSecretKey` reference from `app_secrets` and returns the full
 * cleartext headers map for use at runtime. Use this when actually
 * configuring an MCP client; use the sync variant only when serializing
 * stored data (e.g. for read-only listings that shouldn't disclose
 * secrets).
 */
export async function toHttpServerConfigAsync(
  scope: RemoteMcpScope,
  scopeId: string,
  stored: StoredRemoteMcpServer,
): Promise<McpHttpServerConfig> {
  let headers = await materializeHeaders(scope, scopeId, stored);
  if (stored.oauthSecretKey) {
    const accessToken = await getMcpOAuthAccessToken({
      key: stored.oauthSecretKey,
      scope,
      scopeId,
      serverUrl: stored.url,
    });
    if (accessToken) {
      headers ??= {};
      headers.Authorization = `Bearer ${accessToken}`;
    }
  }
  return {
    type: "http",
    url: stored.url,
    headers,
    ...(stored.firstParty ? { firstParty: true } : {}),
    ...(stored.firstPartyAppId
      ? { firstPartyAppId: stored.firstPartyAppId }
      : {}),
    ...(stored.firstParty && scope === "org"
      ? { firstPartyOrgId: scopeId }
      : {}),
    description: stored.description,
  };
}

/**
 * Build the merged-config key for a stored server.
 *
 * The key encodes the owning scope + owner identity so two users adding a
 * server called `zapier` produce distinct ids (`user_ab12cd34ef_zapier` vs
 * `user_99aa88bb77_zapier`) and Alice's tool calls never route through Bob's
 * credentials in a shared-process deployment.
 *
 * - User scope: `user_<emailhash>_<name>`
 * - Org scope:  `org_<orgId>_<name>`
 *
 * `ownerId` is the raw email for user scope, and the org id for org scope.
 */
export function mergedConfigKey(
  scope: RemoteMcpScope,
  stored: StoredRemoteMcpServer,
  ownerId: string,
): string {
  const owner = scope === "user" ? hashEmail(ownerId) : sanitiseOrgId(ownerId);
  return `${scope}_${owner}_${stored.name}`;
}

/**
 * Parse a merged key (or a full prefixed tool name like
 * `mcp__user_abcd1234ef_zapier__run-task`) back into its scope + owner + name
 * components. Returns null for non-merged keys (e.g. stdio file-config servers
 * like `claude-in-chrome`) so callers can treat them as always-visible.
 *
 * `hub_<orgId>_<name>` entries (pulled from a remote hub via
 * `hub-client.ts`) project to `scope: "org"` so they pass through the same
 * per-request visibility gate as locally-stored org servers — the tool is
 * only visible to requests whose active org matches the hub entry's org.
 */
export function parseMergedKey(
  keyOrToolName: string,
): { scope: RemoteMcpScope; owner: string; name: string } | null {
  let key = keyOrToolName;
  if (key.startsWith("mcp__")) {
    const rest = key.slice("mcp__".length);
    const idx = rest.indexOf("__");
    key = idx >= 0 ? rest.slice(0, idx) : rest;
  }
  const m = /^(user|org|hub)_([^_]+)_(.+)$/.exec(key);
  if (!m) return null;
  const prefix = m[1];
  // Hub-sourced servers are scoped to the org they came from — treat them
  // as org-scope for visibility purposes (see isMcpToolAllowedForRequest).
  const scope: RemoteMcpScope = prefix === "user" ? "user" : "org";
  return {
    scope,
    owner: m[2],
    name: m[3],
  };
}
