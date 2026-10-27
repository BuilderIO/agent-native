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

export const coreScripts: Record<string, CoreScript> & {
  "save-memory": SaveMemoryScript;
} = {
  ...coreDbScripts,
  ...coreResourceScripts,
  ...coreChatScripts,
  ...coreDocsScripts,
};

export function getCoreScriptNames(): string[] {
  return Object.keys(coreScripts);
}
