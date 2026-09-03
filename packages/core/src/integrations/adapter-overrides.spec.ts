import { afterEach, describe, expect, it } from "vitest";

import {
  AppConfigurationError,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { mergeIntegrationAdapters } from "./adapter-overrides.js";
import {
  applyConfiguredPlatformAllowList,
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

describe("integrations.platforms allow-list", () => {
  afterEach(() => {
    delete process.env.AGENT_NATIVE_INTEGRATION_PLATFORMS;
    resetAppConfigForTests();
  });

  it("mounts every adapter when no allow-list is declared", () => {
    const adapters = [adapter("slack"), adapter("email")];
    expect(applyConfiguredPlatformAllowList(adapters)).toEqual(adapters);
  });

  it("keeps only the named platforms", () => {
    process.env.AGENT_NATIVE_INTEGRATION_PLATFORMS = "slack, email";
    resetAppConfigForTests();

    expect(
      applyConfiguredPlatformAllowList(createBuiltInIntegrationAdapters()).map(
        ({ platform }) => platform,
      ),
    ).toEqual(["slack", "email"]);
  });

  it("throws on a platform no adapter provides", () => {
    process.env.AGENT_NATIVE_INTEGRATION_PLATFORMS = "slakc";
    resetAppConfigForTests();

    // Typed so the best-effort plugin auto-mount catch rethrows it instead of
    // leaving the deployment with no integrations routes and a warning.
    expect(() =>
      applyConfiguredPlatformAllowList(createBuiltInIntegrationAdapters()),
    ).toThrow(AppConfigurationError);
    expect(() =>
      applyConfiguredPlatformAllowList(createBuiltInIntegrationAdapters()),
    ).toThrow(/slakc/);
  });
});
