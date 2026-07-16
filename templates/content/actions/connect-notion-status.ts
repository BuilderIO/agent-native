import { defineAction } from "@agent-native/core";
import { resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

import { getNotionConnectionForOwner } from "../server/lib/notion.js";
import { getCurrentNotionCaller } from "./_notion-action-utils.js";

export default defineAction({
  description: "Check Notion connection status for the current user.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const callerEmail = getCurrentNotionCaller();
    const connection = await getNotionConnectionForOwner(callerEmail);
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
    };
  },
});
