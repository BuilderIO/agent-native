import { parseArgs, output } from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view, job, candidate, and search state. Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(): Promise<string> {
  const nav = await readAppState("navigation");
  return JSON.stringify(nav || { view: "dashboard" }, null, 2);
}

export default async function main(): Promise<void> {
  const result = await run();
  console.log(result);
}
