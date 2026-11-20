import { describe, expect, it } from "vitest";

import {
  mentionToken,
  parseMentions,
  resolveMentions,
  serializeMentions,
} from "./mentions";

describe("mentions", () => {
  it("round-trips text with answer and metadata mentions", () => {
    const text = "Hi {{answer:q-1}}, ref {{meta:submission-id}}!";
    const segments = parseMentions(text);
    expect(segments).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", ref: { kind: "answer", questionId: "q-1" } },
      { type: "text", text: ", ref " },
      { type: "mention", ref: { kind: "meta", field: "submission-id" } },
      { type: "text", text: "!" },
    ]);
    expect(serializeMentions(segments)).toBe(text);
  });

  it("leaves plain text and unknown metadata tokens alone", () => {
    expect(parseMentions("no tokens")).toEqual([
      { type: "text", text: "no tokens" },
    ]);
    expect(serializeMentions(parseMentions("{{meta:nope}}"))).toBe(
      "{{meta:nope}}",
    );
  });

  it("builds the token a parse reads back", () => {
    const ref = { kind: "answer", questionId: "abc:def" } as const;
    expect(parseMentions(mentionToken(ref))).toEqual([
      { type: "mention", ref },
    ]);
  });

  it("resolves mentions, using an empty value for unanswered ones", () => {
    const answers: Record<string, string> = { a: "Ada" };
    const text = "Thanks {{answer:a}}{{answer:b}}, from {{meta:form-name}}";
    expect(
      resolveMentions(text, (ref) =>
        ref.kind === "answer" ? (answers[ref.questionId] ?? "") : "Survey",
      ),
    ).toBe("Thanks Ada, from Survey");
  });
});
