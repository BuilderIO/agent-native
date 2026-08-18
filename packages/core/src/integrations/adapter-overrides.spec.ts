import { describe, expect, it } from "vitest";

import { mergeIntegrationAdapters } from "./adapter-overrides.js";
import {
  BUILT_IN_INTEGRATION_ADAPTER_FACTORIES,
  BUILT_IN_INTEGRATION_ADAPTER_IDS,
  createBuiltInIntegrationAdapters,
  createIntegrationsPlugin,
} from "./plugin.js";
import type { PlatformAdapter } from "./types.js";

function adapter(platform: string, label = platform): PlatformAdapter {
  return { platform, label } as PlatformAdapter;
}

describe("integration adapter overrides", () => {
  it("keeps the public built-in inventory aligned with runtime defaults", () => {
    expect(BUILT_IN_INTEGRATION_ADAPTER_IDS).toEqual(
      BUILT_IN_INTEGRATION_ADAPTER_FACTORIES.map(({ platform }) => platform),
    );
    expect(
      createBuiltInIntegrationAdapters().map(({ platform }) => platform),
    ).toEqual(BUILT_IN_INTEGRATION_ADAPTER_IDS);
  });

  it("replaces one built-in without dropping or reordering the others", () => {
    const slack = adapter("slack", "Built-in Slack");
    const teams = adapter("microsoft-teams");
    const customSlack = adapter("slack", "App Slack");

    expect(mergeIntegrationAdapters([slack, teams], [customSlack])).toEqual([
      customSlack,
      teams,
    ]);
  });

  it("appends adapters for new platforms", () => {
    const slack = adapter("slack");
    const custom = adapter("custom");

    expect(mergeIntegrationAdapters([slack], [custom])).toEqual([
      slack,
      custom,
    ]);
  });

  it("keeps full replacement explicit", () => {
    expect(() =>
      createIntegrationsPlugin({
        adapters: [],
        adapterOverrides: [],
      }),
    ).toThrow(/either adapters.*adapterOverrides/i);
  });
});
