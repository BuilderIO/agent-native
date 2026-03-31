import { parseArgs, output } from "./helpers.js";
import {
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Force the UI to refresh all data from Greenhouse. Call after mutations.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(): Promise<string> {
  // Write a refresh signal that the UI's file watcher will pick up
  await writeAppState("refresh-trigger", { ts: Date.now() });
  // Clean up immediately
  await deleteAppState("refresh-trigger");
  return "UI data refresh triggered.";
}

export default async function main(): Promise<void> {
  const result = await run();
  console.log(result);
}
