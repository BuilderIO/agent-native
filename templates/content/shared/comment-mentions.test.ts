import { describe, expect, it } from "vitest";

import {
  commentMentionsForText,
  parseCommentMentions,
  readStoredCommentMentions,
  serializeStoredCommentMentions,
} from "./comment-mentions";

describe("comment mentions", () => {
  it("reads rows written before mentions had a kind as people", () => {
    expect(
      readStoredCommentMentions(
        JSON.stringify([{ email: "sam@example.com", name: "Sam" }]),
      ),
    ).toEqual([{ kind: "person", email: "sam@example.com", name: "Sam" }]);
  });

  it("keeps an agent's model, engine, and provider", () => {
    expect(
      parseCommentMentions([
        {
          kind: "agent",
          model: "claude-sonnet-4-6",
          engine: "anthropic",
          provider: "Anthropic",
          name: "Claude Sonnet 4.6",
        },
      ]),
    ).toEqual([
      {
        kind: "agent",
        model: "claude-sonnet-4-6",
        engine: "anthropic",
        provider: "Anthropic",
        name: "Claude Sonnet 4.6",
      },
    ]);
  });

  it("rejects a submitted mention it cannot identify", () => {
    expect(() => parseCommentMentions([{ kind: "agent", name: "AI" }])).toThrow(
      "Comment agent mention model is required",
    );
    expect(() =>
      parseCommentMentions([{ kind: "team", email: "a@example.com" }]),
    ).toThrow("Comment mention kind must be person or agent");
    expect(() => parseCommentMentions([{ name: "Sam" }])).toThrow(
      "Comment mention email is required",
    );
    expect(() => parseCommentMentions("{not-json")).toThrow(
      "Comment mentions metadata is not valid JSON",
    );
  });

  it("skips unreadable stored entries without losing the readable ones", () => {
    expect(
      readStoredCommentMentions(
        JSON.stringify([
          { name: "No email" },
          { kind: "person", email: "sam@example.com", name: "Sam" },
        ]),
      ),
    ).toEqual([{ kind: "person", email: "sam@example.com", name: "Sam" }]);
    expect(readStoredCommentMentions("{not-json")).toEqual([]);
    expect(readStoredCommentMentions(null)).toEqual([]);
  });

  it("stores each mention named in the text once", () => {
    const sam = {
      kind: "person" as const,
      email: "sam@example.com",
      name: "Sam",
    };
    const claude = {
      kind: "agent" as const,
      model: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
    };
    const removed = {
      kind: "person" as const,
      email: "lee@example.com",
      name: "Lee",
    };
    expect(
      commentMentionsForText("@Sam ask @Claude Sonnet 4.6, then @Sam again", [
        sam,
        { ...sam, email: "SAM@example.com" },
        claude,
        removed,
      ]),
    ).toBe(serializeStoredCommentMentions([sam, claude]));
    expect(commentMentionsForText("No mentions", [sam])).toBeUndefined();
  });

  it("stores the same mentions the same way whatever order their keys came in", () => {
    expect(
      serializeStoredCommentMentions(
        parseCommentMentions([
          { name: "Sam", email: "sam@example.com", kind: "person" },
        ]),
      ),
    ).toBe('[{"kind":"person","email":"sam@example.com","name":"Sam"}]');
    expect(serializeStoredCommentMentions([])).toBeNull();
  });
});
