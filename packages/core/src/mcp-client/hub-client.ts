/**
 * Hub consume — fetches a remote agent-native app's org-scope MCP servers
 * and projects them into the local MCP manager's config shape.
 *
 * Opt-in via env:
 *   AGENT_NATIVE_MCP_HUB_URL   = https://dispatch.example.com
 *   AGENT_NATIVE_MCP_HUB_TOKEN = <shared secret, matches hub's token>
 *
 * Failures are non-fatal — if the hub is unreachable or the token is
 * wrong, the app boots with just its local MCP config and logs a warning.
 */

import type { McpHttpServerConfig, McpServerConfig } from "./config.js";
import type { HubServersResponse } from "./hub-routes.js";
import { isHubConsumeEnabled } from "./hub-routes.js";

const FETCH_TIMEOUT_MS = 5_000;

/** Merged-config key prefix for hub-sourced servers — avoids collision with
 * the consuming app's own `org_<orgId>_<name>` entries. */
function hubMergedKey(orgId: string, name: string): string {
  return `hub_${orgId}_${name}`;
}

/**
 * Fetch the remote hub's org-scope servers and return them keyed by the
 * `hub_<orgId>_<name>` merged-key shape that `McpClientManager` consumes.
 *
 * Returns an empty object when hub consume isn't enabled or the call fails.
 */
export async function fetchHubServers(): Promise<
  Record<string, McpServerConfig>
> {
  if (!isHubConsumeEnabled()) return {};
  const base = process.env.AGENT_NATIVE_MCP_HUB_URL!.trim();
  const token = process.env.AGENT_NATIVE_MCP_HUB_TOKEN!.trim();
  const url = joinUrl(base, "/_agent-native/mcp/hub/servers");

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
    console.warn(
      `[mcp-client] hub fetch failed (${url}): ${err?.message ?? err}`,
    );
    return {};
  }

  if (!res.ok) {
    console.warn(
      `[mcp-client] hub fetch returned ${res.status} from ${url} — ignoring hub servers`,
    );
    return {};
  }

  let body: HubServersResponse;
  try {
    body = (await res.json()) as HubServersResponse;
  } catch (err: any) {
    console.warn(
      `[mcp-client] hub response was not JSON: ${err?.message ?? err}`,
    );
    return {};
  }
  if (!body || !Array.isArray(body.servers)) return {};

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
  return out;
}

function joinUrl(base: string, path: string): string {
  if (base.endsWith("/")) base = base.slice(0, -1);
  if (!path.startsWith("/")) path = `/${path}`;
  return `${base}${path}`;
}
