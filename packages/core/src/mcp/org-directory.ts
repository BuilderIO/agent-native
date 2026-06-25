/**
 * Org-directory discovery for the generic cross-app MCP verbs
 * (`list_apps` / `ask_app` in `builtin-tools.ts`).
 *
 * Phase 3b of cross-app auto-wiring. Today the cross-app verbs resolve sibling
 * apps from *local workspace* info only (`workspace-resolve.ts`), so the mail
 * agent can only reach the calendar agent in a local dev workspace. When the
 * deployment runs against an org directory (Dispatch is also the identity hub
 * for the org), this module discovers the org's *deployed* sibling apps so the
 * same verbs work cross-app in production with ZERO manual setup.
 *
 * ## The directory request
 *
 *   GET  <directoryOrigin>/_agent-native/org/apps
 *   Auth Authorization: Bearer <org A2A token>   (same signed token A2A peers
 *        already mint — reuses `resolveA2ACallerAuth()`; the org A2A secret /
 *        global `A2A_SECRET` is loaded exactly how outgoing A2A calls load it)
 *   ⇒    { org, apps: [ { id, name, url, a2aUrl, capabilities? } ] }
 *        (allow-listed first-party apps only, prod URLs — enforced by the
 *         authority side, Phase 3a, on Dispatch)
 *
 * ## Resolution + safety model
 *
 *   - The directory origin is read from env: `AGENT_NATIVE_ORG_DIRECTORY_URL`
 *     (dedicated) or `AGENT_NATIVE_IDENTITY_HUB_URL` (Dispatch is also the
 *     identity hub). When *neither* is set the feature is simply inactive —
 *     `fetchOrgApps()` returns `[]` and nothing changes anywhere (asserted by
 *     a test). This makes the whole feature opt-in and back-compat.
 *   - On ANY error (no env, unreachable, 401, non-2xx, bad JSON, no signed
 *     token) `fetchOrgApps()` returns `[]` and NEVER throws — the cross-app
 *     verbs degrade silently to their exact current local-only behavior.
 *   - A short in-memory TTL cache (default 60s) keyed by directory origin and
 *     caller identity/org scope so sibling app lists never cross tenants.
 *     Empty authenticated results are cached too (with a shorter TTL) so a
 *     transient failure doesn't hammer the directory on every call.
 *   - No secrets are ever logged.
 *
 * Bundled alongside `mountMCP` (no Node-only top-level imports). The A2A
 * caller-auth + a2a client are dynamically imported inside `fetchOrgApps()`.
 */

export interface OrgApp {
  /** Canonical app id, e.g. `calendar`. */
  id: string;
  /** Human-readable name, e.g. `Calendar`. */
  name: string;
  /** Deployed app origin/URL, e.g. `https://calendar.acme.com`. */
  url: string;
  /**
   * A2A endpoint to route `ask_app` to. The authority side returns this; we
   * fall back to the app `url` (the A2A client appends `/_agent-native/a2a`).
   */
  a2aUrl: string;
  /** Optional capability hints the authority side may include. */
  capabilities?: string[];
}

/** Default cache TTL for a successful directory fetch. */
const SUCCESS_TTL_MS = 60_000;
/** Shorter TTL for an empty/failed fetch so transient errors recover fast. */
const EMPTY_TTL_MS = 10_000;

interface CacheEntry {
  apps: OrgApp[];
  expiresAt: number;
}

/** In-memory cache keyed by resolved directory origin (+ identity scope). */
const cache = new Map<string, CacheEntry>();

/**
 * Resolve the org-directory origin from env. Returns `null` when neither env
 * var is set — the caller treats `null` as "feature inactive".
 *
 * `env` is injectable for tests; defaults to `process.env`.
 */
export function resolveOrgDirectoryOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw =
    env.AGENT_NATIVE_ORG_DIRECTORY_URL || env.AGENT_NATIVE_IDENTITY_HUB_URL;
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    // Validate it's an absolute http(s) URL; reject anything else.
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

function normalizeApp(raw: unknown): OrgApp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!id || !url) return null;
  // Only accept absolute http(s) URLs from the directory.
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : id;
  const a2aUrl =
    typeof r.a2aUrl === "string" && r.a2aUrl.trim() ? r.a2aUrl.trim() : url;
  const capabilities = Array.isArray(r.capabilities)
    ? r.capabilities.filter((c): c is string => typeof c === "string")
    : undefined;
  return {
    id,
    name,
    url: url.replace(/\/+$/, ""),
    a2aUrl: a2aUrl.replace(/\/+$/, ""),
    ...(capabilities && capabilities.length ? { capabilities } : {}),
  };
}

/** Compare two origins by host (ignores trailing slash / protocol noise). */
function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && ua.protocol === ub.protocol;
  } catch {
    return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
  }
}

function scopedCacheKey(
  origin: string,
  auth: {
    userEmail?: string;
    orgId?: string;
    orgDomain?: string;
  },
): string {
  return [
    origin,
    `user:${auth.userEmail ?? ""}`,
    `org:${auth.orgId ?? auth.orgDomain ?? ""}`,
  ].join("|");
}

function serviceScopedCacheKey(origin: string, orgId: string): string {
  return [origin, `service-org:${orgId}`].join("|");
}

/**
 * Fetch the org's first-party sibling apps from the org directory.
 *
 * - Returns `[]` (never throws) on ANY failure or when the directory env is
 *   unset — the cross-app verbs then keep their exact local-only behavior.
 * - Short in-memory TTL cache so it isn't fetched on every tool call.
 * - Strips the current app from the result (compared by id and by origin) so
 *   `list_apps` / `ask_app` never offer to route to themselves.
 *
 * @param opts.selfId      Current app id (so it's stripped from the result).
 * @param opts.selfOrigin  Current app origin (so it's stripped by origin too).
 * @param opts.env         Injectable env (tests). Defaults to `process.env`.
 */
export async function fetchOrgApps(opts?: {
  selfId?: string;
  selfOrigin?: string;
  serviceOrgId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<OrgApp[]> {
  const env = opts?.env ?? process.env;
  const origin = resolveOrgDirectoryOrigin(env);
  // Feature inactive: no directory configured ⇒ behave exactly as before.
  if (!origin) return [];

  const selfId = (opts?.selfId ?? "").trim().toLowerCase();
  const selfOrigin = (opts?.selfOrigin ?? "").trim();

  const stripSelf = (apps: OrgApp[]): OrgApp[] =>
    apps.filter((a) => {
      if (selfId && a.id === selfId) return false;
      if (selfOrigin && sameOrigin(a.url, selfOrigin)) return false;
      return true;
    });

  let cacheKey: string | null = null;
  let apps: OrgApp[] = [];
  let ttl = EMPTY_TTL_MS;
  const serviceOrgId = opts?.serviceOrgId?.trim();
  if (serviceOrgId) {
    const serviceCacheKey = serviceScopedCacheKey(origin, serviceOrgId);
    const cached = cache.get(serviceCacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return stripSelf(cached.apps);
    }
    cacheKey = serviceCacheKey;
  }
  try {
    const auth = serviceOrgId
      ? await resolveOrgDirectoryServiceAuth(serviceOrgId)
      : await resolveOrgDirectoryCallerAuth();
    if (!auth.apiKey) {
      // No signed token available (no A2A secret / no caller identity) — the
      // directory requires the org bearer, so degrade silently to local-only.
      return [];
    }

    if (!cacheKey) {
      const now = Date.now();
      cacheKey = scopedCacheKey(origin, auth);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return stripSelf(cached.apps);
      }
    }

    const res = await fetch(`${origin}/_agent-native/org/apps`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { apps?: unknown };
      const list = Array.isArray(json?.apps) ? json.apps : [];
      apps = list.map(normalizeApp).filter((a): a is OrgApp => a !== null);
      ttl = SUCCESS_TTL_MS;
    }
    // Non-2xx ⇒ leave apps=[] with the short EMPTY_TTL (silent degrade).
  } catch {
    // Unreachable / parse error / abort ⇒ silent degrade to local-only.
    apps = [];
    ttl = EMPTY_TTL_MS;
  }

  if (cacheKey) {
    cache.set(cacheKey, {
      apps,
      expiresAt: Date.now() + ttl,
    });
  }
  return stripSelf(apps);
}

/** Test-only: clear the in-memory cache between cases. */
export function _resetOrgDirectoryCache(): void {
  cache.clear();
}

async function resolveOrgDirectoryCallerAuth(): Promise<{
  apiKey?: string;
  userEmail?: string;
  orgId?: string;
  orgDomain?: string;
}> {
  // Reuse the existing A2A caller-auth: it reads userEmail + orgId from the
  // request context, loads the org A2A secret via getOrgA2ASecret (falling
  // back to the global A2A_SECRET env), and signs the same bearer JWT A2A
  // peers already use. No new secret loading is invented for normal callers.
  const { resolveA2ACallerAuth } = await import("../a2a/caller-auth.js");
  return resolveA2ACallerAuth();
}

async function resolveOrgDirectoryServiceAuth(orgId: string): Promise<{
  apiKey?: string;
  userEmail?: string;
  orgId?: string;
  orgDomain?: string;
}> {
  const trimmedOrgId = orgId.trim();
  if (!trimmedOrgId) return {};
  let orgDomain: string | undefined;
  let orgSecret: string | undefined;
  try {
    const { getOrgDomain, getOrgA2ASecret } = await import("../org/context.js");
    orgDomain = (await getOrgDomain(trimmedOrgId)) ?? undefined;
    orgSecret = (await getOrgA2ASecret(trimmedOrgId)) ?? undefined;
  } catch {}
  try {
    const [{ signA2AToken }, { serviceIdentityEmail }] = await Promise.all([
      import("../a2a/client.js"),
      import("./connect-store.js"),
    ]);
    const userEmail = serviceIdentityEmail("mcp-client", trimmedOrgId);
    const apiKey = await signA2AToken(userEmail, orgDomain, orgSecret, {
      expiresIn: "5m",
      preferGlobalSecret: !orgSecret,
      extraClaims: { org_id: trimmedOrgId },
    });
    return { apiKey, userEmail, orgId: trimmedOrgId, orgDomain };
  } catch {
    return { orgId: trimmedOrgId, orgDomain };
  }
}
