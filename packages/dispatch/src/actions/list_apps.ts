import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listGrantedDispatchMcpApps } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    'List the apps this Dispatch MCP gateway can route to, including "dispatch" itself for Dispatch-owned pages such as extensions. The result is filtered by Dispatch\'s MCP app access policy.',
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async () => {
    const apps = await listGrantedDispatchMcpApps();
    const appSummaries = apps.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      url: app.url,
      running: true,
      source: "dispatch-mcp-grant",
    }));
    return {
      workspace: true,
      gateway: "dispatch",
      apps: appSummaries,
      message: JSON.stringify({
        apps: appSummaries.map(({ id, name }) => ({ id, name })),
      }),
    };
  },
});
