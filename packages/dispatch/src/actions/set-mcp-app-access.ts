import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { discoverAgents } from "@agent-native/core/server/agent-discovery";
import { setDispatchMcpAppAccessSettings } from "../server/lib/mcp-access-store.js";
import { recordAudit } from "../server/lib/dispatch-store.js";
import listMcpAppAccess from "./list-mcp-app-access.js";

const modeSchema = z.enum(["all-apps", "selected-apps"]);

export default defineAction({
  description:
    "Set which apps are available through Dispatch's unified MCP gateway.",
  schema: z.object({
    mode: modeSchema.describe(
      "Use all-apps to expose every discovered app, or selected-apps to allow only selectedAppIds.",
    ),
    selectedAppIds: z
      .array(z.string())
      .default([])
      .describe("App IDs to expose when mode is selected-apps."),
  }),
  run: async (args) => {
    const agents = await discoverAgents("dispatch");
    const knownIds = new Set(agents.map((agent) => agent.id));
    const selectedAppIds = Array.from(
      new Set(
        args.selectedAppIds
          .map((id) => id.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    const unknown = selectedAppIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown app(s): ${unknown.join(", ")}. Use list-mcp-app-access to see available app IDs.`,
      );
    }
    if (args.mode === "selected-apps" && selectedAppIds.length === 0) {
      throw new Error("selected-apps mode requires at least one app ID.");
    }

    await setDispatchMcpAppAccessSettings({
      mode: args.mode,
      selectedAppIds,
    });
    await recordAudit({
      action: "mcp-access.updated",
      targetType: "dispatch-mcp-access",
      targetId: "unified-mcp",
      summary:
        args.mode === "all-apps"
          ? "Allowed Dispatch MCP access to all apps"
          : `Allowed Dispatch MCP access to ${selectedAppIds.length} selected app(s)`,
      metadata: { mode: args.mode, selectedAppIds },
    }).catch(() => {});

    return listMcpAppAccess.run({});
  },
});
