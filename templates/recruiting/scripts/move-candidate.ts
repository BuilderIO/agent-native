import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Move a candidate's application to a specific stage",
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
      toStageId: {
        type: "string",
        description: "Target stage ID (required)",
      },
    },
    required: ["applicationId", "fromStageId", "toStageId"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.applicationId || !args.fromStageId || !args.toStageId) {
    return "Error: --applicationId, --fromStageId, and --toStageId are required";
  }
  await localFetch(`/api/applications/${args.applicationId}/move`, {
    method: "PATCH",
    body: JSON.stringify({
      from_stage_id: Number(args.fromStageId),
      to_stage_id: Number(args.toStageId),
    }),
  });
  return `Moved application ${args.applicationId} to stage ${args.toStageId}.`;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
