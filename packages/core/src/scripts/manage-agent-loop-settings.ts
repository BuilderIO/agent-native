/**
 * manage-agent-loop-settings — inspect or update the agent loop step limit.
 */

import type { ActionTool } from "../agent/types.js";
import {
  canUpdateAgentLoopSettings,
  readAgentLoopSettings,
  resetAgentLoopSettings,
  validateMaxIterationsInput,
  writeAgentLoopSettings,
} from "../agent/loop-settings.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";

export const tool: ActionTool = {
  description:
    'Manage the maximum number of agent loop iterations before the agent pauses and asks whether to keep going. Pass action="get" to inspect, action="set" with maxIterations to update the active org/user setting, or action="reset" to return to default.',
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["get", "set", "reset"],
        description:
          '"get" — show the current limit. "set" — update maxIterations. "reset" — clear the saved override.',
      },
      maxIterations: {
        type: "string",
        description:
          "(set) Integer step limit. Applies to the active organization when one is selected; otherwise applies to the current user.",
      },
    },
    required: ["action"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const action = args.action || "get";
  const userEmail = getRequestUserEmail();
  if (!userEmail) {
    return JSON.stringify({ error: "Authentication required" });
  }

  const orgId = getRequestOrgId() ?? null;
  const ctx = { userEmail, orgId };

  if (action === "get") {
    const [settings, canUpdate] = await Promise.all([
      readAgentLoopSettings(ctx),
      canUpdateAgentLoopSettings(userEmail, orgId),
    ]);
    return JSON.stringify({ ...settings, canUpdate, orgId }, null, 2);
  }

  const canUpdate = await canUpdateAgentLoopSettings(userEmail, orgId);
  if (!canUpdate) {
    return JSON.stringify({
      error: orgId
        ? "Only organization owners and admins can change the agent step limit."
        : "You cannot change the agent step limit.",
    });
  }

  if (action === "set") {
    const validation = validateMaxIterationsInput(args.maxIterations);
    if (validation.ok !== true) {
      return JSON.stringify({ error: validation.error });
    }
    const settings = await writeAgentLoopSettings(ctx, validation.value);
    return JSON.stringify({ ...settings, canUpdate, orgId }, null, 2);
  }

  if (action === "reset") {
    const settings = await resetAgentLoopSettings(ctx);
    return JSON.stringify({ ...settings, canUpdate, orgId }, null, 2);
  }

  return JSON.stringify({
    error: `Unknown action "${action}". Must be one of: get, set, reset.`,
  });
}
