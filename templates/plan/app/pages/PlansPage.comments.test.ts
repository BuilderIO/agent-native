import { describe, expect, it } from "vitest";
import {
  buildCommentThreads,
  commentAuthorEmails,
  runtimeAnnotationFromThread,
} from "./PlansPage";
import type { PlanBundle } from "@shared/types";

type PlanComment = PlanBundle["comments"][number];

function comment(
  id: string,
  overrides: Partial<PlanComment> = {},
): PlanComment {
  return {
    id,
    planId: "plan_1",
    parentCommentId: null,
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: id,
    createdBy: "human",
    authorEmail: `${id}@example.com`,
    authorName: id,
    consumedAt: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("plan comment thread UI model", () => {
  it("groups replies and exposes participant avatars for Figma-style pins", () => {
    const anchor = JSON.stringify({ x: 42, y: 24, sectionTitle: "Summary" });
    const root = comment("root", {
      authorEmail: "damian@example.com",
      authorName: "Damian",
      anchor,
      createdAt: "2026-06-05T00:00:01.000Z",
    });
    const emma = comment("emma", {
      parentCommentId: root.id,
      authorEmail: "emma@example.com",
      authorName: "Emma",
      createdAt: "2026-06-05T00:00:02.000Z",
    });
    const steve = comment("steve", {
      parentCommentId: root.id,
      authorEmail: "steve@example.com",
      authorName: "Steve Sewell",
      createdAt: "2026-06-05T00:00:03.000Z",
    });

    const threads = buildCommentThreads([steve, root, emma]);
    const annotation = runtimeAnnotationFromThread(threads[0]!, 0, {
      "damian@example.com": "https://example.test/damian.png",
      "emma@example.com": "https://example.test/emma.png",
      "steve@example.com": null,
    });

    expect(threads).toHaveLength(1);
    expect(threads[0]!.comments.map((item) => item.id)).toEqual([
      root.id,
      emma.id,
      steve.id,
    ]);
    expect(annotation).toMatchObject({
      id: root.id,
      commentCount: 3,
      anchor: { x: 42, y: 24, sectionTitle: "Summary" },
      replies: [
        { id: emma.id, authorName: "Emma" },
        { id: steve.id, authorName: "Steve Sewell" },
      ],
      participants: [
        {
          authorEmail: "damian@example.com",
          authorName: "Damian",
          authorAvatarUrl: "https://example.test/damian.png",
        },
        {
          authorEmail: "emma@example.com",
          authorName: "Emma",
          authorAvatarUrl: "https://example.test/emma.png",
        },
        {
          authorEmail: "steve@example.com",
          authorName: "Steve Sewell",
          authorAvatarUrl: null,
        },
      ],
    });
  });

  it("collects unique comment author emails for avatar image lookup", () => {
    expect(
      commentAuthorEmails(
        [
          comment("a", { authorEmail: "Damian@Example.com" }),
          comment("b", { authorEmail: "emma@example.com" }),
          comment("c", { authorEmail: "damian@example.com" }),
        ],
        "steve@example.com",
      ),
    ).toEqual(["damian@example.com", "emma@example.com", "steve@example.com"]);
  });
});
