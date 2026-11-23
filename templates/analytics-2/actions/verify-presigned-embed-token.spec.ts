import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPresignedEmbedToken: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/model/app-embedding.js", () => ({
  verifyPresignedEmbedToken: mocks.verifyPresignedEmbedToken,
}));

import verifyPresignedEmbedTokenAction from "./verify-presigned-embed-token.js";

type ActionDef = {
  requiresAuth?: boolean;
  readOnly?: boolean;
  http?: { method?: string };
  run: (input: { projectId: string; token: string }) => Promise<unknown>;
};

const action = verifyPresignedEmbedTokenAction as unknown as ActionDef;

describe("verify-presigned-embed-token action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows unauthenticated guest requests so embedded viewers can verify signed tokens", () => {
    expect(action.requiresAuth).toBe(false);
    expect(action.readOnly).toBe(true);
    expect(action.http?.method).toBe("GET");
  });

  it("delegates verification to the embedding model", async () => {
    const expected = {
      valid: true,
      status: "valid",
      projectId: "proj-1",
      userAttributes: { region: "us-west" },
      expiresAt: "2026-12-01T00:00:00.000Z",
    };
    mocks.verifyPresignedEmbedToken.mockResolvedValue(expected);
    await expect(
      action.run({ projectId: "proj-1", token: "emb_valid.sig" }),
    ).resolves.toEqual(expected);
    expect(mocks.verifyPresignedEmbedToken).toHaveBeenCalledWith({
      projectId: "proj-1",
      token: "emb_valid.sig",
    });
  });
});
