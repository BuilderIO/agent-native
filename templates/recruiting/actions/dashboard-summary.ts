import { parseArgs, output, localFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "Get a summary of dashboard statistics",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(): Promise<string> {
  const stats = await localFetch<any>("/api/dashboard");
  return JSON.stringify(stats, null, 2);
}

export default async function main(): Promise<void> {
  const result = await run();
  console.log(result);
}
