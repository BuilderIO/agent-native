import { defineAction } from "@agent-native/core/action";
import { findConnectedMcpServersForProvider } from "@agent-native/core/mcp-client";
import { getRequestOrgId, resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

import { getNotionConnectionForOwner } from "../server/lib/notion.js";
import type { NotionConnectionStatus } from "../shared/api.js";
import { getCurrentNotionOwner } from "./_notion-action-utils.js";

export default defineAction({
  description:
    "Check Notion connection status for the current user. Notion can be " +
    "connected two independent ways and they do not imply each other: " +
    "`connected` covers the Notion account Content links and syncs documents " +
    "with, and `mcp.connected` covers the Notion MCP server that supplies " +
    "your Notion tools. Answer the user from `statusSummary` rather than from " +
    "`connected` alone, and never say Notion is disconnected while " +
    "`mcp.connected` is true.",
  deferLoading: false,
  schema: z.object({}),
  http: { method: "GET" },
  run: async (): Promise<NotionConnectionStatus> => {
    const owner = getCurrentNotionOwner();
    const [connection, mcp] = await Promise.all([
      getNotionConnectionForOwner(owner),
      findConnectedMcpServersForProvider({
        providerId: "notion",
        userEmail: owner,
        orgId: getRequestOrgId() ?? null,
      }),
    ]);
    const hasOAuthCredentials = Boolean(
      (await resolveSecret("NOTION_CLIENT_ID")) &&
      (await resolveSecret("NOTION_CLIENT_SECRET")),
    );

    return {
      connected: Boolean(connection),
      workspaceName: connection?.workspaceName ?? null,
      workspaceId: connection?.workspaceId ?? null,
      authUrl: null,
      error:
        connection || hasOAuthCredentials ? undefined : "missing_credentials",
      mode: connection ? ("oauth" as const) : null,
      mcp: {
        connected: mcp.servers.length > 0,
        servers: mcp.servers,
        unreadableScopes: mcp.unreadableScopes,
      },
      statusSummary: describeNotionStatus({
        oauthConnected: Boolean(connection),
        workspaceName: connection?.workspaceName ?? null,
        mcpServerCount: mcp.servers.length,
        unreadableScopes: mcp.unreadableScopes,
      }),
    };
  },
});

function describeNotionStatus(input: {
  oauthConnected: boolean;
  workspaceName: string | null;
  mcpServerCount: number;
  unreadableScopes: string[];
}): string {
  const parts: string[] = [];
  const workspace = input.workspaceName ? ` (${input.workspaceName})` : "";

  if (input.oauthConnected) {
    parts.push(
      `The Notion account is connected${workspace}, so linking and syncing Content documents works.`,
    );
  } else {
    parts.push(
      "The Notion account is not connected, so linking and syncing Content documents is unavailable.",
    );
  }

  if (input.mcpServerCount > 0) {
    parts.push(
      `The Notion MCP server is connected (${input.mcpServerCount} saved), so your Notion tools are available.`,
    );
  } else if (input.unreadableScopes.length > 0) {
    parts.push(
      `Notion MCP status is unknown: the ${input.unreadableScopes.join(
        " and ",
      )} MCP server list could not be read.`,
    );
  } else {
    parts.push("No Notion MCP server is connected.");
  }

  if (!input.oauthConnected && input.mcpServerCount > 0) {
    parts.push(
      "These are separate connections: connecting Notion under Settings > Integrations does not connect the Notion account Content syncs with.",
    );
  }

  return parts.join(" ");
}
