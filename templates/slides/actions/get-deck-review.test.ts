import type { ReviewComment } from "@agent-native/core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  list: vi.fn(),
  deckData: "",
  deckReads: [] as { type: string; id: string; role: string }[],
}));

vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  assertReviewableResourceAccess: core.assertAccess,
}));
vi.mock("@agent-native/core/review/actions/list-review-comments", () => ({
  default: { run: core.list },
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: async (type: string, id: string, role: string) => {
    core.deckReads.push({ type, id, role });
    return { role: "owner", resource: { id, data: core.deckData } };
  },
}));

import action from "./get-deck-review";

const CTX = { caller: "tool", userEmail: "owner@example.com" } as const;

function root(
  id: string,
  slideId: string,
  overrides: Partial<ReviewComment> = {},
) {
  return {
    id,
    resourceId: "deck-1",
    threadId: `thread-${id}`,
    parentCommentId: null,
    targetId: slideId,
    status: "open",
    resolutionTarget: "human",
    anchor: { kind: "slide", slideId, point: { x: 1, y: 2, targetText: "Hi" } },
    body: `On ${slideId}`,
    authorName: "Reviewer",
    createdBy: "human",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ReviewComment;
}

function deck(...slideIds: string[]) {
  return JSON.stringify({ slides: slideIds.map((id) => ({ id })) });
}

beforeEach(() => {
  vi.clearAllMocks();
  core.deckReads.length = 0;
  core.list.mockResolvedValue({
    comments: [
      root("a", "slide-a"),
      root("c", "slide-c"),
      root("b", "slide-b"),
    ],
  });
});

describe("get-deck-review", () => {
  it("keeps each thread on its slide when the deck is reordered", async () => {
    core.deckData = deck("slide-a", "slide-b", "slide-c");
    const before = await action.run({ deckId: "deck-1" }, CTX);
    core.deckData = deck("slide-c", "slide-a", "slide-b");
    const after = await action.run({ deckId: "deck-1" }, CTX);

    const numbers = (result: typeof before) =>
      result.threads.map(({ slideId, slideNumber }) => [slideId, slideNumber]);
    expect(numbers(before)).toEqual([
      ["slide-a", 1],
      ["slide-b", 2],
      ["slide-c", 3],
    ]);
    expect(numbers(after)).toEqual([
      ["slide-c", 1],
      ["slide-a", 2],
      ["slide-b", 3],
    ]);
  });

  it("reports a deleted slide's thread without a number, after the others", async () => {
    core.deckData = deck("slide-b", "slide-a");
    const result = await action.run({ deckId: "deck-1" }, CTX);

    expect(
      result.threads.map(({ slideId, slideNumber }) => [slideId, slideNumber]),
    ).toEqual([
      ["slide-b", 1],
      ["slide-a", 2],
      ["slide-c", null],
    ]);
  });

  it("lists open threads only unless resolved ones are asked for", async () => {
    core.deckData = deck("slide-a", "slide-b", "slide-c");
    core.list.mockResolvedValue({
      comments: [
        root("a", "slide-a"),
        root("b", "slide-b", { status: "resolved" }),
        {
          ...root("reply", "slide-a"),
          threadId: "thread-a",
          parentCommentId: "a",
          anchor: null,
          createdBy: "agent",
          body: "Fixed",
        },
      ],
    });

    const open = await action.run({ deckId: "deck-1" }, CTX);
    const all = await action.run(
      { deckId: "deck-1", includeResolved: true },
      CTX,
    );

    expect(open.threads).toEqual([
      expect.objectContaining({
        threadId: "thread-a",
        slideNumber: 1,
        targetText: "Hi",
        comments: [
          expect.objectContaining({ commentId: "a", fromAgent: false }),
          expect.objectContaining({ commentId: "reply", fromAgent: true }),
        ],
      }),
    ]);
    expect(all.threads.map((thread) => thread.threadId)).toEqual([
      "thread-a",
      "thread-b",
    ]);
  });
});
