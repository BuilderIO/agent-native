import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prefetchSecrets: vi.fn(async () => undefined),
  resolveSecretDetailed: vi.fn(),
}));

vi.mock("../server/credential-provider.js", () => ({
  prefetchSecrets: mocks.prefetchSecrets,
  resolveSecretDetailed: mocks.resolveSecretDetailed,
}));

import {
  availableEmbeddingFamilies,
  readEmbeddingFamilyAvailability,
} from "./index.js";

describe("embedding family availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
