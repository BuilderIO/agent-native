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
 * SECURITY — TRUST BOUNDARY:
 * The hub bearer (`AGENT_NATIVE_MCP_HUB_TOKEN`) is a SHARED secret. Anyone
 * who possesses it can list every org's MCP servers on the hub, regardless
 * of their org membership. This is acceptable for the standard convention
 * — one hub per workspace, a single-tenant deployment where every consumer
 * already operates inside the same trust circle. It is NOT acceptable on a
 * multi-tenant hub where different orgs must be isolated from each other.
 *
 * To prevent an accidental cross-tenant leak we refuse to serve hub
 * responses when the database contains MCP rows for multiple distinct orgs
 * AND the operator hasn't explicitly opted in to multi-org mode via
 * `AGENT_NATIVE_MCP_HUB_MULTI_ORG=1`. The check runs in production only;
 * local dev can serve a heterogeneous database without ceremony.
 */

import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getH3App } from "../server/framework-request-handler.js";
import { getAllSettings } from "../settings/store.js";
import type { StoredRemoteMcpServer } from "./remote-store.js";

/** Env var that enables hub-serve. Acts as the shared bearer secret. */
const TOKEN_ENV = "AGENT_NATIVE_MCP_HUB_TOKEN";

/**
 * Opt-in env var that disables the multi-org safety check. Operators should
 * only enable this on a hub deployment that consciously aggregates MCP
 * config across orgs and accepts that the bearer is workspace-wide.
 */
const MULTI_ORG_ENV = "AGENT_NATIVE_MCP_HUB_MULTI_ORG";

let _warnedMultiOrg = false;

export interface HubServerRecord {
  /** `<orgId>-<name>` — unique within the hub response. */
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

/** Is this process configured to serve as a hub for other apps? */
export function isHubServeEnabled(): boolean {
  return !!process.env[TOKEN_ENV]?.trim();
}

/** Is this process configured to consume from a remote hub? */
export function isHubConsumeEnabled(): boolean {
  return (
    !!process.env.AGENT_NATIVE_MCP_HUB_URL?.trim() &&
    !!process.env.AGENT_NATIVE_MCP_HUB_TOKEN?.trim()
  );
}

export async function listHubServers(): Promise<HubServerRecord[]> {
  const all = await getAllSettings().catch(() => ({}));
  const out: HubServerRecord[] = [];
  const seenOrgs = new Set<string>();
  for (const [fullKey, value] of Object.entries(all)) {
    const m = /^o:([^:]+):mcp-servers-remote$/.exec(fullKey);
    if (!m) continue;
    const orgId = m[1];
    seenOrgs.add(orgId);
    const list = (value as { servers?: StoredRemoteMcpServer[] }).servers;
    if (!Array.isArray(list)) continue;
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
  }

  // SECURITY: refuse to serve when multiple orgs share this hub in
  // production, unless the operator has explicitly opted in to multi-org
  // mode. The bearer is workspace-wide, so any consumer in possession of
  // it would otherwise see EVERY org's MCP config — a cross-tenant leak.
  if (
    process.env.NODE_ENV === "production" &&
    seenOrgs.size > 1 &&
    process.env[MULTI_ORG_ENV] !== "1"
  ) {
    if (!_warnedMultiOrg) {
      _warnedMultiOrg = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-client/hub] Refusing to serve hub responses: ${seenOrgs.size} distinct orgs detected ` +
          `but ${MULTI_ORG_ENV} is not set. Set ${MULTI_ORG_ENV}=1 to opt in to cross-org sharing ` +
          `(or disable hub-serve entirely if this is unintentional).`,
      );
    }
    return [];
  }

  return out;
}

function checkBearer(event: H3Event): string | null {
  const expected = process.env[TOKEN_ENV]?.trim();
  if (!expected) return "Hub serve is not enabled on this app";
  const header = getRequestHeader(event, "authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return "Bearer token required";
  // Constant-time compare to avoid timing leaks on the shared secret.
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
  if ((globalThis as any).__agentNativeMcpHubMounted) return;
  (globalThis as any).__agentNativeMcpHubMounted = true;

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
        setResponseHeader(event, "Content-Type", "application/json");
        setResponseHeader(event, "Cache-Control", "no-store");
        const servers = await listHubServers();
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

/** Status used by the UI to show a "hub mode" card. */
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
