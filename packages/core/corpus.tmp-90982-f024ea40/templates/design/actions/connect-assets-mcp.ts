import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { fetchOrgApps } from "@agent-native/core/mcp";
import {
  addFirstPartyRemoteServer,
  isFirstPartyRemoteEndpointTrusted,
  listRemoteServers,
  removeRemoteServer,
} from "@agent-native/core/mcp-client";
import { refreshGlobalMcpManager } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

const SERVER_NAME = "assets";

function assetsMcpUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/_agent-native/mcp`;
}

function sameEndpoint(a: string, b: string): boolean {
  try {
    const urlA = new URL(a);
    const urlB = new URL(b);
    return (
      urlA.origin === urlB.origin &&
      urlA.pathname.replace(/\/+$/, "") === urlB.pathname.replace(/\/+$/, "")
    );
  } catch {
    return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
  }
}

async function listAssetsServers(orgId: string) {
  const servers = await listRemoteServers("org", orgId);
  return servers.filter(
    (server) => server.name === SERVER_NAME && server.firstParty === true,
  );
}

async function assertCanManageOrgMcp(orgId: string, userEmail: string) {
  const result = await getDbExec().execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [orgId, userEmail.toLowerCase()],
  });
  const role = String(
    (result.rows[0] as { role?: unknown } | undefined)?.role,
  ).toLowerCase();
  if (role !== "owner" && role !== "admin") {
    throw new Error(
      "Only organization owners and admins can connect org-scoped MCP servers.",
    );
  }
}

export default defineAction({
  description:
    "Connect the first-party Assets MCP server for the active Design organization. Use this explicit setup action instead of mutating onboarding status.",
  schema: z.object({}),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async () => {
    const userEmail = getRequestUserEmail();
    const orgId = getRequestOrgId();
    if (!userEmail || !orgId) {
      throw new Error("You must be signed in to an organization.");
    }
    await assertCanManageOrgMcp(orgId, userEmail);

    const apps = await fetchOrgApps({ selfId: "design" });
    const assets = apps.find((app) => app.id === "assets");
    if (!assets?.url) {
      throw new Error("Could not find the Assets app in this organization.");
    }
    const currentUrl = assetsMcpUrl(assets.url);

    const existingServers = await listAssetsServers(orgId);
    for (const existing of existingServers) {
      const trust = await isFirstPartyRemoteEndpointTrusted(
        orgId,
        "assets",
        existing.url,
      );
      if (trust.ok && sameEndpoint(existing.url, currentUrl)) {
        const managerRefreshed = await refreshGlobalMcpManager();
        return {
          ok: true,
          connected: true,
          server: existing,
          managerRefreshed,
          message: "Assets MCP is already connected for this organization.",
        };
      }
    }

    // Verify the target endpoint is trusted before removing any existing
    // server, so a transient org-directory/auth failure cannot turn a reconnect
    // into a full disconnect for the org.
    const targetTrust = await isFirstPartyRemoteEndpointTrusted(
      orgId,
      "assets",
      currentUrl,
    );
    if (!targetTrust.ok) {
      throw new Error(targetTrust.error);
    }

    for (const existing of existingServers) {
      await removeRemoteServer("org", orgId, existing.id);
    }

    const result = await addFirstPartyRemoteServer(orgId, {
      appId: "assets",
      name: SERVER_NAME,
      url: currentUrl,
      description: "First-party Assets MCP server for on-brand media.",
    });
    if (result.ok !== true) {
      throw new Error(result.error);
    }
    const managerRefreshed = await refreshGlobalMcpManager();
    return {
      ok: true,
      connected: true,
      server: result.server,
      managerRefreshed,
      message: "Assets MCP is connected for this organization.",
    };
  },
});
