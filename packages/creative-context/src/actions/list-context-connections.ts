import { defineAction } from "@agent-native/core/action";
import { listWorkspaceConnectionsForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { getCreativeContext } from "../server/context.js";

const CREATIVE_CONTEXT_LIBRARY_PATH = "/agent#library";

export function creativeContextConnectionPath(input: {
  provider: "google_drive" | "figma" | "notion";
  appId: string;
}): string {
  const query = new URLSearchParams({
    appId: input.appId,
    return: CREATIVE_CONTEXT_LIBRARY_PATH,
  });
  return `/_agent-native/connections/oauth/${input.provider}/start?${query}`;
}

export default defineAction({
  description:
    "List active workspace connections explicitly available to the consuming app for creative-context source setup.",
  schema: z.object({
    provider: z.enum(["google_drive", "figma", "notion"]),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ provider }) => {
    const appId = getCreativeContext().connectorContext.appId;
    const available = await listWorkspaceConnectionsForApp({ appId, provider });
    const connections = available
      .filter((connection) => connection.status === "connected")
      .map((connection) => ({
        connectionId: connection.id,
        provider: connection.provider,
        label: connection.accountLabel ?? connection.label,
      }));
    return {
      appId,
      provider,
      connections,
      autoSelectedConnectionId:
        connections.length === 1 ? connections[0]!.connectionId : null,
      needsPicker: connections.length > 1,
      needsSetup: connections.length === 0,
      connectionsPath: "/settings/connections",
      connectPath: creativeContextConnectionPath({ provider, appId }),
    };
  },
});
