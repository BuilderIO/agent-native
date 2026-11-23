import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prefetchSecrets: vi.fn(async () => undefined),
  resolveBuilderGatewayAuth: vi.fn(),
  resolveSecretDetailed: vi.fn(),
  readServiceProviderChoice: vi.fn(),
}));

vi.mock("../server/service-providers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/service-providers.js")>()),
  readServiceProviderChoice: mocks.readServiceProviderChoice,
}));

vi.mock("../server/credential-provider.js", () => ({
  getBuilderEmbeddingsBaseUrl: () =>
    "https://builder.test/agent-native/embeddings/v1",
  prefetchSecrets: mocks.prefetchSecrets,
  resolveBuilderGatewayAuth: mocks.resolveBuilderGatewayAuth,
  resolveSecretDetailed: mocks.resolveSecretDetailed,
}));

import {
  availableEmbeddingFamilies,
  createBuilderEmbeddingFamily,
  defaultEmbeddingFamily,
  EmbeddingProviderError,
  readEmbeddingFamilyAvailability,
  resolveDefaultEmbeddingFamily,
  type EmbeddingFamily,
} from "./index.js";

describe("embedding family availability", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveBuilderGatewayAuth.mockResolvedValue(null);
    mocks.resolveSecretDetailed.mockImplementation(async (key: string) => ({
      value: key === "GEMINI_API_KEY" ? "gemini-key" : null,
      lookupFailed: key === "COHERE_API_KEY",
    }));
    mocks.readServiceProviderChoice.mockResolvedValue(null);
  });

  it("prefetches provider keys and preserves unavailable lookups", async () => {
    await expect(readEmbeddingFamilyAvailability()).resolves.toMatchObject({
      families: [{ provider: "gemini" }],
      unavailableProviders: ["cohere"],
    });
    expect(mocks.prefetchSecrets).toHaveBeenCalledWith([
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GEMINI_API_KEY",
      "COHERE_API_KEY",
      "VOYAGE_API_KEY",
    ]);
    expect(mocks.resolveSecretDetailed).toHaveBeenCalledTimes(4);
  });

  it("uses the Gemini key saved for chat models", async () => {
    mocks.resolveSecretDetailed.mockImplementation(async (key: string) => ({
      value: key === "GOOGLE_GENERATIVE_AI_API_KEY" ? "gemini-chat-key" : null,
      lookupFailed: false,
      ...(key === "GOOGLE_GENERATIVE_AI_API_KEY"
        ? { source: "org", scopeId: "org-1" }
        : {}),
    }));
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init: RequestInit) =>
        new Response(
          JSON.stringify({ embedding: { values: Array(1024).fill(0.5) } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [family] = await availableEmbeddingFamilies();
    expect(family?.provider).toBe("gemini");
    await expect(family!.embed([{ text: "hello" }], "query")).resolves.toEqual([
      Array(1024).fill(0.5),
    ]);
    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.stringify(init?.headers)).toContain("gemini-chat-key");
  });

  it("fails closed when any provider lookup is unavailable", async () => {
    await expect(availableEmbeddingFamilies()).rejects.toThrow(
      "Embedding credential lookup is temporarily unavailable for: cohere.",
    );
  });

  it("reports a thrown provider lookup as unavailable", async () => {
    mocks.resolveSecretDetailed.mockImplementation(async (key: string) => {
      if (key === "VOYAGE_API_KEY") throw new Error("vault offline");
      return { value: null, lookupFailed: false };
    });

    await expect(readEmbeddingFamilyAvailability()).resolves.toEqual({
      families: [],
      unavailableProviders: ["voyage"],
      preferredProvider: null,
    });
  });

  describe("with Builder.io and a Gemini key", () => {
    beforeEach(() => {
      mocks.resolveSecretDetailed.mockImplementation(async (key: string) => ({
        value: key === "GOOGLE_GENERATIVE_AI_API_KEY" ? "gemini-key" : null,
        lookupFailed: false,
      }));
      mocks.resolveBuilderGatewayAuth.mockResolvedValue({
        authorization: "Bearer builder-session",
        spaceId: null,
        userId: null,
      });
    });

    it("uses Builder.io by default instead of turning semantic search off", async () => {
      const family = await resolveDefaultEmbeddingFamily();
      expect(family?.provider).toBe("builder");
      expect(mocks.readServiceProviderChoice).toHaveBeenCalledWith(
        "embeddings",
      );
    });

    it("uses Gemini when the organization chooses it", async () => {
      mocks.readServiceProviderChoice.mockResolvedValue("gemini");
      await expect(readEmbeddingFamilyAvailability()).resolves.toMatchObject({
        preferredProvider: "gemini",
      });
      expect((await resolveDefaultEmbeddingFamily())?.provider).toBe("gemini");
    });

    it("fails closed when the organization's choice can't be read", async () => {
      mocks.readServiceProviderChoice.mockRejectedValue(new Error("db down"));
      await expect(readEmbeddingFamilyAvailability()).resolves.toMatchObject({
        unavailableProviders: ["service-providers"],
        preferredProvider: null,
      });
      await expect(resolveDefaultEmbeddingFamily()).rejects.toThrow(
        "temporarily unavailable for: service-providers",
      );
    });
  });

  it("uses Builder embeddings for connected workspaces without provider keys", async () => {
    mocks.resolveSecretDetailed.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    mocks.resolveBuilderGatewayAuth.mockResolvedValue({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: "builder-user-123",
    });
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: "builder-multimodal-embedding",
          inputType: "query",
          inputs: [
            { text: "first", images: [] },
            { text: "second", images: [] },
          ],
        });
        return new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: Array(1024).fill(2) },
              { index: 0, embedding: Array(1024).fill(1) },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const [family] = await availableEmbeddingFamilies();
    expect(family?.provider).toBe("builder");
    expect(family).toBeDefined();
    await expect(
      family!.embed([{ text: "first" }, { text: "second" }], "query"),
    ).resolves.toEqual([Array(1024).fill(1), Array(1024).fill(2)]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://builder.test/agent-native/embeddings/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer builder-session",
          "x-builder-user-id": "builder-user-123",
        }),
      }),
    );
  });

  it("keeps Builder families available alongside direct provider keys", async () => {
    mocks.resolveSecretDetailed.mockImplementation(async (key: string) => ({
      value: key === "GEMINI_API_KEY" ? "gemini-key" : null,
      lookupFailed: false,
    }));
    mocks.resolveBuilderGatewayAuth.mockResolvedValue({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });

    await expect(readEmbeddingFamilyAvailability()).resolves.toMatchObject({
      families: [{ provider: "gemini" }, { provider: "builder" }],
      unavailableProviders: [],
    });
    expect(mocks.resolveBuilderGatewayAuth).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight Builder embedding request with the caller signal", async () => {
    const family = createBuilderEmbeddingFamily({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
    let providerSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init: RequestInit) => {
        providerSignal = init.signal as AbortSignal;
        return await new Promise<Response>((_resolve, reject) => {
          providerSignal?.addEventListener(
            "abort",
            () => reject(providerSignal?.reason),
            { once: true },
          );
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = family.embed([{ text: "active users" }], "query", {
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort(new Error("preload deadline"));

    await expect(pending).rejects.toThrow("preload deadline");
    expect(providerSignal?.aborted).toBe(true);
  });

  it("reports a rate-limited Builder request with its status and wait", async () => {
    const family = createBuilderEmbeddingFamily({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Too many requests", {
            status: 429,
            headers: { "Retry-After": "30" },
          }),
      ),
    );

    const failure = await family
      .embed([{ text: "active users" }], "document")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbeddingProviderError);
    expect(failure).toMatchObject({ status: 429, retryAfterMs: 30_000 });
    expect((failure as Error).message).toBe(
      "Embedding provider builder/builder-multimodal-embedding failed with status 429.",
    );
  });

  it("keeps the gateway's code for refusing a request, but not its message", async () => {
    const family = createBuilderEmbeddingFamily({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            type: "error",
            code: "rate_limit_exceeded",
            message: "Builder-managed embeddings are temporarily rate limited.",
            severity: "low",
          },
          { status: 429 },
        ),
      ),
    );

    const failure = await family
      .embed([{ text: "active users" }], "document")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 429, code: "rate_limit_exceeded" });
    expect((failure as Error).message).toBe(
      "Embedding provider builder/builder-multimodal-embedding failed with status 429.",
    );
  });

  it("reads a code nested under error, and drops one that isn't an identifier", async () => {
    const family = createBuilderEmbeddingFamily({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            { error: { type: "invalid_request_error", message: "Bad input." } },
            { status: 400 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json({ code: "Bad input: active users" }, { status: 400 }),
        ),
    );

    const nested = await family
      .embed([{ text: "active users" }], "document")
      .catch((error: unknown) => error);
    expect(nested).toMatchObject({
      status: 400,
      code: "invalid_request_error",
    });
    const prose = await family
      .embed([{ text: "active users" }], "document")
      .catch((error: unknown) => error);
    expect(prose).toBeInstanceOf(EmbeddingProviderError);
    expect((prose as EmbeddingProviderError).code).toBeUndefined();
  });

  it("keeps a refusal's status and wait when its reply stalls past the caller's signal", async () => {
    const family = createBuilderEmbeddingFamily({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
    const caller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            init.signal?.addEventListener("abort", () =>
              stream.error(init.signal?.reason),
            );
          },
        });
        setTimeout(() => caller.abort(new Error("caller gave up")), 10);
        return new Response(body, {
          status: 429,
          headers: { "Retry-After": "30" },
        });
      }),
    );

    const failure = await family
      .embed([{ text: "active users" }], "document", { signal: caller.signal })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbeddingProviderError);
    expect(failure).toMatchObject({ status: 429, retryAfterMs: 30_000 });
  });

  it("budgets Builder indexing by its credentials without keeping them", () => {
    const credentials = {
      authorization: "Bearer bpk-space-key",
      spaceId: "space-a",
      userId: "user-1",
    };
    const budget = createBuilderEmbeddingFamily(credentials).documentBudget;
    expect(budget?.policy).toEqual({ capacity: 2, windowMs: 60_000 });
    expect(
      createBuilderEmbeddingFamily({ ...credentials, userId: "user-2" })
        .documentBudget,
    ).toEqual(budget);
    expect(
      createBuilderEmbeddingFamily({
        ...credentials,
        authorization: "Bearer bpk-other-key",
      }).documentBudget?.scope,
    ).not.toEqual(budget?.scope);
    expect(JSON.stringify(budget)).not.toContain("bpk-space-key");
  });

  it("batches Builder embeddings within the service input size limits", async () => {
    const family = createBuilderEmbeddingFamily({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init: RequestInit) => {
        const inputs = JSON.parse(String(init.body)).inputs as unknown[];
        return new Response(
          JSON.stringify({
            data: inputs.map((_, index) => ({
              index,
              embedding: Array(1024).fill(index),
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      family.embed(
        Array.from({ length: 9 }, () => ({ text: "x".repeat(32_000) })),
        "document",
      ),
    ).resolves.toHaveLength(9);
    const imageData = "A".repeat(14_000_000);
    await expect(
      family.embed(
        [
          { images: [{ mimeType: "image/png", base64: imageData }] },
          { images: [{ mimeType: "image/png", base64: imageData }] },
        ],
        "document",
      ),
    ).resolves.toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "x-builder-user-id",
    );

    const requestInputs = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).inputs as unknown[],
    );
    expect(requestInputs.map((inputs) => inputs.length)).toEqual([8, 1, 1, 1]);
  });
});

describe("defaultEmbeddingFamily", () => {
  const family = (provider: string): EmbeddingFamily => ({
    id: `${provider}:test:3`,
    provider,
    model: "test",
    version: "1",
    dimensions: 3,
    embed: async () => [[0, 0, 0]],
  });

  it("picks Builder.io, then Gemini, Cohere, and Voyage when several are available", () => {
    expect(
      defaultEmbeddingFamily([family("voyage"), family("gemini")])?.provider,
    ).toBe("gemini");
    expect(
      defaultEmbeddingFamily([
        family("cohere"),
        family("gemini"),
        family("builder"),
      ])?.provider,
    ).toBe("builder");
    expect(
      defaultEmbeddingFamily([family("voyage"), family("cohere")])?.provider,
    ).toBe("cohere");
  });

  it("uses the choice, and nothing else when the choice isn't available", () => {
    const families = [family("builder"), family("gemini")];
    expect(defaultEmbeddingFamily(families, "gemini")?.provider).toBe("gemini");
    expect(defaultEmbeddingFamily(families, "voyage")).toBeNull();
  });

  it("never picks among providers outside the known order", () => {
    expect(defaultEmbeddingFamily([family("acme")])?.provider).toBe("acme");
    expect(
      defaultEmbeddingFamily([family("acme"), family("other")]),
    ).toBeNull();
  });
});
