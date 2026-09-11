import { describe, expect, it } from "vitest";

import { resolveRecapUsageCost } from "./record-recap-usage-cost.js";

describe("record recap usage cost", () => {
  it("marks compatible-provider cost unavailable when the provider reports no cost", () => {
    expect(
      resolveRecapUsageCost({
        agent: "openai-compatible",
        model: "deepseek-chat",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toEqual({ costCentsX100: null, costSource: "unavailable" });
  });

  it("uses a provider-reported cost for compatible providers when present", () => {
    expect(
      resolveRecapUsageCost({
        agent: "openai-compatible",
        model: "deepseek-chat",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reportedCostUsd: 0.0123,
      }),
    ).toEqual({ costCentsX100: 123, costSource: "reported" });
  });

  it("uses the shared estimator for standard backends", () => {
    expect(
      resolveRecapUsageCost(
        {
          agent: "codex",
          model: "gpt-5.6-sol",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        () => 42,
      ),
    ).toEqual({ costCentsX100: 42, costSource: "estimated" });
  });
});
