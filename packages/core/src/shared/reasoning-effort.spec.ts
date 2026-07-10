import { describe, expect, it } from "vitest";

import {
  getReasoningEffortOptionsForModel,
  normalizeReasoningEffortForModel,
  resolvesToDefaultThinking,
  stepDownReasoningEffort,
} from "./reasoning-effort.js";

describe("supportsClaudeXHigh (via getReasoningEffortOptionsForModel)", () => {
  it("includes xhigh for claude-opus-4-7", () => {
    const opts = getReasoningEffortOptionsForModel("claude-opus-4-7");
    expect(opts).toContain("xhigh");
  });

  it("includes xhigh for claude-opus-4-8", () => {
    const opts = getReasoningEffortOptionsForModel("claude-opus-4-8");
    expect(opts).toContain("xhigh");
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

  it("returns undefined for auto effort", () => {
    expect(
      normalizeReasoningEffortForModel("claude-opus-4-8", "auto"),
    ).toBeUndefined();
  });

  it("returns undefined for models that do not support reasoning", () => {
    // Groq models have no reasoning effort options
    expect(
      normalizeReasoningEffortForModel("llama-3.3-70b-versatile", "high"),
    ).toBeUndefined();
  });
});

describe("resolvesToDefaultThinking", () => {
  it("is true for auto effort on claude-fable-5", () => {
    expect(resolvesToDefaultThinking("claude-fable-5", "auto")).toBe(true);
  });

  it("is true for unset effort on claude-sonnet-5", () => {
    expect(resolvesToDefaultThinking("claude-sonnet-5", undefined)).toBe(true);
  });

  it("is true for auto effort on the haiku-4-5 era", () => {
    expect(resolvesToDefaultThinking("claude-haiku-4-5-20251001", "auto")).toBe(
      true,
    );
  });

  it("is true for auto effort on opus-4-6", () => {
    expect(resolvesToDefaultThinking("claude-opus-4-6", "auto")).toBe(true);
  });

  it("is false for auto effort on a non-reasoning-capable model", () => {
    expect(resolvesToDefaultThinking("llama-3.3-70b-versatile", "auto")).toBe(
      false,
    );
    expect(resolvesToDefaultThinking(undefined, "auto")).toBe(false);
  });

  it("is false for an explicit non-auto effort", () => {
    expect(resolvesToDefaultThinking("claude-sonnet-5", "high")).toBe(false);
  });

  it("is false when effort is explicitly none or minimal", () => {
    expect(resolvesToDefaultThinking("claude-sonnet-5", "none")).toBe(false);
    expect(resolvesToDefaultThinking("claude-sonnet-5", "minimal")).toBe(false);
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
