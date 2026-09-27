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

  it("surfaces optional System one setup alongside Builder and provider keys", async () => {
    const step = await loadLlmStep();

    expect(step.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "jev-key",
          label: "Decision model (Jev)",
          description: expect.stringContaining("Optional direct Jev API key"),
          badge: "recommended",
          kind: "form",
          payload: expect.objectContaining({
            writeScope: "user",
            fields: [expect.objectContaining({ key: "JEV_API_KEY" })],
          }),
        }),
      ]),
    );
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

  it("registers durable file storage with Builder and custom object-storage keys", async () => {
    const step = await loadDefaultStep("file-storage");

    expect(step.required).toBe(false);
    expect(step.methods.map((method) => method.id)).toEqual(["builder", "s3"]);
    expect(step.methods[0]).toMatchObject({
      kind: "builder-cli-auth",
      payload: { scope: "llm" },
    });
    // The custom path renders the shared storage form, not a generic key form.
    expect(step.methods[1]).toMatchObject({ kind: "file-storage" });
    expect(step.methods[1]).not.toHaveProperty("payload");
  });

  it("explains the host email variables instead of saving keys", async () => {
    const step = await loadDefaultStep("email");

    expect(step.required).toBe(false);
    expect(step.methods).toEqual([
      expect.objectContaining({
        id: "host-variables",
        kind: "link",
        payload: expect.objectContaining({ external: true }),
      }),
    ]);
    expect(step.methods.some((method) => method.kind === "form")).toBe(false);
    expect(step.description).toContain("RESEND_API_KEY");
    expect(step.description).toContain("EMAIL_FROM");
    await expect(step.isAvailable?.()).resolves.toBe(true);
  });

  it("drops the email step when the deployment provides email", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_example");

    const step = await loadDefaultStep("email");

    await expect(step.isAvailable?.()).resolves.toBe(false);
  });

  it("keeps the email step while the host's SendGrid setup lacks a sender", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "SG.test-example");

    const step = await loadDefaultStep("email");

    await expect(step.isAvailable?.()).resolves.toBe(true);
  });

  it("completes GitHub repository setup from local token env when allowed", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_example");
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);

    const step = await loadDefaultStep("github-repository");

    await expect(step.isComplete()).resolves.toBe(true);
  });
});
