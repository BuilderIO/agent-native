import { describe, it, expect, beforeEach, vi } from "vitest";

// Registry uses a module-level Map — reset between tests by re-importing
// with a fresh module via vi.resetModules().
describe("AgentEngine registry", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear env vars that influence resolveEngine
    delete process.env.AGENT_ENGINE;
  });

  it("registers and retrieves an engine", async () => {
    const { registerAgentEngine, getAgentEngineEntry } =
      await import("./registry.js");

    const fakeEngine = { name: "test", stream: vi.fn() } as any;
    registerAgentEngine({
      name: "test-engine",
      label: "Test",
      description: "A test engine",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      requiredEnvVars: [],
      create: () => fakeEngine,
    });

    const entry = getAgentEngineEntry("test-engine");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Test");
  });

  it("listAgentEngines returns all registered entries", async () => {
    const { registerAgentEngine, listAgentEngines } =
      await import("./registry.js");

    registerAgentEngine({
      name: "engine-a",
      label: "A",
      description: "",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "a",
      supportedModels: ["a"],
      requiredEnvVars: [],
      create: () => ({
        name: "engine-a",
        label: "A",
        defaultModel: "a",
        supportedModels: [],
        capabilities: {} as any,
        stream: vi.fn(),
      }),
    });

    const list = listAgentEngines();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.find((e) => e.name === "engine-a")).toBeDefined();
  });

  it("resolveEngine uses explicit AgentEngine instance directly", async () => {
    const { resolveEngine } = await import("./registry.js");

    const fakeEngine = {
      name: "direct",
      label: "Direct",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const resolved = await resolveEngine({ engineOption: fakeEngine });
    expect(resolved).toBe(fakeEngine);
  });

  it("resolveEngine falls back to default anthropic when nothing configured", async () => {
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");

    const fakeAnthropicEngine = {
      name: "anthropic",
      label: "Anthropic",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const createFn = vi.fn().mockReturnValue(fakeAnthropicEngine);

    registerAgentEngine({
      name: "anthropic",
      label: "Claude",
      description: "",
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: true,
        parallelToolCalls: true,
      },
      defaultModel: "claude-sonnet-4-6",
      supportedModels: ["claude-sonnet-4-6"],
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      create: createFn,
    });

    const resolved = await resolveEngine({});
    expect(createFn).toHaveBeenCalled();
    expect(resolved).toBe(fakeAnthropicEngine);
  });

  it("resolveEngine uses env AGENT_ENGINE when set", async () => {
    const { registerAgentEngine, resolveEngine } =
      await import("./registry.js");

    const fakeEngine = {
      name: "env-engine",
      label: "Env",
      defaultModel: "m",
      supportedModels: [],
      capabilities: {} as any,
      stream: vi.fn(),
    };
    const createFn = vi.fn().mockReturnValue(fakeEngine);

    registerAgentEngine({
      name: "env-engine",
      label: "Env",
      description: "",
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      defaultModel: "m",
      supportedModels: [],
      requiredEnvVars: [],
      create: createFn,
    });

    // Also register anthropic so the fallback doesn't throw
    registerAgentEngine({
      name: "anthropic",
      label: "Claude",
      description: "",
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: true,
        parallelToolCalls: true,
      },
      defaultModel: "claude-sonnet-4-6",
      supportedModels: [],
      requiredEnvVars: [],
      create: vi.fn().mockReturnValue(fakeEngine),
    });

    process.env.AGENT_ENGINE = "env-engine";
    const resolved = await resolveEngine({});
    expect(createFn).toHaveBeenCalled();
    expect(resolved).toBe(fakeEngine);
  });
});
