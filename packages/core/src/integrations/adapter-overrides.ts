import type { PlatformAdapter } from "./types.js";

export function mergeIntegrationAdapters(
  defaults: readonly PlatformAdapter[],
  overrides: readonly PlatformAdapter[] = [],
): PlatformAdapter[] {
  const merged = new Map(
    defaults.map((adapter) => [adapter.platform, adapter] as const),
  );
  for (const override of overrides) merged.set(override.platform, override);
  return [...merged.values()];
}
