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
 *   - `fetchOrgAppsResult()` preserves directory availability for callers
 *     that cannot mistake a failed lookup for an empty directory.
 *     `fetchOrgApps()` remains the best-effort compatibility wrapper: on ANY
 *     error it returns `[]` and NEVER throws, so cross-app verbs still degrade
 *     silently to their exact current local-only behavior.
 *   - A short in-memory TTL cache (default 60s) keyed by directory origin and
 *     caller identity/org scope so sibling app lists never cross tenants.
 *     Only successful authenticated responses are cached; unavailable results
 *     remain immediately retryable.
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
interface CacheEntry {
  apps: OrgApp[];
  expiresAt: number;
}

export type OrgDirectoryUnavailableReason =
  | "not-configured"
  | "authentication"
  | "authorization"
  | "timeout"
  | "network"
  | "invalid-response"
  | "server-error"
  | "http-error";

export type OrgDirectoryFetchResult =
  | { status: "available"; apps: OrgApp[] }
  | { status: "unavailable"; reason: OrgDirectoryUnavailableReason };

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

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeApp(raw: unknown, strict = false): OrgApp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : "";
  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!id || !url || !isAbsoluteHttpUrl(url)) return null;
  if (
    strict &&
    ((r.name !== undefined && typeof r.name !== "string") ||
      (r.a2aUrl !== undefined && typeof r.a2aUrl !== "string") ||
      (r.capabilities !== undefined &&
        (!Array.isArray(r.capabilities) ||
          r.capabilities.some((item) => typeof item !== "string"))))
  ) {
    return null;
  }
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : id;
  const explicitA2aUrl = typeof r.a2aUrl === "string" ? r.a2aUrl.trim() : "";
  if (strict && r.a2aUrl !== undefined && !isAbsoluteHttpUrl(explicitA2aUrl)) {
    return null;
  }
  const a2aUrl = isAbsoluteHttpUrl(explicitA2aUrl) ? explicitA2aUrl : url;
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
  includeDirectoryApp = false,
  strictValidation = true,
): string {
  return [
    origin,
    `user:${auth.userEmail ?? ""}`,
    `org:${auth.orgId ?? auth.orgDomain ?? ""}`,
    `include-directory:${includeDirectoryApp ? "1" : "0"}`,
    `validation:${strictValidation ? "strict" : "permissive"}`,
  ].join("|");
}

function authTokenAttempts(auth: {
  apiKey?: string;
  apiKeyFallbacks?: string[];
}): string[] {
  return [auth.apiKey, ...(auth.apiKeyFallbacks ?? [])].filter(
    (token): token is string => typeof token === "string" && token.length > 0,
  );
}

function serviceScopedCacheKey(
  origin: string,
  orgId: string,
  includeDirectoryApp = false,
  strictValidation = true,
): string {
  return [
    origin,
    `service-org:${orgId}`,
    `include-directory:${includeDirectoryApp ? "1" : "0"}`,
    `validation:${strictValidation ? "strict" : "permissive"}`,
  ].join("|");
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
 * @param opts.includeDirectoryApp Request the directory authority itself. The
 *   server keeps legacy self-filtering unless this explicit signal is present.
 * @param opts.env         Injectable env (tests). Defaults to `process.env`.
 */
export interface FetchOrgAppsOptions {
  selfId?: string;
  selfOrigin?: string;
  includeDirectoryApp?: boolean;
  serviceOrgId?: string;
  env?: NodeJS.ProcessEnv;
}

async function fetchOrgAppsResultInternal(
  opts?: FetchOrgAppsOptions,
  strictValidation = true,
): Promise<OrgDirectoryFetchResult> {
  const env = opts?.env ?? process.env;
  const origin = resolveOrgDirectoryOrigin(env);
  if (!origin) return { status: "unavailable", reason: "not-configured" };

  const selfId = (opts?.selfId ?? "").trim().toLowerCase();
  const selfOrigin = (opts?.selfOrigin ?? "").trim();

  const stripSelf = (apps: OrgApp[]): OrgApp[] =>
    apps.filter((a) => {
      if (selfId && a.id === selfId) return false;
      if (selfOrigin && sameOrigin(a.url, selfOrigin)) return false;
      return true;
    });

  let cacheKey: string | null = null;
  const serviceOrgId = opts?.serviceOrgId?.trim();
  if (serviceOrgId) {
    const serviceCacheKey = serviceScopedCacheKey(
      origin,
      serviceOrgId,
      opts?.includeDirectoryApp,
      strictValidation,
    );
    const cached = cache.get(serviceCacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { status: "available", apps: stripSelf(cached.apps) };
    }
    cacheKey = serviceCacheKey;
  }
  try {
    const auth = serviceOrgId
      ? await resolveOrgDirectoryServiceAuth(serviceOrgId)
      : await resolveOrgDirectoryCallerAuth();
    const attempts = authTokenAttempts(auth);
    if (attempts.length === 0) {
      return { status: "unavailable", reason: "authentication" };
    }

    if (!cacheKey) {
      const now = Date.now();
      cacheKey = scopedCacheKey(
        origin,
        auth,
        opts?.includeDirectoryApp,
        strictValidation,
      );
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return { status: "available", apps: stripSelf(cached.apps) };
      }
    }

    for (let i = 0; i < attempts.length; i++) {
      const res = await fetch(`${origin}/_agent-native/org/apps`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${attempts[i]}`,
          Accept: "application/json",
          ...(opts?.includeDirectoryApp
            ? { "X-Agent-Native-Include-Directory-App": "1" }
            : {}),
        },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const json = (await res.json()) as { apps?: unknown };
        if (!Array.isArray(json?.apps))
          return { status: "unavailable", reason: "invalid-response" };
        const normalizedApps = json.apps.map((app) =>
          normalizeApp(app, strictValidation),
        );
        if (strictValidation && normalizedApps.some((app) => app === null)) {
          return { status: "unavailable", reason: "invalid-response" };
        }
        const apps = normalizedApps.filter((a): a is OrgApp => a !== null);
        if (cacheKey) {
          cache.set(cacheKey, {
            apps,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
        }
        return { status: "available", apps: stripSelf(apps) };
      }
      if (res.status === 401 && i < attempts.length - 1) continue;
      return {
        status: "unavailable",
        reason:
          res.status === 401 || res.status === 403
            ? "authorization"
            : res.status === 429 || res.status >= 500
              ? "server-error"
              : "http-error",
      };
    }
  } catch (error) {
    return {
      status: "unavailable",
      reason:
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? "timeout"
          : error instanceof SyntaxError
            ? "invalid-response"
            : "network",
    };
  }
  return { status: "unavailable", reason: "authorization" };
}

export async function fetchOrgAppsResult(
  opts?: FetchOrgAppsOptions,
): Promise<OrgDirectoryFetchResult> {
  return fetchOrgAppsResultInternal(opts, true);
}

export async function fetchOrgApps(
  opts?: FetchOrgAppsOptions,
): Promise<OrgApp[]> {
  const result = await fetchOrgAppsResultInternal(opts, false);
  return result.status === "available" ? result.apps : [];
}

/** Test-only: clear the in-memory cache between cases. */
export function _resetOrgDirectoryCache(): void {
  cache.clear();
}

async function resolveOrgDirectoryCallerAuth(): Promise<{
  apiKey?: string;
  apiKeyFallbacks?: string[];
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
  apiKeyFallbacks?: string[];
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
    const apiKeyAttempts: string[] = [];
    const addApiKeyAttempt = (token: string | undefined) => {
      if (!token || apiKeyAttempts.includes(token)) return;
      apiKeyAttempts.push(token);
    };
    if (process.env.A2A_SECRET?.trim()) {
      try {
        addApiKeyAttempt(
          await signA2AToken(userEmail, orgDomain, orgSecret, {
            expiresIn: "5m",
            preferGlobalSecret: true,
            extraClaims: { org_id: trimmedOrgId },
          }),
        );
      } catch {}
    }
    if (orgSecret) {
      try {
        addApiKeyAttempt(
          await signA2AToken(userEmail, orgDomain, orgSecret, {
            expiresIn: "5m",
            preferGlobalSecret: false,
            extraClaims: { org_id: trimmedOrgId },
          }),
        );
      } catch {}
    }
    return {
      apiKey: apiKeyAttempts[0],
      ...(apiKeyAttempts.length > 1
        ? { apiKeyFallbacks: apiKeyAttempts.slice(1) }
        : {}),
      userEmail,
      orgId: trimmedOrgId,
      orgDomain,
    };
  } catch {
    return { orgId: trimmedOrgId, orgDomain };
  }
}
