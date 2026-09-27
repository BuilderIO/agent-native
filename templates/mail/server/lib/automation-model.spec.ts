import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getSetting: vi.fn(),
  isJevEnabled: vi.fn(),
  isResolvedEngineUsableForRequest: vi.fn(),
  readDeployCredentialEnv: vi.fn(),
  registerBuiltinEngines: vi.fn(),
  resolveEngine: vi.fn(),
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  isResolvedEngineUsableForRequest: mocks.isResolvedEngineUsableForRequest,
  registerBuiltinEngines: mocks.registerBuiltinEngines,
  resolveEngine: mocks.resolveEngine,
}));
vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  isJevEnabled: mocks.isJevEnabled,
  readDeployCredentialEnv: mocks.readDeployCredentialEnv,
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
}));

import {
  DEFAULT_AUTOMATION_ENGINE,
  DEFAULT_AUTOMATION_MODEL,
  resolveAutomationModelSettings,
  TYPESAFE_AUTOMATION_ENGINE,
  TYPESAFE_AUTOMATION_MODEL,
} from "./automation-model.js";

describe("Mail automation model defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: null,
    });
    mocks.readDeployCredentialEnv.mockReturnValue(undefined);
    mocks.isJevEnabled.mockResolvedValue(false);
    mocks.isResolvedEngineUsableForRequest.mockResolvedValue(true);
    mocks.resolveEngine.mockResolvedValue({
      defaultModel: DEFAULT_AUTOMATION_MODEL,
    });
  });

  it.each([
    [
      "Builder entitlement",
      {
        apiKey: undefined,
        personalApiKey: undefined,
        builderAuth: { authorization: "Bearer test" },
      },
    ],
    [
      "a personal key",
      {
        apiKey: "personal-jev-key",
        personalApiKey: "personal-jev-key",
        builderAuth: null,
      },
    ],
  ])("defaults to Jev when enabled through %s", async (_label, credential) => {
    mocks.getJevContextCredentials.mockResolvedValue(credential);
    mocks.isJevEnabled.mockResolvedValue(true);

    await expect(
      resolveAutomationModelSettings("owner@example.com", null),
    ).resolves.toEqual({
      engine: TYPESAFE_AUTOMATION_ENGINE,
      model: TYPESAFE_AUTOMATION_MODEL,
    });
    expect(mocks.resolveEngine).not.toHaveBeenCalled();
  });

  it("falls back to the regular model when Jev availability cannot be checked", async () => {
    mocks.isJevEnabled.mockRejectedValue(new Error("Jev status unavailable"));

    await expect(
      resolveAutomationModelSettings("owner@example.com", null),
    ).resolves.toEqual({
      engine: DEFAULT_AUTOMATION_ENGINE,
      model: DEFAULT_AUTOMATION_MODEL,
    });
    expect(mocks.resolveEngine).toHaveBeenCalledWith({
      engineOption: DEFAULT_AUTOMATION_ENGINE,
    });
  });

  it("preserves the legacy Typesafe default for existing Mail deployments", async () => {
    mocks.readDeployCredentialEnv.mockReturnValue("legacy-typesafe-key");

    await expect(
      resolveAutomationModelSettings("owner@example.com", null),
    ).resolves.toEqual({
      engine: TYPESAFE_AUTOMATION_ENGINE,
      model: TYPESAFE_AUTOMATION_MODEL,
    });
    expect(mocks.resolveEngine).not.toHaveBeenCalled();
  });

  it("does not resolve Jev when the user selected an explicit model", async () => {
    const selected = { engine: "anthropic", model: "claude-test" };

    await expect(
      resolveAutomationModelSettings("owner@example.com", selected),
    ).resolves.toEqual(selected);
    expect(mocks.getJevContextCredentials).not.toHaveBeenCalled();
  });
});
