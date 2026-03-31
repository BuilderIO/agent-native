/**
 * Trigger automation processing to run now against new inbox emails.
 *
 * Usage:
 *   pnpm script trigger-automations
 */

import { parseArgs, output } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Trigger automation processing to run now against new inbox emails. Automations normally run every minute on a cron, but this forces immediate processing.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(_args: Record<string, string>): Promise<string> {
  const { triggerAutomationsDebounced } =
    await import("../server/lib/automation-engine.js");

  const result = await triggerAutomationsDebounced();
  if (result.triggered) {
    return "Automation processing triggered. Results will be applied shortly.";
  }
  return `Automation processing skipped: ${result.reason}. Try again in 30 seconds.`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  const result = await run(args);
  console.error(result);
  output({ result });
}
