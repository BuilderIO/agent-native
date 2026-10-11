import { describe, expect, it } from "vitest";

import {
  commentMentionsForText,
  findCommentMentions,
  mentionsMissingFromText,
  parseCommentMentions,
  readStoredCommentMentions,
  serializeStoredCommentMentions,
  type CommentMention,
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

  it("rejects a submitted mention whose name or agent identity is not text", () => {
    expect(() =>
      parseCommentMentions([{ kind: "agent", model: "m", name: 42 }]),
    ).toThrow("Comment mention name is required");
    expect(() =>
      parseCommentMentions([{ email: "sam@example.com", name: " " }]),
    ).toThrow("Comment mention name is required");
    expect(() =>
      parseCommentMentions([
        { kind: "agent", model: "m", name: "Agent", engine: 7 },
      ]),
    ).toThrow("Comment agent mention engine must be a string");
    expect(() =>
      parseCommentMentions([
        { kind: "agent", model: "m", name: "Agent", provider: {} },
      ]),
    ).toThrow("Comment agent mention provider must be a string");
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

  it("matches a stored name only as a whole @ token, longest first", () => {
    const sam = {
      kind: "person" as const,
      email: "sam@example.com",
      name: "Sam",
    };
    const samLee = {
      kind: "person" as const,
      email: "sam.lee@example.com",
      name: "Sam Lee",
    };
    const text = "@Sam Lee, @Sam. Not @Samantha or me@Sam.com";

    expect(
      findCommentMentions(text, [sam, samLee]).map(({ start, name }) => [
        start,
        name,
      ]),
    ).toEqual([
      [0, "Sam Lee"],
      [10, "Sam"],
    ]);
    expect(commentMentionsForText("Ask @Samantha", [sam])).toBeUndefined();
  });

  it("keeps agents on one model from different providers apart", () => {
    const one = {
      kind: "agent" as const,
      model: "m",
      provider: "One",
      name: "Agent One",
    };
    const two = { ...one, provider: "Two", name: "Agent Two" };

    expect(
      commentMentionsForText("@Agent One and @Agent Two", [one, two]),
    ).toBe(serializeStoredCommentMentions([one, two]));
  });

  it("gives each of two people who share a name their own pill, in text order", () => {
    const first = {
      kind: "person" as const,
      email: "a@example.com",
      name: "Sam",
    };
    const second = {
      kind: "person" as const,
      email: "b@example.com",
      name: "Sam",
    };
    const roundTrip = (text: string, chips: CommentMention[]) =>
      findCommentMentions(
        text,
        readStoredCommentMentions(commentMentionsForText(text, chips) ?? null),
      ).map(({ mention }) => mention);

    expect(findCommentMentions("Hi @Sam and @Sam", [first, second])).toEqual([
      { start: 3, name: "Sam", mention: first },
      { start: 12, name: "Sam", mention: second },
    ]);
    expect(
      commentMentionsForText("@Sam @Sam @Sam", [first, second, second]),
    ).toBe(serializeStoredCommentMentions([first, second]));
    for (const chips of [
      [first, second],
      [second, first],
      [first, first, second],
      [first, second, first],
    ]) {
      const text = chips.map(() => "@Sam").join(" and ");
      expect(roundTrip(text, chips)).toEqual(chips);
    }
  });

  it("never draws a shorter name inside a longer one two people share", () => {
    const samLee = (email: string) => ({
      kind: "person" as const,
      email,
      name: "Sam Lee",
    });
    const sam = {
      kind: "person" as const,
      email: "sam@example.com",
      name: "Sam",
    };
    const text = "Hi @Sam Lee and @Sam Lee and @Sam";

    const stored = readStoredCommentMentions(
      commentMentionsForText(text, [
        samLee("a@example.com"),
        samLee("b@example.com"),
        sam,
      ]) ?? null,
    );

    expect(findCommentMentions(text, stored)).toEqual([
      { start: 3, name: "Sam Lee", mention: samLee("a@example.com") },
      { start: 16, name: "Sam Lee", mention: samLee("b@example.com") },
      { start: 29, name: "Sam", mention: sam },
    ]);
  });

  it("names a mention no @name resolves to, including a second person sharing one @name", () => {
    const first = {
      kind: "person" as const,
      email: "a@example.com",
      name: "Sam",
    };
    const second = { ...first, email: "b@example.com" };
    const repeat = { ...first, email: "A@example.com" };

    expect(mentionsMissingFromText("Hi @Sam", [first, second])).toEqual([
      second,
    ]);
    expect(mentionsMissingFromText("Hi @Sam", [first, repeat])).toEqual([]);
    expect(mentionsMissingFromText("Hi @Samuel", [first])).toEqual([first]);
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
