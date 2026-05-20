import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDispatchMcpApps } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "List the apps exposed through Dispatch's unified MCP gateway and the current app access policy.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const { settings, apps } = await listDispatchMcpApps();
    return {
      mode: settings.mode,
      selectedAppIds: settings.selectedAppIds,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
      apps,
      grantedApps: apps.filter((app) => app.granted),
      counts: {
        apps: apps.length,
        granted: apps.filter((app) => app.granted).length,
      },
    };
  },
});
