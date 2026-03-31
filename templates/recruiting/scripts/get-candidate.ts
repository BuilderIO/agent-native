import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Get full details about a specific candidate",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Candidate ID (required)" },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.id) return "Error: --id is required";
  const candidate = await localFetch<any>(`/api/candidates/${args.id}`);
  return JSON.stringify(candidate, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
