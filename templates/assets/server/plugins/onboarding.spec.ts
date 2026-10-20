import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class BuilderCredentialLookupError extends Error {}
  const basePlugin = vi.fn(async () => {});
  return {
    BuilderCredentialLookupError,
    basePlugin,
    createOnboardingPlugin: vi.fn(() => basePlugin),
    isBuilderImageGenerationEnabled: vi.fn(() => true),
    isObjectStorageConfigured: vi.fn(async () => true),
    registerFileUploadProvider: vi.fn(),
    registerOnboardingStep: vi.fn(),
    resolveGeminiApiKey: vi.fn(),
    resolveHasBuilderGatewayCredential: vi.fn(),
    resolveSecret: vi.fn(),
  };
});

vi.mock("@agent-native/core/file-upload", () => ({
  registerFileUploadProvider: mocks.registerFileUploadProvider,
}));
vi.mock("@agent-native/core/onboarding", () => ({
  createOnboardingPlugin: mocks.createOnboardingPlugin,
  registerOnboardingStep: mocks.registerOnboardingStep,
}));
vi.mock("@agent-native/core/server", () => ({
  BuilderCredentialLookupError: mocks.BuilderCredentialLookupError,
  GEMINI_API_KEY: "GOOGLE_GENERATIVE_AI_API_KEY",
  resolveGeminiApiKey: mocks.resolveGeminiApiKey,
  resolveHasBuilderGatewayCredential: mocks.resolveHasBuilderGatewayCredential,
  resolveSecret: mocks.resolveSecret,
}));
vi.mock("../lib/generation.js", () => ({
  isBuilderImageGenerationEnabled: mocks.isBuilderImageGenerationEnabled,
}));
vi.mock("../lib/s3-upload-provider.js", () => ({
  s3FileUploadProvider: {},
}));
vi.mock("../lib/storage.js", () => ({
  isObjectStorageConfigured: mocks.isObjectStorageConfigured,
}));

import onboardingPlugin from "./onboarding.js";

describe("image generation onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerOnboardingStep.mockReset();
    mocks.registerOnboardingStep.mockImplementation(() => {});
  });

  async function imageGenerationIsComplete() {
    const registered: Array<{
      id: string;
      isComplete: () => Promise<boolean>;
    }> = [];
    mocks.registerOnboardingStep.mockImplementation((step) => {
      registered.push(step as (typeof registered)[number]);
    });
    await onboardingPlugin({});
    const step = registered.find(({ id }) => id === "image-generation");
    if (!step)
      throw new Error("Image generation onboarding step was not registered.");
    return step.isComplete();
  }

  it("uses a valid manual key when Builder credential lookup is transient", async () => {
    mocks.resolveHasBuilderGatewayCredential.mockRejectedValue(
      new mocks.BuilderCredentialLookupError(
        "Builder credentials are temporarily unavailable.",
      ),
    );
    mocks.resolveGeminiApiKey.mockResolvedValue(null);
    mocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY" ? "configured" : null,
    );

    await expect(imageGenerationIsComplete()).resolves.toBe(true);
  });

  it("counts a Gemini key saved under either name as a manual key", async () => {
    mocks.resolveHasBuilderGatewayCredential.mockResolvedValue(false);
    mocks.resolveGeminiApiKey.mockResolvedValue("configured");
    mocks.resolveSecret.mockResolvedValue(null);

    await expect(imageGenerationIsComplete()).resolves.toBe(true);
    expect(mocks.resolveGeminiApiKey).toHaveBeenCalled();
    expect(mocks.resolveSecret).not.toHaveBeenCalledWith("GEMINI_API_KEY");
  });

  it("surfaces an unreadable credential store from the Gemini lookup", async () => {
    const storeError = new Error("Credential store unavailable.");
    mocks.resolveHasBuilderGatewayCredential.mockResolvedValue(false);
    mocks.resolveGeminiApiKey.mockRejectedValue(storeError);
    mocks.resolveSecret.mockResolvedValue(null);

    await expect(imageGenerationIsComplete()).rejects.toBe(storeError);
  });

  it("keeps Builder credential lookup failures visible without a manual key", async () => {
    const lookupError = new mocks.BuilderCredentialLookupError(
      "Builder credentials are temporarily unavailable.",
    );
    mocks.resolveHasBuilderGatewayCredential.mockRejectedValue(lookupError);
    mocks.resolveGeminiApiKey.mockResolvedValue(null);
    mocks.resolveSecret.mockResolvedValue(null);

    await expect(imageGenerationIsComplete()).rejects.toBe(lookupError);
  });
});
