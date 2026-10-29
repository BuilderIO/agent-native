import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ assertAccess: vi.fn(), remove: vi.fn() }));

vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  assertReviewableResourceAccess: core.assertAccess,
}));
vi.mock("@agent-native/core/review/actions/delete-review-comment", () => ({
  default: { run: core.remove },
}));

import action from "./delete-slide-comment";

const CTX = { caller: "http", userEmail: "author@example.com" } as const;

beforeEach(() => vi.clearAllMocks());

// oracle-change: comments moved to the core review store, which owns author and editor delete rules.
describe("delete-slide-comment", () => {
  it("deletes through the review store after a deck access check", async () => {
    await expect(
      action.run({ id: "c-1", deckId: "deck-1" }, CTX),
    ).resolves.toEqual({ ok: true });

    expect(core.assertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      expect.objectContaining({ userEmail: CTX.userEmail }),
      "commenter",
    );
    expect(core.remove).toHaveBeenCalledWith(
      { resourceType: "deck", resourceId: "deck-1", commentId: "c-1" },
      expect.objectContaining({ userEmail: "author@example.com" }),
    );
  });

  it("does not delete when the caller cannot comment on the deck", async () => {
    core.assertAccess.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { statusCode: 403 }),
    );
    await expect(
      action.run({ id: "c-1", deckId: "deck-1" }, CTX),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(core.remove).not.toHaveBeenCalled();
  });
});
