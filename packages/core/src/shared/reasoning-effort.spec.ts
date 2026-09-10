import { describe, expect, it } from "vitest";

import {
  allowsSamplingParams,
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  normalizeReasoningEffortForModel,
  normalizeReasoningEffortForRequest,
  reasoningEffortLabel,
  resolveReasoningEffortSelection,
  stepDownReasoningEffort,
} from "./reasoning-effort.js";

describe("supportsClaudeXHigh (via getReasoningEffortOptionsForModel)", () => {
  it("uses High as the default and never exposes legacy Auto", () => {
    expect(DEFAULT_REASONING_EFFORT).toBe("high");
    expect(getReasoningEffortOptionsForModel("claude-sonnet-5")).not.toContain(
      "auto",
    );
    expect(reasoningEffortLabel("auto")).toBe("High");
  });

  it("includes xhigh for claude-opus-4-7", () => {
    const opts = getReasoningEffortOptionsForModel("claude-opus-4-7");
    expect(opts).toContain("xhigh");
  });

  it("includes xhigh for claude-opus-4-8", () => {
    const opts = getReasoningEffortOptionsForModel("claude-opus-4-8");
    expect(opts).toContain("xhigh");
  });

  it("recognizes OpenRouter-prefixed reasoning models", () => {
    expect(
      getReasoningEffortOptionsForModel("anthropic/claude-opus-4.8"),
    ).toContain("xhigh");
    expect(getReasoningEffortOptionsForModel("openai/gpt-5.6-terra")).toContain(
      "medium",
    );
    expect(
      getReasoningEffortOptionsForModel("google/gemini-2.5-flash"),
    ).toContain("medium");
  });

  it("includes xhigh for claude-fable-5 (Mythos-class model)", () => {
    const opts = getReasoningEffortOptionsForModel("claude-fable-5");
    expect(opts).toContain("xhigh");
  });

  it("includes xhigh for claude-sonnet-5", () => {
    const opts = getReasoningEffortOptionsForModel("claude-sonnet-5");
    expect(opts).toContain("xhigh");
  });

  it("does NOT include xhigh for claude-sonnet-4-6 (legacy Sonnet 4 tier)", () => {
    const opts = getReasoningEffortOptionsForModel("claude-sonnet-4-6");
    expect(opts).not.toContain("xhigh");
  });

  it("does NOT include xhigh for claude-haiku-4-5", () => {
    const opts = getReasoningEffortOptionsForModel("claude-haiku-4-5-20251001");
    expect(opts).not.toContain("xhigh");
  });
});

describe("normalizeReasoningEffortForModel", () => {
  it("normalizes xhigh to high for non-xhigh-supporting Claude models", () => {
    expect(normalizeReasoningEffortForModel("claude-sonnet-4-6", "xhigh")).toBe(
      "high",
    );
  });

  it("keeps xhigh for opus-4-8", () => {
    expect(normalizeReasoningEffortForModel("claude-opus-4-8", "xhigh")).toBe(
      "xhigh",
    );
  });

  it("keeps xhigh for claude-fable-5", () => {
    expect(normalizeReasoningEffortForModel("claude-fable-5", "xhigh")).toBe(
      "xhigh",
    );
  });

  it("keeps xhigh for claude-sonnet-5", () => {
    expect(normalizeReasoningEffortForModel("claude-sonnet-5", "xhigh")).toBe(
      "xhigh",
    );
  });

  it("normalizes legacy auto and missing effort to high", () => {
    expect(normalizeReasoningEffortForModel("claude-opus-4-8", "auto")).toBe(
      "high",
    );
    expect(normalizeReasoningEffortForModel("claude-opus-4-8", undefined)).toBe(
      "high",
    );
  });

  it("returns undefined for models that do not support reasoning", () => {
    // Groq models have no reasoning effort options
    expect(
      normalizeReasoningEffortForModel("llama-3.3-70b-versatile", "high"),
    ).toBeUndefined();
    expect(
      normalizeReasoningEffortForModel("claude-3-5-haiku-20241022", undefined),
    ).toBeUndefined();
  });
});

describe("resolveReasoningEffortSelection", () => {
  it("migrates legacy auto and missing selections to high", () => {
    expect(resolveReasoningEffortSelection("claude-sonnet-5", "auto")).toBe(
      "high",
    );
    expect(resolveReasoningEffortSelection("claude-sonnet-5", undefined)).toBe(
      "high",
    );
  });

  it("keeps supported explicit selections and resets unsupported ones", () => {
    expect(resolveReasoningEffortSelection("claude-sonnet-5", "high")).toBe(
      "high",
    );
    expect(resolveReasoningEffortSelection("claude-sonnet-4-6", "xhigh")).toBe(
      "high",
    );
  });
});

describe("normalizeReasoningEffortForRequest", () => {
  it("preserves explicit none and minimal instead of replacing them with Medium", () => {
    expect(normalizeReasoningEffortForRequest("claude-sonnet-5", "none")).toBe(
      "none",
    );
    expect(
      normalizeReasoningEffortForRequest("claude-sonnet-5", "minimal"),
    ).toBe("minimal");
  });

  it("uses High when the request omits an effort", () => {
    expect(
      normalizeReasoningEffortForRequest("claude-sonnet-5", undefined),
    ).toBe("high");
  });
});

describe("stepDownReasoningEffort", () => {
  it("steps down one tier at a time through the standard ladder", () => {
    expect(stepDownReasoningEffort("max")).toBe("xhigh");
    expect(stepDownReasoningEffort("xhigh")).toBe("high");
    expect(stepDownReasoningEffort("high")).toBe("medium");
    expect(stepDownReasoningEffort("medium")).toBe("low");
    expect(stepDownReasoningEffort("low")).toBe("minimal");
  });

  it("leaves minimal, none, and auto unchanged (nothing lower to step to)", () => {
    expect(stepDownReasoningEffort("minimal")).toBe("minimal");
    expect(stepDownReasoningEffort("none")).toBe("none");
    expect(stepDownReasoningEffort("auto")).toBe("auto");
  });

  it("passes through undefined unchanged", () => {
    expect(stepDownReasoningEffort(undefined)).toBeUndefined();
  });
});

describe("allowsSamplingParams", () => {
  it("blocks sampling whenever the request carries thinking", () => {
    expect(
      allowsSamplingParams({
        model: "claude-haiku-4-5-20251001",
        thinkingEnabled: true,
      }),
    ).toBe(false);
  });

  it("blocks sampling on the Claude families that removed it", () => {
    for (const model of [
      "claude-sonnet-5",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-fable-5",
      "anthropic/claude-sonnet-5",
    ]) {
      expect(allowsSamplingParams({ model, thinkingEnabled: false })).toBe(
        false,
      );
    }
  });

  it("keeps sampling on thinking-off models that still accept it", () => {
    for (const model of [
      "claude-haiku-4-5-20251001",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "gpt-5.6-sol",
      "gemini-3-1-pro",
    ]) {
      expect(allowsSamplingParams({ model, thinkingEnabled: false })).toBe(
        true,
      );
    }
  });

  it("leaves an unknown model alone", () => {
    expect(
      allowsSamplingParams({ model: undefined, thinkingEnabled: true }),
    ).toBe(true);
  });
});
