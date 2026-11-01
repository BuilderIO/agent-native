import { defineAction, NoWriteError } from "@agent-native/core/action";
import { fetchOrgAppsResult } from "@agent-native/core/mcp";
import {
  addFirstPartyRemoteServer,
  isFirstPartyRemoteEndpointTrusted,
  listRemoteServers,
  removeRemoteServer,
} from "@agent-native/core/mcp-client";
import {
  readOrgMemberRole,
  refreshMcpManagerForPrincipal,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

const SERVER_NAME = "assets";

function assetsMcpUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/mcp`;
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
  const role = await readOrgMemberRole(orgId, userEmail);
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

    const directory = await fetchOrgAppsResult({ selfId: "design" });
    if (directory.status === "unavailable") {
      throw new NoWriteError(
        `The organization app directory is unavailable (${directory.reason}), so Assets could not be checked. Restore directory access and retry.`,
        {
          errorCode: "org_app_directory_unavailable",
          statusCode: 503,
          details: { reason: directory.reason },
        },
      );
    }

    const assets = directory.apps.find((app) => app.id === "assets");
    if (!assets?.url) {
      throw new NoWriteError("Assets is not listed in this organization.", {
        errorCode: "assets_app_not_available",
        statusCode: 404,
      });
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
        const managerRefreshed = await refreshMcpManagerForPrincipal({
          userEmail,
          orgId,
        });
        return {
          ok: true,
          connected: true,
          server: existing,
          managerRefreshed,
          message: "Assets MCP is already connected for this organization.",
        };
      }
    }

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
    const managerRefreshed = await refreshMcpManagerForPrincipal({
      userEmail,
      orgId,
    });
    return {
      ok: true,
      connected: true,
      server: result.server,
      managerRefreshed,
      message: "Assets MCP is connected for this organization.",
    };
  },
});
