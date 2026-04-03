import { parseArgs, output, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "Reject a candidate's application",
  parameters: {
    type: "object",
    properties: {
      applicationId: {
        type: "string",
        description: "Application ID (required)",
      },
      notes: {
        type: "string",
        description: "Rejection notes",
      },
    },
    required: ["applicationId"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.applicationId) {
    return "Error: --applicationId is required";
  }
  await localFetch(`/api/applications/${args.applicationId}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ notes: args.notes }),
  });
  return `Rejected application ${args.applicationId}.`;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
