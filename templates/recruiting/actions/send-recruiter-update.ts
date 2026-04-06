import { parseArgs, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Send a recruiting pipeline status update to the configured Slack channel. Includes overdue scorecards, recent feedback, and stuck candidates. Requires Slack webhook to be configured in Settings.",
  parameters: {
    type: "object",
    properties: {
      customMessage: {
        type: "string",
        description:
          "Optional custom message to include at the top of the update",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  // Check Slack is configured before expensive Greenhouse API calls
  const status = await localFetch<any>("/api/notifications/status");
  if (!status.configured || !status.enabled) {
    return JSON.stringify({
      error:
        "Slack notifications not configured. Go to Settings to add a webhook URL.",
    });
  }

  // Fetch action items data (triggers multiple Greenhouse API calls)
  const actionItems = await localFetch<any>("/api/action-items");

  // Send the update
  const result = await localFetch<any>("/api/notifications/send", {
    method: "POST",
    body: JSON.stringify({
      actionItems,
      customMessage: args.customMessage,
    }),
  });

  return JSON.stringify(result, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
