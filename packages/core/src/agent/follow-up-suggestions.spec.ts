import { describe, expect, it } from "vitest";

import {
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
});
