import { DEFAULT_MCP_INTEGRATIONS } from "@agent-native/core/client/resources";
import { describe, expect, it } from "vitest";

import { credentialProviderConfigs } from "../../server/lib/credential-keys";
import { dataSources } from "./data-sources";
import { ANALYTICS_NATIVE_MCP_PRESET_EXCLUSIONS } from "./native-mcp-exclusions";

function normalizeProviderName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

describe("Analytics native MCP exclusions", () => {
  it("excludes every default MCP preset that overlaps a native data source or provider", () => {
    const nativeProviderNames = new Set(
      [
        ...dataSources.flatMap((source) => [source.id, source.name]),
        ...credentialProviderConfigs.flatMap((provider) => [
          provider.provider,
          provider.label,
        ]),
      ].map(normalizeProviderName),
    );
    const collidingPresetIds = DEFAULT_MCP_INTEGRATIONS.filter((preset) =>
      [
        preset.id,
        preset.name,
        preset.provider,
        ...(preset.brandAliases ?? []),
        ...(preset.aliases ?? []),
      ].some((name) => nativeProviderNames.has(normalizeProviderName(name))),
    )
      .map((preset) => preset.id)
      .sort();

    expect([...ANALYTICS_NATIVE_MCP_PRESET_EXCLUSIONS].sort()).toEqual(
      collidingPresetIds,
    );
  });
});
