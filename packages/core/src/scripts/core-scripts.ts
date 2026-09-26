import { coreChatScripts } from "./chat/index.js";
import { coreDbScripts } from "./db/index.js";
import { coreDocsScripts } from "./docs/index.js";
import { coreResourceScripts } from "./resources/index.js";
import type { SaveMemoryScriptOptions } from "./resources/save-memory.js";

type CoreScript = (args: string[]) => Promise<void>;
type SaveMemoryScript = (
  args: string[],
  options?: SaveMemoryScriptOptions,
) => Promise<void>;

/**
 * Registry of all core scripts provided by @agent-native/core.
 * The script runner falls back to these when a local script isn't found.
 */
export const coreScripts: Record<string, CoreScript> & {
  "save-memory": SaveMemoryScript;
} = {
  ...coreDbScripts,
  ...coreResourceScripts,
  ...coreChatScripts,
  ...coreDocsScripts,
};

/**
 * Returns the list of core script names for help output.
 */
export function getCoreScriptNames(): string[] {
  return Object.keys(coreScripts);
}
