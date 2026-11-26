import { isOutsideAgentCall } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { runMonitorNow } from "../server/lib/uptime-monitors";

export default defineAction({
  description:
    "Run one uptime check now for a monitor. Probes the URL, records the result, opens/resolves incidents, and returns the outcome.",
  schema: z.object({
    id: z.string().describe("Monitor id to check now."),
  }),
  http: { method: "POST" },
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  grounding: true,
  run: async ({ id }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return runMonitorNow(id, { email, orgId });
  },
});
