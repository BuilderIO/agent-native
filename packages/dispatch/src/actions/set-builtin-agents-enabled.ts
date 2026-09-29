import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listBuiltinApps,
  setBuiltinAppsEnabled,
} from "../server/lib/builtin-apps-store.js";
import { recordAudit } from "../server/lib/dispatch-store.js";

export default defineAction({
  description:
    "Set which built-in first-party apps are enabled for the current organization. Pass the full list of enabled ids; every offered built-in not listed is disabled. Only ids returned by list-builtin-agents are accepted. Org owners and admins only. This controls whether an app is part of the workspace (sidebar, discovery, agent calls); set-mcp-app-access separately controls MCP routing.",
  schema: z.object({
    enabledIds: z
      .array(z.string())
      .describe("Built-in app ids to enable, e.g. ['mail', 'calendar']."),
  }),
  run: async ({ enabledIds }) => {
    const saved = await setBuiltinAppsEnabled(enabledIds);
    await recordAudit({
      action: "builtin-agents.updated",
      targetType: "dispatch-builtin-agents",
      targetId: "builtin-agents",
      summary: `Enabled ${saved.enabledIds.length} of ${saved.offeredCount} built-in app(s)`,
      metadata: { enabledIds: saved.enabledIds },
    }).catch((error) => {
      console.warn("[dispatch] Could not record built-in apps audit", error);
    });
    return listBuiltinApps();
  },
});
