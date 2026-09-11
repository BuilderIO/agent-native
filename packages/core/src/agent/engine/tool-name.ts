import type { EngineMessage, EngineTool } from "./types.js";

export const PROVIDER_TOOL_NAME_MAX_LENGTH = 64;

export interface ProviderToolNameMap {
  toEngine: ReadonlyMap<string, string>;
  toProvider: ReadonlyMap<string, string>;
}

function hashToolName(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function providerToolAlias(name: string): string {
  return `tool_${hashToolName(name, 2166136261)}_${hashToolName(name, 16777619)}`;
}

function toolNamesFromMessages(messages: readonly EngineMessage[]): string[] {
  return messages.flatMap((message) =>
    message.content.flatMap((part) => {
      if (part.type === "tool-call") return [part.name];
      if (part.type === "tool-result") return [part.toolName];
      return [];
    }),
  );
}

export function createProviderToolNameMap(
  tools: readonly EngineTool[],
  messages: readonly EngineMessage[] = [],
): ProviderToolNameMap {
  const names = new Set([
    ...tools.map((tool) => tool.name),
    ...toolNamesFromMessages(messages),
  ]);
  const usedProviderNames = new Set(
    [...names].filter((name) => name.length <= PROVIDER_TOOL_NAME_MAX_LENGTH),
  );
  const toProvider = new Map<string, string>();
  const toEngine = new Map<string, string>();

  for (const name of names) {
    if (name.length <= PROVIDER_TOOL_NAME_MAX_LENGTH) {
      toProvider.set(name, name);
      toEngine.set(name, name);
      continue;
    }

    const base = providerToolAlias(name);
    let alias = base;
    let suffix = 1;
    while (usedProviderNames.has(alias)) {
      alias = `${base}_${suffix}`;
      suffix += 1;
    }
    usedProviderNames.add(alias);
    toProvider.set(name, alias);
    toEngine.set(alias, name);
  }

  return { toEngine, toProvider };
}

export function toProviderToolName(
  name: string,
  map?: ProviderToolNameMap,
): string {
  if (name.length <= PROVIDER_TOOL_NAME_MAX_LENGTH) return name;
  return map?.toProvider.get(name) ?? providerToolAlias(name);
}

export function toEngineToolName(
  name: string,
  map?: ProviderToolNameMap,
): string {
  return map?.toEngine.get(name) ?? name;
}
