import { describe, expect, it } from "vitest";

import type { EngineMessage } from "./engine/types.js";
import {
  buildFollowUpCompletionMessages,
  FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION,
  FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
  followUpSuggestionsTool,
  identifyFollowUpSuggestions,
  parseFollowUpSuggestions,
} from "./follow-up-suggestions.js";

const suggestion = {
  label: "Refine the layout",
  prompt: "Refine the spacing in this design.",
};

describe("agent-authored follow-ups", () => {
  it("accepts zero to three distinct suggestions without inventing defaults", () => {
    expect(parseFollowUpSuggestions({ suggestions: [] }).success).toBe(true);
    const parsed = parseFollowUpSuggestions({
      suggestions: [
        { label: "  Refine layout  ", prompt: "  Improve its spacing.  " },
      ],
    });
    expect(parsed.success && parsed.data.suggestions).toEqual([
      { label: "Refine layout", prompt: "Improve its spacing." },
    ]);
    expect(
      parseFollowUpSuggestions({
        suggestions: Array.from({ length: 3 }, (_, index) => ({
          label: `Option ${index}`,
          prompt: `Request ${index}`,
        })),
      }).success,
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { suggestions: "invalid" },
    { suggestions: Array(4).fill(suggestion) },
    { suggestions: [{ ...suggestion, label: " " }] },
    { suggestions: [{ ...suggestion, label: "x".repeat(81) }] },
    { suggestions: [{ ...suggestion, label: "Two\nlines" }] },
    { suggestions: [{ ...suggestion, prompt: " " }] },
    { suggestions: [{ ...suggestion, prompt: "x".repeat(601) }] },
    { suggestions: [{ ...suggestion, runId: "forged-run" }] },
    { suggestions: [{ ...suggestion, id: "forged-id" }] },
    { suggestions: [{ ...suggestion, metadata: { unsafe: true } }] },
    {
      suggestions: [
        suggestion,
        {
          ...suggestion,
          label: suggestion.label.toUpperCase(),
          prompt: "Different request",
        },
      ],
    },
    { suggestions: [suggestion, { ...suggestion, label: "Different label" }] },
    { suggestions: [suggestion], runId: "forged-run" },
  ])(
    "rejects invalid, duplicate, oversized, or forged publication: %j",
    (input) => {
      expect(parseFollowUpSuggestions(input).success).toBe(false);
    },
  );

  it("assigns identity and time on the server, scoped to the canonical run", () => {
    const [first] = identifyFollowUpSuggestions([suggestion], "run-a");
    const [second] = identifyFollowUpSuggestions([suggestion], "run-b");
    expect(first).toEqual({
      ...suggestion,
      id: "run-a:follow-up:1",
      runId: "run-a",
      updatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(first.updatedAt!))).toBe(false);
    expect(first.id).not.toBe(second.id);
  });

  it("advertises the same bounded input contract to the model", () => {
    expect(followUpSuggestionsTool.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["suggestions"],
      properties: {
        suggestions: {
          type: "array",
          maxItems: 3,
          items: { required: ["label", "prompt"], additionalProperties: false },
        },
      },
    });
    expect(followUpSuggestionsTool.inputSchema).not.toHaveProperty("$schema");
    expect(followUpSuggestionsTool.description).toContain(
      "after observing the results",
    );
    expect(followUpSuggestionsTool.description).toContain(
      "current screen/selection",
    );
  });

  describe("completion digest", () => {
    const build = (input: {
      requestText?: string;
      replyText: string;
      toolNames?: string[];
    }) => buildFollowUpCompletionMessages({ toolNames: [], ...input });
    const textOf = (message: EngineMessage): string =>
      message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    const requestOf = (input: Parameters<typeof build>[0]) =>
      textOf(build(input)[0]);
    const replyOf = (input: Parameters<typeof build>[0]) =>
      textOf(build(input)[1]);
    const totalLength = (input: Parameters<typeof build>[0]) =>
      build(input).reduce((sum, message) => sum + textOf(message).length, 0);

    it("keeps the shape of a finished turn: request, reply, then the instruction as the last user message", () => {
      const messages = build({
        requestText: "Create a design.",
        replyText: "Created your design.",
        toolNames: ["generate-design"],
      });
      expect(messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
      ]);
      expect(textOf(messages[0])).toBe(
        "<user-request>\nCreate a design.\n</user-request>\n\n<tools-used>generate-design</tools-used>",
      );
      expect(textOf(messages[1])).toBe("Created your design.");
      expect(textOf(messages[2])).toBe(
        FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION,
      );
    });

    // scripts/qa-standalone-chat-dev-smoke.ts finds the follow-up pass by this
    // prefix on the last user message.
    it("leaves a prefix detector on the last user message matching the follow-up pass, even for a huge turn", () => {
      const prefix = "The final reply above has already been delivered.";
      for (const input of [
        { requestText: "hi", replyText: "ok" },
        { requestText: "q".repeat(100_000), replyText: "r".repeat(100_000) },
        { replyText: "" },
      ]) {
        const lastUser = build(input)
          .filter((m) => m.role === "user")
          .at(-1)!;
        expect(textOf(lastUser).startsWith(prefix)).toBe(true);
      }
    });

    it("keeps the head and tail of a long request, so the ask after a pasted document survives", () => {
      const input = {
        requestText: `INTRO ${"x".repeat(6_000)} FINAL-QUESTION: which segment grew?`,
        replyText: "ok",
      };
      const text = requestOf(input);
      expect(text).toContain("INTRO");
      expect(text).toContain("FINAL-QUESTION: which segment grew?");
      expect(text.length).toBeLessThan(3_000);
    });

    it("keeps the tail of a long reply, where its conclusions sit", () => {
      const input = {
        replyText: `OPENING ${"y".repeat(9_000)} RECOMMENDATION: ship the fix`,
      };
      const text = replyOf(input);
      expect(text).toContain("RECOMMENDATION: ship the fix");
      expect(text).not.toContain("OPENING");
      expect(text.length).toBeLessThan(5_000);
    });

    it("stays bounded however large the request, reply, and tool list grow", () => {
      expect(
        totalLength({
          requestText: "q".repeat(500_000),
          replyText: "r".repeat(500_000),
          toolNames: Array.from({ length: 500 }, (_, i) => `tool-${i}-name`),
        }),
      ).toBeLessThan(8_000);
    });

    it("sends a stated absence, never an empty message, for a missing request or reply", () => {
      const messages = build({ replyText: "  \n " });
      for (const message of messages) {
        expect(textOf(message).trim()).not.toBe("");
      }
      expect(messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
      ]);
    });

    it("never cuts the digest inside an emoji at the head or tail boundary", () => {
      const loneSurrogate =
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
      for (let pad = 0; pad < 2; pad += 1) {
        const input = {
          requestText: `${"a".repeat(499 + pad)}${"😀".repeat(2_000)}`,
          replyText: `${"😀".repeat(5_000)}${"c".repeat(pad)}`,
        };
        for (const message of build(input)) {
          expect(textOf(message)).not.toMatch(loneSurrogate);
        }
        expect(requestOf(input)).toContain("😀");
        expect(replyOf(input)).toContain("😀");
        expect(totalLength(input)).toBeLessThan(8_000);
      }
    });

    it("passes a short request and reply through unchanged", () => {
      const input = { requestText: "Hi there", replyText: "Done." };
      expect(requestOf(input)).toBe(
        "<user-request>\nHi there\n</user-request>",
      );
      expect(replyOf(input)).toBe("Done.");
    });

    it("lists each tool used once and never the follow-up tool itself", () => {
      const text = requestOf({
        replyText: "ok",
        toolNames: ["a", "b", "a", FOLLOW_UP_SUGGESTIONS_TOOL_NAME],
      });
      expect(text).toContain("<tools-used>a, b</tools-used>");
    });
  });
});
