import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readEmbeddingFamilyAvailability: vi.fn(),
  runWithRequestContext: vi.fn(
    async (_context: unknown, callback: () => Promise<unknown>) => callback(),
  ),
  embed: vi.fn(async () => [[0.1, 0.2, 0.3]]),
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [
          { ownerEmail: "owner@example.com", orgId: "org-1" },
        ],
      }),
    }),
  })),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/embeddings", () => ({
  readEmbeddingFamilyAvailability: mocks.readEmbeddingFamilyAvailability,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    brainSources: { id: "id", ownerEmail: "ownerEmail", orgId: "orgId" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import action, {
  checkBuilderEmbeddingsSchema,
} from "./check-builder-embeddings.js";

const builder = {
  id: "builder:test:3",
  provider: "builder",
  model: "test-model",
  version: "test",
  dimensions: 3,
  embed: mocks.embed,
};

const args = { sourceId: "source-1", confirmProviderCost: true as const };

describe("check-builder-embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readEmbeddingFamilyAvailability.mockResolvedValue({
      families: [builder],
      unavailableProviders: [],
    });
  });

  it("requires source admin and only embeds a synthetic query in the owner context", async () => {
    expect(action.needsApproval).toBe(true);
    expect(action.toolCallable).toBe(false);
    expect(
      checkBuilderEmbeddingsSchema.safeParse({ sourceId: "source-1" }).success,
    ).toBe(false);
    expect(checkBuilderEmbeddingsSchema.safeParse(args).success).toBe(true);

    await expect(action.run(args)).resolves.toEqual({
      provider: "builder",
      model: "test-model",
      dimensions: 3,
      success: true,
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "brain-source",
      "source-1",
      "admin",
    );
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mocks.embed).toHaveBeenCalledExactlyOnceWith(
      [{ text: "Builder embedding connectivity check." }],
      "query",
    );
  });

  it("rejects unauthorized callers before discovering providers", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(action.run(args)).rejects.toThrow("Forbidden");
    expect(mocks.readEmbeddingFamilyAvailability).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("rejects missing or unavailable Builder without falling back to Gemini", async () => {
    mocks.readEmbeddingFamilyAvailability.mockResolvedValueOnce({
      families: [{ ...builder, provider: "gemini" }],
      unavailableProviders: [],
    });
    await expect(action.run(args)).rejects.toThrow(
      "Builder embeddings are not configured.",
    );
    mocks.readEmbeddingFamilyAvailability.mockResolvedValueOnce({
      families: [{ ...builder, provider: "gemini" }],
      unavailableProviders: ["builder"],
    });
    await expect(action.run(args)).rejects.toThrow(
      "Builder embedding credential lookup is unavailable.",
    );
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("rejects malformed provider responses", async () => {
    mocks.embed.mockResolvedValueOnce([[Number.NaN, 0.2, 0.3]]);
    await expect(action.run(args)).rejects.toThrow(
      "Builder returned an invalid embedding.",
    );
  });
});
