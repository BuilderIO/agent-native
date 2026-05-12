import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateWithManagedImageProvider } from "./generation.js";
import type { GenerateProviderInput } from "./generation.js";

const resolveBuilderAuthHeaderMock = vi.hoisted(() => vi.fn());
const resolveSecretMock = vi.hoisted(() => vi.fn());
const resolveHasBuilderPrivateKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => {
  class FeatureNotConfiguredError extends Error {
    readonly requiredCredential: string;
    readonly builderConnectUrl?: string;
    readonly byokDocsUrl?: string;

    constructor(opts: {
      requiredCredential: string;
      message?: string;
      builderConnectUrl?: string;
      byokDocsUrl?: string;
    }) {
      super(opts.message ?? `Feature requires ${opts.requiredCredential}.`);
      this.name = "FeatureNotConfiguredError";
      this.requiredCredential = opts.requiredCredential;
      this.builderConnectUrl = opts.builderConnectUrl;
      this.byokDocsUrl = opts.byokDocsUrl;
    }
  }

  return {
    FeatureNotConfiguredError,
    getBuilderImageGenerationBaseUrl: vi.fn(
      () => "https://builder.test/agent-native/images/v1",
    ),
    resolveBuilderAuthHeader: resolveBuilderAuthHeaderMock,
    resolveHasBuilderPrivateKey: resolveHasBuilderPrivateKeyMock,
    resolveSecret: resolveSecretMock,
  };
});

const baseInput: GenerateProviderInput = {
  prompt: "A clean product hero image",
  compiledPrompt: "A clean product hero image",
  references: [],
  model: "gemini-3.1-flash-image-preview",
  aspectRatio: "16:9",
  imageSize: "2K",
  groundingMode: "auto",
};

function mockBuilderFailure(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("generateWithManagedImageProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BUILDER_IMAGE_GENERATION_ENABLED", "true");
    resolveBuilderAuthHeaderMock.mockResolvedValue("Bearer builder-key");
    resolveHasBuilderPrivateKeyMock.mockResolvedValue(true);
    resolveSecretMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports Builder credit failures as a connected-space problem", async () => {
    mockBuilderFailure(402, { message: "No image credits remaining" });

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "FeatureNotConfiguredError",
        requiredCredential: "GEMINI_API_KEY",
        message: expect.stringContaining("Builder.io is connected"),
      }),
    );
    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        message: expect.not.stringContaining("needs Builder.io connected"),
      }),
    );
    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining("No image credits remaining"),
      }),
    );
  });

  it("keeps missing Builder credentials on reconnect guidance", async () => {
    resolveBuilderAuthHeaderMock.mockResolvedValue(null);

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "FeatureNotConfiguredError",
        requiredCredential: "BUILDER_PRIVATE_KEY",
        message: expect.stringContaining("connected or reconnected"),
      }),
    );
  });

  it("reports transient Builder outages as retryable provider failures", async () => {
    mockBuilderFailure(503, { error: { message: "Provider warming up" } });

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "BuilderImageGenerationError",
        message: expect.stringContaining("temporarily unavailable"),
      }),
    );
    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        message: expect.not.stringContaining("needs Builder.io connected"),
      }),
    );
  });
});
