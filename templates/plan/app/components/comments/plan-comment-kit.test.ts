// @vitest-environment happy-dom

import { extractCommentMentions } from "@shared/comment-context";
import { describe, expect, it } from "vitest";

import {
  planCommentBoxDraft,
  planCommentMessage,
  planReviewComment,
  togglePlanCommentReaction,
} from "./plan-comment-kit";

describe("Plan's comment box", () => {
  it("turns a person picked in the box into Plan's mention token", () => {
    const message = planCommentMessage({
      text: "Can @Ada Lovelace check this?",
      mentions: [{ label: "Ada Lovelace", email: "ada@example.com" }],
    });

    expect(message).toBe(
      "Can @[Ada Lovelace](mailto:ada%40example.com) check this?",
    );
    expect(extractCommentMentions(message)).toEqual([
      { label: "Ada Lovelace", email: "ada@example.com" },
    ]);
  });

  it("leaves a name two people share as text, as the kit does", () => {
    const message = planCommentMessage({
      text: "Over to @Sam and @Sam",
      mentions: [
        { label: "Sam", email: "sam.lee@example.com" },
        { label: "Sam", email: "sam.ng@example.com" },
      ],
    });

    expect(message).toBe("Over to @Sam and @Sam");
  });

  it("keeps the mention tokens a message already has", () => {
    const message = "@[Ada](mailto:ada%40example.com) please look";

    expect(planCommentMessage(planCommentBoxDraft(message))).toBe(message);
  });

  it("leaves an @ alone when nobody was picked", () => {
    expect(planCommentMessage({ text: "lunch @ noon", mentions: [] })).toBe(
      "lunch @ noon",
    );
  });

  it("shows a comment's author and status in the kit's row", () => {
    const agent = planReviewComment({
      id: "c1",
      message: "Done",
      status: "resolved",
      createdBy: "agent",
      authorName: "Claude Code",
      authorEmail: "owner@example.com",
      parentCommentId: "root",
      createdAt: "2026-11-22T12:00:00.000Z",
    });

    expect(agent).toMatchObject({
      id: "c1",
      threadId: "root",
      parentCommentId: "root",
      body: "Done",
      createdBy: "agent",
      authorName: "Claude Code",
      status: "resolved",
      createdAt: "2026-11-22T12:00:00.000Z",
    });
    expect(
      planReviewComment({
        id: "c2",
        message: "Hi",
        status: "open",
        createdBy: "human",
        authorEmail: "ada@example.com",
      }),
    ).toMatchObject({
      threadId: "c2",
      createdBy: "human",
      authorEmail: "ada@example.com",
      status: "open",
    });
  });

  it("counts the reader's reaction in and out", () => {
    const mine = togglePlanCommentReaction([], "👍", true);
    expect(mine).toEqual([{ reaction: "👍", count: 1, reactedByMe: true }]);
    expect(togglePlanCommentReaction(mine, "👍", true)).toEqual(mine);
    expect(togglePlanCommentReaction(mine, "👍", false)).toEqual([]);

    const shared = togglePlanCommentReaction(
      [{ reaction: "👍", count: 2, reactedByMe: false }],
      "👍",
      true,
    );
    expect(shared).toEqual([{ reaction: "👍", count: 3, reactedByMe: true }]);
    expect(togglePlanCommentReaction(shared, "👍", false)).toEqual([
      { reaction: "👍", count: 2, reactedByMe: false },
    ]);
  });
});
