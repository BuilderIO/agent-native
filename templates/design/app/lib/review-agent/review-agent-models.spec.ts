import { agentMentionId } from "@shared/review-agent-identity";
import { describe, expect, it } from "vitest";

import {
  firstAgentMention,
  isAgentMention,
  resolveReviewAgentMention,
  reviewAgentMentionOption,
  reviewAgentSelections,
} from "./review-agent-models";

const anthropic = {
  engine: "anthropic",
  label: "Anthropic",
  models: ["claude-sonnet-5-5", "claude-opus-5-5"],
};
const builder = {
  engine: "builder",
  label: "Builder.io",
  models: ["claude-sonnet-5-5", "gpt-5-4"],
};

describe("reviewAgentSelections", () => {
  it("lists every model once across engines", () => {
    const selections = reviewAgentSelections([anthropic, builder], {
      model: "claude-sonnet-5-5",
      engine: "anthropic",
    });
    expect(selections.map((s) => `${s.engine}:${s.model}`)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "anthropic:claude-opus-5-5",
      "builder:gpt-5-4",
    ]);
  });

  it("keeps the current engine's copy of a model both engines offer", () => {
    const selections = reviewAgentSelections([anthropic, builder], {
      model: "gpt-5-4",
      engine: "builder",
    });
    expect(
      selections.find((s) => s.model === "claude-sonnet-5-5")?.engine,
    ).toBe("builder");
  });

  it("is empty when no engine offers a model", () => {
    expect(reviewAgentSelections([], { model: "", engine: "" })).toEqual([]);
  });
});

describe("reviewAgentMentionOption", () => {
  it("names the model, keys it as an agent, and puts the provider in the description", () => {
    expect(
      reviewAgentMentionOption({
        model: "claude-sonnet-5-5",
        engine: "anthropic",
        provider: "Anthropic",
      }),
    ).toEqual({
      id: "agent:anthropic:claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      email: null,
      description: "Anthropic",
    });
  });
});

describe("agent mentions", () => {
  const person = { label: "Alice", email: "alice@example.com" };
  const agent = { label: "Claude Sonnet 5.5", email: null, id: "agent:a:m" };

  it("tells an agent chip from a person by its id", () => {
    expect(isAgentMention(agent)).toBe(true);
    expect(isAgentMention(person)).toBe(false);
    expect(isAgentMention({ label: "x", id: null })).toBe(false);
  });

  it("picks the first agent chip and leaves the rest as plain mentions", () => {
    const second = { ...agent, id: "agent:b:n", label: "GPT-5.4" };
    expect(firstAgentMention([person, agent, second])).toBe(agent);
    expect(firstAgentMention([person])).toBeNull();
    expect(firstAgentMention([])).toBeNull();
  });

  it("resolves a stored chip against the live selections, or null once its model is gone", () => {
    const selection = {
      model: "claude-sonnet-5-5",
      engine: "anthropic",
      provider: "Anthropic",
    };
    const chip = { label: "Claude Sonnet 5.5", id: agentMentionId(selection) };
    expect(resolveReviewAgentMention([selection], chip)).toBe(selection);
    expect(resolveReviewAgentMention([], chip)).toBeNull();
    expect(resolveReviewAgentMention([selection], person)).toBeNull();
  });
});
