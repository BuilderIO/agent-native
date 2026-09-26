import type { McpHttpServerConfig, McpServerConfig } from "./config.js";
import type { HubServersResponse } from "./hub-routes.js";
import { isHubConsumeEnabled } from "./hub-routes.js";

const FETCH_TIMEOUT_MS = 5_000;

function normalizeOrgId(orgId: string): string {
  return orgId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function hubMergedKey(orgId: string, name: string): string {
  return `hub_${normalizeOrgId(orgId)}_${name}`;
}

let lastGoodServers: Record<string, McpServerConfig> | null = null;

export type HubFetchResult =
  | { state: "disabled" }
  | { state: "ok"; servers: Record<string, McpServerConfig> }
  | {
      state: "unreachable";
      servers: Record<string, McpServerConfig>;
      error: string;
    };

export async function fetchHubServersDetailed(): Promise<HubFetchResult> {
  if (!isHubConsumeEnabled()) return { state: "disabled" };
  const base = process.env.AGENT_NATIVE_MCP_HUB_URL!.trim();
  const token = process.env.AGENT_NATIVE_MCP_HUB_TOKEN!.trim();
  const url = joinUrl(base, "/_agent-native/mcp/hub/servers");

  const fallbackServers = lastGoodServers ?? {};

  let res: Response;
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      : null;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller?.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.warn(`[mcp-client] hub fetch failed (${url}): ${msg}`);
    return { state: "unreachable", servers: fallbackServers, error: msg };
  }

  if (!res.ok) {
    const msg = `hub returned ${res.status}`;
    // Auth / config errors (401 unauthorized, 403 forbidden, 404 misconfig)
    // must NOT fall back to the cached set — if the hub is deliberately
    // revoking access (e.g. a rotated token), keeping servers in the
    // manager would leave revoked tools callable until process restart.
    // Transient errors (408 timeout, 429 rate limit, 5xx) are retryable,
    // so for those we keep serving the last-known-good set.
    const isAuthOrConfigError =
      res.status === 401 ||
      res.status === 403 ||
      res.status === 404 ||
      res.status === 410;
    if (isAuthOrConfigError) {
      console.warn(
        `[mcp-client] hub fetch returned ${res.status} from ${url} — clearing cached servers`,
      );
      lastGoodServers = null;
      return { state: "unreachable", servers: {}, error: msg };
    }
    console.warn(
      `[mcp-client] hub fetch returned ${res.status} from ${url} — keeping last-known-good set`,
    );
    return { state: "unreachable", servers: fallbackServers, error: msg };
  }

  let body: HubServersResponse;
  try {
    body = (await res.json()) as HubServersResponse;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.warn(`[mcp-client] hub response was not JSON: ${msg}`);
    return { state: "unreachable", servers: fallbackServers, error: msg };
  }
  if (!body || !Array.isArray(body.servers)) {
    return {
      state: "unreachable",
      servers: fallbackServers,
      error: "malformed hub response",
    };
  }

  const out: Record<string, McpServerConfig> = {};
  for (const s of body.servers) {
    if (!s || typeof s.url !== "string" || !s.name || !s.orgId) continue;
    const cfg: McpHttpServerConfig = {
      type: "http",
      url: s.url,
      headers:
        s.headers && Object.keys(s.headers).length > 0 ? s.headers : undefined,
      description: s.description,
    };
    out[hubMergedKey(s.orgId, s.name)] = cfg;
  }
  lastGoodServers = out;
  return { state: "ok", servers: out };
}

export async function fetchHubServers(): Promise<
  Record<string, McpServerConfig>
> {
  const result = await fetchHubServersDetailed();
  if (result.state === "disabled") return {};
  return result.servers;
}

export function _resetHubCacheForTests(): void {
  lastGoodServers = null;
}

function joinUrl(base: string, path: string): string {
  if (base.endsWith("/")) base = base.slice(0, -1);
  if (!path.startsWith("/")) path = `/${path}`;
  return `${base}${path}`;
}
