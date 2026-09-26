import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prefetchSecrets: vi.fn(async () => undefined),
  resolveBuilderGatewayAuth: vi.fn(),
  resolveSecretDetailed: vi.fn(),
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
  readEmbeddingFamilyAvailability,
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
  });

  it("prefetches provider keys and preserves unavailable lookups", async () => {
    await expect(readEmbeddingFamilyAvailability()).resolves.toMatchObject({
      families: [{ provider: "gemini" }],
      unavailableProviders: ["cohere"],
    });
    expect(mocks.prefetchSecrets).toHaveBeenCalledWith([
      "GEMINI_API_KEY",
      "COHERE_API_KEY",
      "VOYAGE_API_KEY",
    ]);
    expect(mocks.resolveSecretDetailed).toHaveBeenCalledTimes(3);
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
