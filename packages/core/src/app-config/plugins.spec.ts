import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PLUGIN_REGISTRY } from "../deploy/route-discovery.js";
import { DEFAULT_PLUGIN_SLOTS } from "./plugins.js";
import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "./store.js";

const originalEnv = { ...process.env };

describe("plugins config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.AGENT_NATIVE_DISABLED_PLUGINS;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  // The enum is spelled out in the schema so it stays edge-safe, which only
  // works if a new default plugin slot fails here instead of quietly becoming
  // the one plugin nobody can turn off.
  it("covers every slot in DEFAULT_PLUGIN_REGISTRY", () => {
    expect([...DEFAULT_PLUGIN_SLOTS].sort()).toEqual(
      Object.keys(DEFAULT_PLUGIN_REGISTRY).sort(),
    );
  });

  it("defaults to refusing nothing", () => {
    expect(getAppConfig().plugins.disabled).toEqual([]);
  });

  it("reads a comma-separated environment alias", () => {
    process.env.AGENT_NATIVE_DISABLED_PLUGINS = "terminal, integrations";
    expect(getAppConfig().plugins.disabled).toEqual([
      "terminal",
      "integrations",
    ]);
  });

  it("rejects a slot name that does not exist", () => {
    process.env.AGENT_NATIVE_DISABLED_PLUGINS = "termnial";
    expect(() => getAppConfig()).toThrow();
  });

  it("lets an explicit value win over the environment alias", () => {
    process.env.AGENT_NATIVE_DISABLED_PLUGINS = "terminal";
    defineAppConfig({ plugins: { disabled: [] } });
    expect(getAppConfig().plugins.disabled).toEqual([]);
  });
});
