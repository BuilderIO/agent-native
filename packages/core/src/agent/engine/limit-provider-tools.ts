import type { EngineTool } from "./types.js";

export const MAX_PROVIDER_TOOLS = 128;
const DEFAULT_PRESERVED_TOOL_NAMES = ["tool-search"] as const;

export function limitProviderTools(
  tools: readonly EngineTool[],
  preserveNames: readonly string[] = DEFAULT_PRESERVED_TOOL_NAMES,
): EngineTool[] {
  if (tools.length <= MAX_PROVIDER_TOOLS) return tools as EngineTool[];

  const preservedNames = new Set(preserveNames);
  const seen = new Set<string>();
  const limited: EngineTool[] = [];

  for (const tool of tools) {
    if (!preservedNames.has(tool.name) || seen.has(tool.name)) continue;
    limited.push(tool);
    seen.add(tool.name);
  }

  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    limited.push(tool);
    if (limited.length === MAX_PROVIDER_TOOLS) return limited;
  }

  return limited.slice(0, MAX_PROVIDER_TOOLS);
}
