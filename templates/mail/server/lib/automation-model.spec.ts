import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  isResolvedEngineUsableForRequest: vi.fn(),
  registerBuiltinEngines: vi.fn(),
  resolveEngine: vi.fn(),
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  isResolvedEngineUsableForRequest: mocks.isResolvedEngineUsableForRequest,
  readDefaultAgentEngineSetting: mocks.getSetting,
  registerBuiltinEngines: mocks.registerBuiltinEngines,
  resolveEngine: mocks.resolveEngine,
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

import {
  DEFAULT_AUTOMATION_ENGINE,
  DEFAULT_AUTOMATION_MODEL,
  resolveAutomationModelSettings,
  resolveTextAutomationModelSettings,
} from "./automation-model.js";

describe("Mail text model settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetting.mockResolvedValue(null);
    mocks.isResolvedEngineUsableForRequest.mockResolvedValue(true);
    mocks.resolveEngine.mockResolvedValue({
      defaultModel: DEFAULT_AUTOMATION_MODEL,
    });
  });

  it("defaults text generation to the available Builder model", async () => {
    await expect(
      resolveTextAutomationModelSettings("owner@example.com"),
    ).resolves.toEqual({
      engine: DEFAULT_AUTOMATION_ENGINE,
      model: DEFAULT_AUTOMATION_MODEL,
    });
    expect(mocks.resolveEngine).toHaveBeenCalledWith({
      engineOption: DEFAULT_AUTOMATION_ENGINE,
    });
  });

  it("uses the saved default agent model when the standard providers are unavailable", async () => {
    mocks.isResolvedEngineUsableForRequest.mockResolvedValue(false);
    mocks.getSetting.mockResolvedValue({
      engine: "anthropic",
      model: "claude-sonnet-5",
    });

    await expect(
      resolveTextAutomationModelSettings("owner@example.com"),
    ).resolves.toEqual({ engine: "anthropic", model: "claude-sonnet-5" });
  });

  it("preserves an explicitly selected text model", async () => {
    const selected = { engine: "anthropic", model: "claude-sonnet-5" };

    await expect(
      resolveAutomationModelSettings("owner@example.com", selected),
    ).resolves.toEqual(selected);
    expect(mocks.resolveEngine).not.toHaveBeenCalled();
  });
});
