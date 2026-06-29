import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compareReferenceCandidates,
  compilePrompt,
  generateWithManagedImageProvider,
} from "./generation.js";
import type { GenerateProviderInput } from "./generation.js";

const resolveBuilderCredentialsMock = vi.hoisted(() => vi.fn());
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
    resolveBuilderCredentials: resolveBuilderCredentialsMock,
    resolveHasBuilderPrivateKey: resolveHasBuilderPrivateKeyMock,
    resolveSecret: resolveSecretMock,
  };
});

const baseInput: GenerateProviderInput = {
  prompt: "A clean product hero image",
  compiledPrompt: "A clean product hero image",
  references: [],
  model: "gemini-3.1-flash-image",
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

function builderGenerationSuccess() {
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

function builderImageBytes() {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

function requestIdempotencyKeys(
  fetchMock: ReturnType<typeof vi.fn>,
): (string | undefined)[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/generations"))
    .map(([, init]) => {
      const body = (init as RequestInit | undefined)?.body;
      return body
        ? (JSON.parse(String(body)) as { idempotencyKey?: string })
            .idempotencyKey
        : undefined;
    });
}

describe("generateWithManagedImageProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BUILDER_IMAGE_GENERATION_ENABLED", "true");
    resolveBuilderCredentialsMock.mockResolvedValue({
      privateKey: "bpk-builder-key",
      publicKey: "space-test",
      userId: null,
      orgName: null,
      orgKind: null,
    });
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
    resolveBuilderCredentialsMock.mockResolvedValue({
      privateKey: null,
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
    });

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "FeatureNotConfiguredError",
        requiredCredential: "BUILDER_PRIVATE_KEY",
        message: expect.stringContaining("connected or reconnected"),
      }),
    );
  });

  it("fails before calling Builder when the public key is missing", async () => {
    resolveBuilderCredentialsMock.mockResolvedValue({
      privateKey: "bpk-builder-key",
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "FeatureNotConfiguredError",
        requiredCredential: "BUILDER_PRIVATE_KEY",
        message: expect.stringContaining("Builder public key is missing"),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses OpenAI as a manual image fallback when Builder is unavailable", async () => {
    resolveBuilderCredentialsMock.mockResolvedValue({
      privateKey: null,
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
    });
    resolveSecretMock.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY" ? "sk-openai-test" : null,
    );
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from([9, 8, 7]).toString("base64") }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithManagedImageProvider(baseInput)).resolves.toEqual(
      expect.objectContaining({
        image: Buffer.from([9, 8, 7]),
        mimeType: "image/png",
        model: "gpt-image-2",
        provider: "openai",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-openai-test",
        }),
      }),
    );
  });

  it("guards restyle and edit runs when only OpenAI fallback is available", async () => {
    resolveBuilderCredentialsMock.mockResolvedValue({
      privateKey: null,
      publicKey: null,
      userId: null,
      orgName: null,
      orgKind: null,
    });
    resolveSecretMock.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY" ? "sk-openai-test" : null,
    );

    await expect(
      generateWithManagedImageProvider({
        ...baseInput,
        intent: "restyle",
        references: [
          {
            id: "subject-1",
            role: "subject_reference",
            mimeType: "image/png",
            data: Buffer.from([1]).toString("base64"),
          },
        ],
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "FeatureNotConfiguredError",
        requiredCredential: "GEMINI_API_KEY",
        message: expect.stringContaining("Restyle and edit runs need"),
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

  it("retries transient Builder storage failures", async () => {
    const fetchMock = mockBuilderFailure(500, {
      error: { message: "Generated image could not be stored. Retry shortly." },
    });

    await expect(generateWithManagedImageProvider(baseInput)).rejects.toEqual(
      expect.objectContaining({
        name: "BuilderImageGenerationError",
        message: expect.stringContaining("Generated image could not be stored"),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers when a transient Builder retry succeeds", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
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
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithManagedImageProvider(baseInput)).resolves.toEqual(
      expect.objectContaining({
        model: "builder-image",
        provider: "builder",
        providerGenerationId: "generation-1",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]).toEqual([
      "https://builder.test/agent-native/images/v1/generations",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bpk-builder-key",
          "x-builder-api-key": "space-test",
        }),
      }),
    ]);
    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[2][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(requestBody.model).toBe("gemini-3.1-flash-image-preview");
  });

  it("polls the same idempotency key while the service reports the request in progress", async () => {
    let generationCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/generations")) {
        generationCalls += 1;
        if (generationCalls <= 2) {
          return new Response(
            JSON.stringify({
              code: "request_in_progress",
              message:
                "An image generation request with this idempotency key is already in progress.",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        return builderGenerationSuccess();
      }
      return builderImageBytes();
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateWithManagedImageProvider({ ...baseInput, runId: "run-poll-1" }),
    ).resolves.toEqual(
      expect.objectContaining({
        provider: "builder",
        providerGenerationId: "generation-1",
      }),
    );
    expect(generationCalls).toBe(3);
    // Every poll re-POSTs the same key so the service replays the stored result
    // instead of starting a second, double-charged generation.
    expect(requestIdempotencyKeys(fetchMock)).toEqual([
      "run-poll-1",
      "run-poll-1",
      "run-poll-1",
    ]);
  });

  it("polls after a client-side abort instead of regenerating", async () => {
    let generationCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/generations")) {
        generationCalls += 1;
        if (generationCalls === 1) {
          const abort = new Error("The operation was aborted.");
          abort.name = "AbortError";
          throw abort;
        }
        return builderGenerationSuccess();
      }
      return builderImageBytes();
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateWithManagedImageProvider({ ...baseInput, runId: "run-poll-2" }),
    ).resolves.toEqual(expect.objectContaining({ provider: "builder" }));
    expect(generationCalls).toBe(2);
    expect(requestIdempotencyKeys(fetchMock)).toEqual([
      "run-poll-2",
      "run-poll-2",
    ]);
  });

  it("gives up after exhausting the in-flight poll budget", async () => {
    const fetchMock = mockBuilderFailure(409, {
      code: "request_in_progress",
      message:
        "An image generation request with this idempotency key is already in progress.",
    });

    await expect(
      generateWithManagedImageProvider({ ...baseInput, runId: "run-poll-3" }),
    ).rejects.toEqual(
      expect.objectContaining({ name: "BuilderImageGenerationError" }),
    );
    // initial attempt + MANAGED_PROVIDER_INFLIGHT_MAX_POLLS (6 under test).
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});

describe("compilePrompt", () => {
  it("uses text-only style guidance cleanly when a preset library has no references", () => {
    const prompt = compilePrompt({
      libraryTitle: "Soft Travel 3D",
      styleBrief: {
        description: "Rounded tactile 3D miniatures.",
      },
      customInstructions: "Keep the result brand-safe.",
      prompt: "A spa service icon",
      referenceCount: 0,
      includeLogo: false,
      category: "hero",
    });

    expect(prompt).toContain("No reference images are attached");
    expect(prompt).not.toContain("Use the 0 attached reference images");
    expect(prompt).toContain("Rounded tactile 3D miniatures.");
    expect(prompt).toContain("Keep the result brand-safe.");
  });

  it("includes generation preset instructions in the compiled prompt", () => {
    const prompt = compilePrompt({
      libraryTitle: "Product Launch",
      styleBrief: {
        description: "Editorial product imagery.",
      },
      customInstructions:
        "Generation preset: Social image.\nText policy: Keep visible text to 5 words or fewer.",
      prompt: "Create a square social post visual about a launch.",
      referenceCount: 2,
      includeLogo: false,
      category: "social",
    });

    expect(prompt).toContain("Generation preset: Social image.");
    expect(prompt).toContain("Keep visible text to 5 words or fewer.");
    expect(prompt).toContain("subject/source references provide content");
    expect(prompt).toContain("social post visual");
  });

  it("renders distilled style fields in generation prompts", () => {
    const prompt = compilePrompt({
      libraryTitle: "Northstar",
      styleBrief: {
        description: "Clean editorial product photography.",
        medium: "macro photo-real product render",
        mood: "calm and assured",
        subjectMatter: "developer tools in realistic workspaces",
        texture: "soft matte surfaces",
      },
      prompt: "A hero image",
      referenceCount: 3,
      includeLogo: false,
      aspectRatio: "16:9",
      imageSize: "2K",
      category: "hero",
    });

    expect(prompt).toContain("Medium: macro photo-real product render.");
    expect(prompt).toContain("Mood: calm and assured.");
    expect(prompt).toContain(
      "Subject matter: developer tools in realistic workspaces.",
    );
    expect(prompt).toContain(
      "Texture/material treatment: soft matte surfaces.",
    );
    expect(prompt).toContain("Output frame: 16:9, 2K.");
  });

  it("puts subject preservation first for restyle prompts", () => {
    const prompt = compilePrompt({
      libraryTitle: "Northstar",
      styleBrief: {
        description: "High contrast editorial images.",
      },
      prompt: "Apply the campaign look",
      referenceCount: 4,
      includeLogo: false,
      category: "hero",
      intent: "restyle",
      styleStrength: "strong",
    });

    expect(prompt).toContain("The first attached image is the subject");
    expect(prompt).toContain("Apply the library look with strong strength");
    expect(prompt).toContain("Apply the campaign look");
  });

  it("uses a constrained full-image revision prompt for edits", () => {
    const prompt = compilePrompt({
      libraryTitle: "Northstar",
      styleBrief: {
        description: "High contrast editorial images.",
      },
      prompt: "Make the background navy",
      referenceCount: 1,
      includeLogo: false,
      intent: "edit",
    });

    expect(prompt).toContain("Use the attached image as the edit target");
    expect(prompt).toContain("Make only this change:");
    expect(prompt).toContain("Make the background navy");
    expect(prompt).toContain("Preserve all unchanged areas");
    expect(prompt).not.toContain("Style brief:");
  });
});

describe("compareReferenceCandidates", () => {
  it("orders references deterministically by score, created date, and id", () => {
    const sorted = [
      { asset: { id: "b", createdAt: "2026-05-20T00:00:00.000Z" }, score: 5 },
      { asset: { id: "c", createdAt: "2026-05-21T00:00:00.000Z" }, score: 5 },
      { asset: { id: "a", createdAt: "2026-05-21T00:00:00.000Z" }, score: 5 },
      { asset: { id: "z", createdAt: "2026-05-22T00:00:00.000Z" }, score: 4 },
    ].sort(compareReferenceCandidates);

    expect(sorted.map((item) => item.asset.id)).toEqual(["a", "c", "b", "z"]);
  });
});
