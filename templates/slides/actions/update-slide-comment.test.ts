import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  resolve: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  assertReviewableResourceAccess: core.assertAccess,
}));
vi.mock("@agent-native/core/review/actions/resolve-review-thread", () => ({
  default: { run: core.resolve },
}));
vi.mock("@agent-native/core/review/actions/update-review-comment", () => ({
  default: { run: core.update },
}));

import action from "./update-slide-comment";

const CTX = { caller: "http", userEmail: "author@example.com" } as const;

beforeEach(() => vi.clearAllMocks());

// oracle-change: comments moved to the core review store, which owns edit and resolve permissions.
describe("update-slide-comment", () => {
  it.each([
    [true, "resolved"],
    [false, "open"],
  ] as const)(
    "sets resolved=%s on the whole review thread",
    async (resolved, status) => {
      await expect(
        action.run({ id: "c-1", deckId: "deck-1", resolved }, CTX),
      ).resolves.toEqual({ ok: true, resolved });

      expect(core.assertAccess).toHaveBeenCalledWith(
        "deck",
        "deck-1",
        expect.objectContaining({ userEmail: CTX.userEmail }),
        "commenter",
      );
      expect(core.resolve).toHaveBeenCalledWith(
        {
          resourceType: "deck",
          resourceId: "deck-1",
          commentId: "c-1",
          status,
        },
        expect.objectContaining({ userEmail: "author@example.com" }),
      );
      expect(core.update).not.toHaveBeenCalled();
    },
  );

  it("edits the comment body through the review store", async () => {
    await expect(
      action.run({ id: "c-1", deckId: "deck-1", content: "New text" }, CTX),
    ).resolves.toEqual({ ok: true });

    expect(core.update).toHaveBeenCalledWith(
      {
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "c-1",
        body: "New text",
      },
      expect.objectContaining({ userEmail: "author@example.com" }),
    );
    expect(core.resolve).not.toHaveBeenCalled();
  });

  it("rejects content and a resolved state together", async () => {
    await expect(
      action.run(
        { id: "c-1", deckId: "deck-1", content: "x", resolved: true },
        CTX,
      ),
    ).rejects.toMatchObject({ paths: ["content"] });
    expect(core.resolve).not.toHaveBeenCalled();
    expect(core.update).not.toHaveBeenCalled();
  });
});
