import { describe, expect, it } from "vitest";

import { commentAiSelections } from "./CommentAiRecipient";

// The groups a user with Builder.io connected and provider keys set gets.
const groups = [
  {
    engine: "builder",
    label: "OpenAI · Builder.io",
    models: ["gpt-5-4-mini", "gpt-5-4"],
  },
  {
    engine: "builder",
    label: "Claude · Builder.io",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  },
  { engine: "openai", label: "OpenAI", models: ["gpt-5.4-mini", "gpt-5.4"] },
  {
    engine: "anthropic",
    label: "Claude",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-fable-5-1"],
  },
];

const rows = (current: { model: string; engine: string }) =>
  commentAiSelections(groups, current).map(
    ({ model, engine }) => `${engine}:${model}`,
  );

describe("commentAiSelections", () => {
  it("lists a model once even when two sources name it differently", () => {
    expect(rows({ model: "claude-sonnet-5-5", engine: "builder" })).toEqual([
      "builder:gpt-5-4-mini",
      "builder:gpt-5-4",
      "builder:claude-haiku-5-5",
      "builder:claude-sonnet-5-5",
      "anthropic:claude-fable-5-1",
    ]);
  });

  it("keeps the source of the current choice, in the same order", () => {
    expect(rows({ model: "claude-sonnet-5-5", engine: "anthropic" })).toEqual([
      "builder:gpt-5-4-mini",
      "builder:gpt-5-4",
      "anthropic:claude-haiku-5-5",
      "anthropic:claude-sonnet-5-5",
      "anthropic:claude-fable-5-1",
    ]);
  });

  it("keeps the current choice when its engine names one model twice", () => {
    expect(
      commentAiSelections(
        [
          {
            engine: "anthropic",
            label: "Claude",
            models: ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
          },
        ],
        { model: "claude-haiku-4-5-20251001", engine: "anthropic" },
      ),
    ).toEqual([
      {
        model: "claude-haiku-4-5-20251001",
        engine: "anthropic",
        provider: "Claude",
      },
    ]);
  });
});
