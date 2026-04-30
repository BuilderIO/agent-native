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
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/user-settings.js";
import {
  getOrgSetting,
  putOrgSetting,
  deleteOrgSetting,
} from "../settings/org-settings.js";
import {
  writeAppSecret,
  readAppSecret,
  deleteAppSecret,
} from "../secrets/storage.js";
import type { McpHttpServerConfig } from "./config.js";

const SETTINGS_KEY = "mcp-servers-remote";

export type RemoteMcpScope = "user" | "org";

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

/**
 * Hostname patterns that are always rejected to prevent SSRF via DNS rebinding
 * or well-known internal service names.
 */
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  // DNS rebind services
  /\.nip\.io$/i,
  /\.sslip\.io$/i,
  /\.xip\.io$/i,
  /\.localtest\.me$/i,
  /\.lvh\.me$/i,
  // Cloud metadata hosts
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
];

/** Literal IPs that are always rejected (cloud metadata endpoints). */
const BLOCKED_IPS = new Set([
  "169.254.169.254", // AWS/GCP/Azure IMDS
  "100.100.100.200", // Alibaba Cloud metadata
  "::1",
]);

/** Parse a dotted-decimal IPv4 string to a 32-bit integer for range checks. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = parseInt(part, 10);
    if (isNaN(byte) || byte < 0 || byte > 255) return null;
    n = (n << 8) | byte;
  }
  return n >>> 0;
}

function isPrivateIpv4(hostname: string): boolean {
  const n = ipv4ToInt(hostname);
  if (n === null) return false;
  // 10.0.0.0/8
  if ((n & 0xff000000) >>> 0 === 0x0a000000) return true;
  // 172.16.0.0/12
  if ((n & 0xfff00000) >>> 0 === 0xac100000) return true;
  // 192.168.0.0/16
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true;
  // 169.254.0.0/16 (link-local, includes AWS/GCP metadata)
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true;
  // 127.0.0.0/8 (loopback)
  if ((n & 0xff000000) >>> 0 === 0x7f000000) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_IPS.has(normalized)) return true;
  if (isPrivateIpv4(normalized)) return true;
  // IPv6 ULA (fc00::/7) and link-local (fe80::/10)
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isPrivateIpv4(mapped)) return true;
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped);
    if (hexMatch) {
      const value =
        (parseInt(hexMatch[1], 16) << 16) | parseInt(hexMatch[2], 16);
      const dotted = [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ].join(".");
      if (isPrivateIpv4(dotted)) return true;
    }
  }
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  return false;
}

/** Reject obviously-wrong URLs. Allows http only for localhost. */
export function validateRemoteUrl(raw: string): {
  ok: boolean;
  url?: URL;
  error?: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  if (url.protocol === "https:") {
    if (isBlockedHostname(url.hostname)) {
      return {
        ok: false,
        error: `Host "${url.hostname}" is not allowed (private/internal address)`,
      };
    }
    return { ok: true, url };
  }
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return { ok: true, url };
    }
    return { ok: false, error: "Plain http is only allowed for localhost" };
  }
  return { ok: false, error: `Unsupported protocol: ${url.protocol}` };
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
  },
): Promise<
  { ok: true; server: StoredRemoteMcpServer } | { ok: false; error: string }
> {
  const name = normalizeServerName(input.name);
  if (!name) return { ok: false, error: "Name is required" };
  const urlCheck = validateRemoteUrl(input.url);
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error ?? "Bad URL" };

  const existing = await readList(scope, scopeId);
  if (existing.some((s) => s.name === name)) {
    return { ok: false, error: `A server named "${name}" already exists` };
  }

  const server: StoredRemoteMcpServer = {
    id: `mcps_${shortId()}`,
    name,
    url: urlCheck.url!.toString(),
    headers:
      input.headers && Object.keys(input.headers).length > 0
        ? { ...input.headers }
        : undefined,
    description: input.description?.trim() || undefined,
    createdAt: Date.now(),
  };
  await writeList(scope, scopeId, [...existing, server]);
  return { ok: true, server };
}

export async function removeRemoteServer(
  scope: RemoteMcpScope,
  scopeId: string,
  id: string,
): Promise<boolean> {
  const existing = await readList(scope, scopeId);
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
  return true;
}

/**
 * Project a stored server into the runtime `McpHttpServerConfig` shape that
 * `McpClientManager` consumes. The merged-config key is the scope + name
 * so a user-scope and org-scope server can both share a readable name
 * without clobbering each other.
 */
export function toHttpServerConfig(
  stored: StoredRemoteMcpServer,
): McpHttpServerConfig {
  return {
    type: "http",
    url: stored.url,
    headers: stored.headers,
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
