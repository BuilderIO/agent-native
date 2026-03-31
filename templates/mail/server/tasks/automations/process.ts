import { processAutomations } from "../../lib/automation-engine.js";

/**
 * Process automation rules against new inbox emails.
 * Called every 60 seconds from the Nitro scheduled task.
 */
export async function processAutomationRules(): Promise<{ result: string }> {
  const { result } = await processAutomations();
  return { result };
}
