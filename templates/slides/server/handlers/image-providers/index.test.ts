import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  choice: null as string | null,
  configured: new Set<string>(),
}));

vi.mock("@agent-native/core/server", () => ({
  readServiceProviderChoice: vi.fn(async () => state.choice),
  serviceProviderOrder: (_service: string, choice: string | null) => {
    const defaults = ["builder", "gemini", "openai"];
    return choice
      ? [choice, ...defaults.filter((provider) => provider !== choice)]
      : defaults;
  },
}));

vi.mock("./gemini.js", () => ({
  GeminiProvider: class {
    name = "gemini";
    isConfigured = () => false;
    isConfiguredForRequest = async () => state.configured.has("gemini");
  },
}));

vi.mock("./openai.js", () => ({
  OpenAIProvider: class {
    name = "openai";
    isConfigured = () => false;
    isConfiguredForRequest = async () => state.configured.has("openai");
  },
}));

const { getProvider } = await import("./index.js");

describe("getProvider auto", () => {
  beforeEach(() => {
    state.choice = null;
    state.configured = new Set(["gemini", "openai"]);
  });

  it("prefers Gemini, then OpenAI, when the organization hasn't chosen", async () => {
    await expect(getProvider("auto")).resolves.toMatchObject({
      name: "gemini",
    });
    state.configured.delete("gemini");
    await expect(getProvider()).resolves.toMatchObject({ name: "openai" });
  });

  it("uses the organization's Image generation choice first", async () => {
    state.choice = "openai";
    await expect(getProvider("auto")).resolves.toMatchObject({
      name: "openai",
    });
  });

  it("skips Builder.io and a chosen provider without a key", async () => {
    state.choice = "builder";
    await expect(getProvider("auto")).resolves.toMatchObject({
      name: "gemini",
    });
    state.choice = "openai";
    state.configured.delete("openai");
    await expect(getProvider("auto")).resolves.toMatchObject({
      name: "gemini",
    });
  });

  it("keeps an explicit provider strict", async () => {
    state.choice = "openai";
    await expect(getProvider("gemini")).resolves.toMatchObject({
      name: "gemini",
    });
  });
});
