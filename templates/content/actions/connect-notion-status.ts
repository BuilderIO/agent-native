import { defineAction } from "@agent-native/core";
import { getNotionConnectionForOwner } from "../server/lib/notion.js";

export default defineAction({
  description: "Check Notion connection status for the current user.",
  http: false,
  run: async () => {
    const owner = process.env.AGENT_USER_EMAIL || "local@localhost";
    const connection = await getNotionConnectionForOwner(owner);
    return {
      connected: Boolean(connection),
      workspaceName: connection?.workspaceName ?? null,
      workspaceId: connection?.workspaceId ?? null,
    };
  },
});
