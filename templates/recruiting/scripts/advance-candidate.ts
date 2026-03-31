import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Advance a candidate's application to the next stage",
  parameters: {
    type: "object",
    properties: {
      applicationId: {
        type: "string",
        description: "Application ID (required)",
      },
      fromStageId: {
        type: "string",
        description: "Current stage ID (required)",
      },
    },
    required: ["applicationId", "fromStageId"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.applicationId || !args.fromStageId) {
    return "Error: --applicationId and --fromStageId are required";
  }
  await localFetch(`/api/applications/${args.applicationId}/advance`, {
    method: "PATCH",
    body: JSON.stringify({ from_stage_id: Number(args.fromStageId) }),
  });
  return `Advanced application ${args.applicationId} to the next stage.`;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
