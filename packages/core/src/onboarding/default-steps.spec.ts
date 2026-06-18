import { beforeEach, describe, expect, it, vi } from "vitest";

const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const resolveHasCompleteBuilderConnectionMock = vi.hoisted(() => vi.fn());
const detectEngineFromUserSecretsMock = vi.hoisted(() => vi.fn());
const isAgentEngineSettingConfiguredMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  canUseDeployCredentialFallbackForRequest: (...args: unknown[]) =>
    canUseDeployCredentialFallbackForRequestMock(...args),
  readDeployCredentialEnv: (...args: unknown[]) =>
    readDeployCredentialEnvMock(...args),
  resolveHasCompleteBuilderConnection: (...args: unknown[]) =>
    resolveHasCompleteBuilderConnectionMock(...args),
}));

vi.mock("../agent/engine/registry.js", () => ({
  detectEngineFromUserSecrets: (...args: unknown[]) =>
    detectEngineFromUserSecretsMock(...args),
  isAgentEngineSettingConfigured: (...args: unknown[]) =>
    isAgentEngineSettingConfiguredMock(...args),
}));

vi.mock("../settings/store.js", () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

async function loadLlmStep() {
  const registry = await import("./registry.js");
  const defaultSteps = await import("./default-steps.js");

  registry.__resetOnboardingRegistry();
  defaultSteps.registerDefaultOnboardingSteps();

  const step = registry.listOnboardingSteps().find((item) => item.id === "llm");
  if (!step) throw new Error("Expected default LLM onboarding step");
  return step;
}

async function loadDefaultStep(id: string) {
  const registry = await import("./registry.js");
  const defaultSteps = await import("./default-steps.js");

  registry.__resetOnboardingRegistry();
  defaultSteps.registerDefaultOnboardingSteps();

  const step = registry.listOnboardingSteps().find((item) => item.id === id);
  if (!step) throw new Error(`Expected default onboarding step ${id}`);
  return step;
}

describe("default onboarding steps", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resolveHasCompleteBuilderConnectionMock.mockResolvedValue(false);
    detectEngineFromUserSecretsMock.mockResolvedValue(null);
    isAgentEngineSettingConfiguredMock.mockReturnValue(false);
    getSettingMock.mockResolvedValue(null);
    readDeployCredentialEnvMock.mockImplementation(
      (key: string) => process.env[key] || undefined,
    );
  });

  it("does not complete LLM setup from provider env when fallback is blocked", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-example");
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);

    const step = await loadLlmStep();

    await expect(step.isComplete()).resolves.toBe(false);
    expect(canUseDeployCredentialFallbackForRequestMock).toHaveBeenCalled();
  });

  it("keeps local single-tenant provider env setup working when fallback is allowed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-example");
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);

    const step = await loadLlmStep();

    await expect(step.isComplete()).resolves.toBe(true);
  });

  it("registers optional GitHub repository setup for headless repo work", async () => {
    const step = await loadDefaultStep("github-repository");

    expect(step.required).toBe(false);
    expect(step.methods.map((method) => method.id)).toEqual([
      "settings",
      "local-env",
    ]);
  });

  it("completes GitHub repository setup from local token env when allowed", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_example");
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);

    const step = await loadDefaultStep("github-repository");

    await expect(step.isComplete()).resolves.toBe(true);
  });
});
