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
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
    const fetchMock = mockBuilderFailure(503, {
      error: { message: "Provider warming up" },
    });

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "BuilderImageGenerationError",
        message: expect.stringContaining("temporarily unavailable"),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        message: expect.not.stringContaining("needs Builder.io connected"),
      }),
    );
  });

  it("recovers when a transient Builder retry succeeds", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/generations") && fetchMock.mock.calls.length <= 2) {
        return new Response(
          JSON.stringify({ error: { message: "Provider warming up" } }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.endsWith("/generations")) {
        return new Response(
          JSON.stringify({
            id: "generation-1",
            status: "completed",
            model: {
              publicId: "builder-image",
              provider: "builder",
              providerModel: "provider-image",
            },
            outputs: [
              {
                id: "output-1",
                url: "https://cdn.builder.test/output.png",
                mimeType: "image/png",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithManagedImageProvider(baseInput)).resolves.toEqual(
      expect.objectContaining({
        model: "builder-image",
        provider: "builder",
        providerGenerationId: "generation-1",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
