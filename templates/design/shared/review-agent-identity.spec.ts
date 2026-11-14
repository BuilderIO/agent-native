import { describe, expect, it } from "vitest";

import {
  agentMentionId,
  modelDisplayName,
  reviewAgentAuthorName,
} from "./review-agent-identity";

describe("modelDisplayName", () => {
  it.each([
    ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
    ["claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"],
    ["claude-opus-4-latest", "Claude Opus 4"],
    ["anthropic/claude-opus-5-5", "Claude Opus 5.5"],
    ["  claude-sonnet-5-5  ", "Claude Sonnet 5.5"],
    ["gpt-5-4-mini", "GPT-5.4 Mini"],
    ["gpt-5", "GPT-5"],
    ["gemini-3-pro", "Gemini 3 Pro"],
    ["llama-3-70b", "llama-3-70b"],
    ["groq/llama-3.1-8b-instant", "groq/llama-3.1-8b-instant"],
    ["claude-", "claude-"],
  ])("names %j as %j", (model, name) => {
    expect(modelDisplayName(model)).toBe(name);
  });

  it.each([null, undefined, "", "   "])("falls back to AI for %j", (model) => {
    expect(modelDisplayName(model)).toBe("AI");
  });
});

describe("reviewAgentAuthorName", () => {
  it.each([
    ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
    ["gpt-5-4-mini", "GPT-5.4 Mini"],
    ["llama-3-70b", "llama-3-70b"],
  ])("uses the display name for %j", (model, name) => {
    expect(reviewAgentAuthorName(model)).toBe(name);
  });

  it.each([null, undefined, "", "   "])(
    "falls back to Agent for %j",
    (model) => {
      expect(reviewAgentAuthorName(model)).toBe("Agent");
    },
  );
});

describe("agentMentionId", () => {
  it.each([
    {
      selection: { engine: "anthropic", model: "claude-sonnet-5-5" },
      id: "agent:anthropic:claude-sonnet-5-5",
    },
    {
      selection: { engine: "ai-sdk:openai", model: "gpt-5-4-mini" },
      id: "agent:ai-sdk:openai:gpt-5-4-mini",
    },
  ])("builds $id from the engine and raw model id", ({ selection, id }) => {
    expect(agentMentionId(selection)).toBe(id);
  });
});
