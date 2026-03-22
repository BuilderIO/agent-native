import { coreDbScripts } from "./db/index.js";

/**
 * Registry of all core scripts provided by @agent-native/core.
 * The script runner falls back to these when a local script isn't found.
 */
export const coreScripts: Record<string, (args: string[]) => Promise<void>> = {
  ...coreDbScripts,
};

/**
 * Returns the list of core script names for help output.
 */
export function getCoreScriptNames(): string[] {
  return Object.keys(coreScripts);
}
