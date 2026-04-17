import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import {
  jiraGetTransitions,
  jiraDoTransition,
} from "../server/lib/jira-api.js";

export default defineAction({
  description: "Change the status of a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key"),
    status: z
      .string()
      .optional()
      .describe("Target status name (e.g. 'In Progress', 'Done')"),
    transitionId: z
      .string()
      .optional()
      .describe("Transition ID (used by frontend, bypasses status lookup)"),
  }),
  run: async (args) => {
    const { key, status, transitionId } = args;

    if (!key) throw new Error("key is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    // If transitionId is provided directly (from frontend), use it
    if (transitionId) {
      await jiraDoTransition(
        client.cloudId,
        client.accessToken,
        key,
        transitionId,
      );
      return { success: true };
    }

    // Otherwise look up by status name (agent path)
    if (!status) throw new Error("status or transitionId is required");

    const transitionsData = await jiraGetTransitions(
      client.cloudId,
      client.accessToken,
      key,
    );

    const transitions = transitionsData.transitions || [];
    const target = status.toLowerCase();
    const transition = transitions.find(
      (t: any) =>
        t.name.toLowerCase() === target || t.to?.name?.toLowerCase() === target,
    );

    if (!transition) {
      const available = transitions.map((t: any) => t.name).join(", ");
      throw new Error(
        `No transition found for "${status}". Available: ${available}`,
      );
    }

    await jiraDoTransition(
      client.cloudId,
      client.accessToken,
      key,
      transition.id,
    );
    return { success: true };
  },
});
