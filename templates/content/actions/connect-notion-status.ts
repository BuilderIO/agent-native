import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getNotionConnectionForOwner } from "../server/lib/notion.js";

export default defineAction({
  description: "Check Notion connection status for the current user.",
  http: false,
  run: async () => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");
    const connection = await getNotionConnectionForOwner(owner);
    return {
      connected: Boolean(connection),
      workspaceName: connection?.workspaceName ?? null,
      workspaceId: connection?.workspaceId ?? null,
    };
  },
});
