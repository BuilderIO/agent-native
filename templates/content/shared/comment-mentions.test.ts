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
    expect(
      parseCommentMentions([
        { email: "sam@example.com", name: "S".repeat(256) },
      ]),
    ).toHaveLength(1);
    expect(() =>
      parseCommentMentions([
        { email: "sam@example.com", name: "S".repeat(257) },
      ]),
    ).toThrow("Comment mention name must be at most 256 characters");
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

  it("never matches an @name in inline code or a URL", () => {
    const sam = {
      kind: "person" as const,
      email: "sam@example.com",
      name: "Sam",
    };
    const text =
      "Ask @Sam, not `@Sam`, ``a `@Sam` b``, https://medium.com/@Sam, //cdn.example.com/@Sam, github.com/@Sam, (x.com/@Sam), [site](example.com/@Sam), [site](example.com?user=@Sam), x.com#@Sam, [site](<x.com/@Sam>), [@Sam](https://x.com), [@Sam](https://x.com/Sam_(name)), [@Sam](https://x.com/a_(b_(c))), or www.example.com/@Sam. A lone ` leaves @Sam";

    expect(findCommentMentions(text, [sam]).map(({ start }) => start)).toEqual([
      4,
      text.lastIndexOf("@Sam"),
    ]);
    expect(mentionsMissingFromText("See `@Sam`", [sam])).toEqual([sam]);
    expect(
      commentMentionsForText("https://example.com/@Sam", [sam]),
    ).toBeUndefined();
  });

  it("never matches an @name in a link the comment defines by reference", () => {
    const sam = {
      kind: "person" as const,
      email: "sam@example.com",
      name: "Sam",
    };
    const text =
      "See [@Sam][profile], [@Sam][], and [@Sam], then ask @Sam.\n\n[Profile]: https://x.com/p\n[@sam]: https://x.com/s";

    expect(findCommentMentions(text, [sam]).map(({ start }) => start)).toEqual([
      text.indexOf("ask @Sam") + 4,
    ]);
    expect(
      findCommentMentions("Ask [@Sam], with no definition", [sam]).map(
        ({ start }) => start,
      ),
    ).toEqual([5]);
  });

  it("reads a long run of @s in a URL, code, or unclosed links without rescanning it", () => {
    const sam = {
      kind: "person" as const,
      email: "sam@example.com",
      name: "Sam",
    };
    const text = `https://x.com/${"@".repeat(100_000)} ${"`@` ".repeat(30_000)}${"[@](@(@".repeat(30_000)}\n@Sam`;

    const started = performance.now();
    const starts = findCommentMentions(text, [sam]).map(({ start }) => start);
    const elapsedMs = performance.now() - started;

    expect(starts).toEqual([text.length - 4]);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("matches many listed names against many @s without trying each name at each @", () => {
    const people = Array.from({ length: 20_000 }, (_, index) => ({
      kind: "person" as const,
      email: `person${index}@example.com`,
      name: `Person ${index}`,
    }));
    const sams = Array.from({ length: 20_000 }, (_, index) => ({
      kind: "person" as const,
      email: `sam${index}@example.com`,
      name: "Sam",
    }));
    const text = `${"a.".repeat(50_000)} ${"@".repeat(50_000)} @Person 7 @Sam`;

    const started = performance.now();
    const matches = findCommentMentions(text, [...people, ...sams]);
    const elapsedMs = performance.now() - started;

    expect(matches.map(({ mention }) => mention)).toEqual([people[7], sams[0]]);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("reads name boundaries by code point, with combining marks", () => {
    const person = (name: string) => ({
      kind: "person" as const,
      email: `${name}@example.com`,
      name,
    });
    const sam = person("Sam");
    const jose = person("Jose");
    const deseret = person("Sam\u{10400}");
    const starts = (text: string, mentions: CommentMention[]) =>
      findCommentMentions(text, mentions).map(({ start, mention }) => [
        start,
        mention.name,
      ]);

    expect(starts("@Sam\u{10400}x and \u{10400}@Sam", [sam])).toEqual([]);
    expect(starts("@José and é@Sam", [jose, sam])).toEqual([]);
    expect(starts("@Sam\u{10400}, @Sam", [sam, deseret])).toEqual([
      [0, "Sam\u{10400}"],
      [8, "Sam"],
    ]);
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
