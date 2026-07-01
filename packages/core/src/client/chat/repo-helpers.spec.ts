import { describe, it, expect } from "vitest";

import {
  dedupeRepoMessagesById,
  dropEmptyAssistantMessages,
  type NormalizedRepo,
} from "./repo-helpers.js";

describe("dedupeRepoMessagesById", () => {
  it("returns the same reference when there are no duplicate ids", () => {
    const repo: NormalizedRepo = {
      headId: "b",
      messages: [
        { parentId: null, message: { id: "a", role: "user", content: "hi" } },
        {
          parentId: "a",
          message: { id: "b", role: "assistant", content: "yo" },
        },
      ],
    };
    // No behavioural change for the common case — identical reference back.
    expect(dedupeRepoMessagesById(repo)).toBe(repo);
  });

  it("keeps only the LAST occurrence of a duplicated id (latest content wins)", () => {
    const repo: NormalizedRepo = {
      headId: "a",
      messages: [
        {
          parentId: null,
          message: { id: "a", role: "user", content: "first" },
        },
        {
          parentId: null,
          message: { id: "a", role: "user", content: "second" },
        },
      ],
    };
    const result = dedupeRepoMessagesById(repo)!;
    expect(result).not.toBe(repo);
    expect(result.messages).toHaveLength(1);
    const kept = result.messages![0].message;
    expect(kept).toMatchObject({ id: "a", content: "second" });
  });

  it("preserves the relative order of surviving entries", () => {
    const repo: NormalizedRepo = {
      messages: [
        { message: { id: "a", content: "a1" } },
        { message: { id: "b", content: "b1" } },
        { message: { id: "a", content: "a2" } },
        { message: { id: "c", content: "c1" } },
      ],
    };
    const result = dedupeRepoMessagesById(repo)!;
    expect(result.messages!.map((m) => m.message!.id)).toEqual(["b", "a", "c"]);
    // The surviving "a" carries the later content.
    expect(
      result.messages!.find((m) => m.message!.id === "a")?.message,
    ).toMatchObject({ content: "a2" });
  });

  it("handles flat (unwrapped) entries too", () => {
    const repo: NormalizedRepo = {
      messages: [
        { id: "x", role: "user", content: "1" },
        { id: "x", role: "user", content: "2" },
      ] as NormalizedRepo["messages"],
    };
    const result = dedupeRepoMessagesById(repo)!;
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0]).toMatchObject({ id: "x", content: "2" });
  });

  it("leaves id-less entries untouched and never collapses them together", () => {
    const repo: NormalizedRepo = {
      messages: [
        { message: { role: "user", content: "no-id-1" } },
        { message: { id: "a", content: "a" } },
        { message: { role: "user", content: "no-id-2" } },
        { message: { id: "a", content: "a-again" } },
      ],
    };
    const result = dedupeRepoMessagesById(repo)!;
    // Two id-less entries survive; the duplicated "a" collapses to one.
    expect(result.messages).toHaveLength(3);
    expect(result.messages!.filter((m) => !m.message!.id)).toHaveLength(2);
  });

  it("passes through null / non-array repos without throwing", () => {
    expect(dedupeRepoMessagesById(null)).toBeNull();
    expect(dedupeRepoMessagesById(undefined)).toBeUndefined();
    expect(dedupeRepoMessagesById({} as NormalizedRepo)).toEqual({});
  });
});

describe("dropEmptyAssistantMessages", () => {
  it("drops empty assistant placeholders and repairs parent links", () => {
    const repo: NormalizedRepo = {
      headId: "assistant-1",
      messages: [
        { parentId: null, message: { id: "user-1", role: "user" } },
        {
          parentId: "user-1",
          message: { id: "empty", role: "assistant", content: [] },
        },
        {
          parentId: "empty",
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
          },
        },
      ],
    };

    const result = dropEmptyAssistantMessages(repo)!;

    expect(result).not.toBe(repo);
    expect(result.messages!.map((entry) => entry.message!.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(result.messages![1].parentId).toBe("user-1");
    expect(result.headId).toBe("assistant-1");
  });

  it("keeps tool-only assistant messages", () => {
    const repo: NormalizedRepo = {
      headId: "assistant-1",
      messages: [
        {
          parentId: null,
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "tool-call", toolName: "search" }],
          },
        },
      ],
    };

    expect(dropEmptyAssistantMessages(repo)).toBe(repo);
  });
});
