import { beforeEach, describe, expect, it, vi } from "vitest";

// The engine registry and the applied-selection memo are both module-level, so
// every case re-imports through a fresh module graph.
async function load() {
  vi.resetModules();
  const appConfig = await import("../../app-config/index.js");
  appConfig.resetAppConfigForTests();
  const builtin = await import("./builtin.js");
  const registry = await import("./registry.js");
  return { ...appConfig, ...builtin, ...registry };
}

describe("registerBuiltinEngines selection", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_BUILT_IN_ENGINES;
  });

  it("registers every built-in when agent.builtInEngines is unset", async () => {
    const { registerBuiltinEngines, listAgentEngines, BUILT_IN_ENGINE_NAMES } =
      await load();

    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toEqual([
      ...BUILT_IN_ENGINE_NAMES,
    ]);
  });

  it("registers only the selected built-ins", async () => {
    const { defineAppConfig, registerBuiltinEngines, listAgentEngines } =
      await load();
    defineAppConfig({ agent: { builtInEngines: ["ai-sdk:openai"] } });

    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toEqual([
      "ai-sdk:openai",
    ]);
  });

  it("skips the rest, so an unselected engine is not resolvable by name", async () => {
    const { defineAppConfig, registerBuiltinEngines, getAgentEngineEntry } =
      await load();
    defineAppConfig({ agent: { builtInEngines: ["ai-sdk:openai"] } });

    registerBuiltinEngines();

    expect(getAgentEngineEntry("ai-sdk:openai")).toBeDefined();
    expect(getAgentEngineEntry("anthropic")).toBeUndefined();
    expect(getAgentEngineEntry("builder")).toBeUndefined();
  });

  it("keeps declared registration order, not selection order", async () => {
    const { defineAppConfig, registerBuiltinEngines, listAgentEngines } =
      await load();
    // Builder is last in the selection but must still be detected first.
    defineAppConfig({
      agent: { builtInEngines: ["ai-sdk:openai", "builder"] },
    });

    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toEqual([
      "builder",
      "ai-sdk:openai",
    ]);
  });

  it("reads the selection from AGENT_BUILT_IN_ENGINES", async () => {
    vi.stubEnv("AGENT_BUILT_IN_ENGINES", "anthropic, ai-sdk:openai");
    const { registerBuiltinEngines, listAgentEngines } = await load();

    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toEqual([
      "anthropic",
      "ai-sdk:openai",
    ]);
  });

  it("lets defineAppConfig beat the env alias", async () => {
    vi.stubEnv("AGENT_BUILT_IN_ENGINES", "anthropic");
    const { defineAppConfig, registerBuiltinEngines, listAgentEngines } =
      await load();
    defineAppConfig({ agent: { builtInEngines: ["ai-sdk:openai"] } });

    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toEqual([
      "ai-sdk:openai",
    ]);
  });

  it("rejects an unknown engine name instead of ignoring it", async () => {
    const { defineAppConfig, registerBuiltinEngines, AppConfigurationError } =
      await load();
    defineAppConfig({ agent: { builtInEngines: ["ai-sdk:opnai"] } });

    expect(() => registerBuiltinEngines()).toThrow(AppConfigurationError);
    expect(() => registerBuiltinEngines()).toThrow(/ai-sdk:opnai/);
  });

  it("rejects an empty selection at the call site that set it", async () => {
    const { defineAppConfig } = await load();

    expect(() => defineAppConfig({ agent: { builtInEngines: [] } })).toThrow();
  });

  it("drops built-ins a later defineAppConfig deselected", async () => {
    const { defineAppConfig, registerBuiltinEngines, listAgentEngines } =
      await load();
    // A module-level registerBuiltinEngines() can run before the app's config
    // plugin is loaded; the late selection still has to win.
    registerBuiltinEngines();
    expect(listAgentEngines().length).toBeGreaterThan(1);

    defineAppConfig({ agent: { builtInEngines: ["ai-sdk:openai"] } });
    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toEqual([
      "ai-sdk:openai",
    ]);
  });

  it("leaves engines registered by an app alone", async () => {
    const {
      defineAppConfig,
      registerAgentEngine,
      registerBuiltinEngines,
      listAgentEngines,
    } = await load();
    defineAppConfig({ agent: { builtInEngines: ["ai-sdk:openai"] } });
    registerBuiltinEngines();

    registerAgentEngine({
      name: "custom",
      label: "Custom",
      description: "App-registered engine.",
      capabilities: {} as any,
      defaultModel: "custom-1",
      supportedModels: ["custom-1"],
      requiredEnvVars: [],
      create: () => ({}) as any,
    });
    registerBuiltinEngines();

    expect(listAgentEngines().map((entry) => entry.name)).toContain("custom");
  });
});
