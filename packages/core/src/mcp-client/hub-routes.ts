/**
 * Hub serve — exposes this app's org-scope MCP servers to other agent-native
 * apps in the same workspace.
 *
 * An app becomes a hub by setting `AGENT_NATIVE_MCP_HUB_TOKEN=<secret>` in
 * its environment. Consuming apps set the same token plus
 * `AGENT_NATIVE_MCP_HUB_URL` pointing at the hub; at startup they pull the
 * hub's org-scope server list (URL + headers + description) and merge it
 * into their own running MCP manager.
 *
 * Convention: dispatch is the hub. Any template can consume from it.
 *
 * User-scope servers are intentionally NOT shared — personal credentials
 * stay with the user who added them. Only `o:<orgId>:mcp-servers-remote`
 * entries are returned.
 *
 * Each response is bound to one organization. Browser callers use their
 * active org; service callers use the hub process's AGENT_ORG_ID.
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getH3App } from "../server/framework-request-handler.js";
import { getAmbientOrgId } from "../server/request-context.js";
import { getOrgSetting } from "../settings/org-settings.js";
import { resolveMcpPrincipalForEvent } from "./principal.js";
import type { StoredRemoteMcpServer } from "./remote-store.js";

const TOKEN_ENV = "AGENT_NATIVE_MCP_HUB_TOKEN";

export interface HubServerRecord {
  id: string;
  orgId: string;
  name: string;
  url: string;
  headers?: Record<string, string>;
  description?: string;
}

export interface HubServersResponse {
  servers: HubServerRecord[];
  generatedAt: number;
}

export function isHubServeEnabled(): boolean {
  return !!process.env[TOKEN_ENV]?.trim();
}

export function isHubConsumeEnabled(): boolean {
  return (
    !!process.env.AGENT_NATIVE_MCP_HUB_URL?.trim() &&
    !!process.env.AGENT_NATIVE_MCP_HUB_TOKEN?.trim()
  );
}

export async function listHubServers(
  orgId: string,
): Promise<HubServerRecord[]> {
  const setting = await getOrgSetting(orgId, "mcp-servers-remote");
  const out: HubServerRecord[] = [];
  const list = (setting as { servers?: StoredRemoteMcpServer[] } | null)
    ?.servers;
  if (!Array.isArray(list)) return out;
  for (const stored of list) {
    if (!stored || typeof stored.url !== "string" || !stored.name) continue;
    out.push({
      id: `${orgId}-${stored.name}`,
      orgId,
      name: stored.name,
      url: stored.url,
      headers: stored.headers,
      description: stored.description,
    });
  }

  return out;
}

function checkBearer(event: H3Event): string | null {
  const expected = process.env[TOKEN_ENV]?.trim();
  if (!expected) return "Hub serve is not enabled on this app";
  const header = getRequestHeader(event, "authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return "Bearer token required";
  const provided = match[1].trim();
  if (provided.length !== expected.length) return "Invalid token";
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return "Invalid token";
  return null;
}

export function mountMcpHubRoutes(nitroApp: any): void {
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpHubMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);

  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/hub/servers",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const authError = checkBearer(event);
        if (authError) {
          setResponseStatus(event, 401);
          return { error: authError };
        }
        const principal = await resolveMcpPrincipalForEvent(event);
        const queryOrgId = getQuery(event).orgId;
        const requestedOrgId =
          typeof queryOrgId === "string" ? queryOrgId.trim() : "";
        const orgId = principal ? principal.orgId : getAmbientOrgId()?.trim();
        if (!orgId || (requestedOrgId && requestedOrgId !== orgId)) {
          setResponseStatus(event, principal ? 403 : 401);
          return { error: "Organization scope is not available" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        setResponseHeader(event, "Cache-Control", "no-store");
        const servers = await listHubServers(orgId);
        const payload: HubServersResponse = {
          servers,
          generatedAt: Date.now(),
        };
        return payload;
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/hub/servers: ${err?.message ?? err}`,
    );
  }
}

export function getHubStatus(): {
  serving: boolean;
  consuming: boolean;
  hubUrl: string | null;
} {
  return {
    serving: isHubServeEnabled(),
    consuming: isHubConsumeEnabled(),
    hubUrl: process.env.AGENT_NATIVE_MCP_HUB_URL?.trim() || null,
  };
}
