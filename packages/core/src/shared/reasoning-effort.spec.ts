import { describe, expect, it } from "vitest";
import {
  getReasoningEffortOptionsForModel,
  normalizeReasoningEffortForModel,
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

  it("does NOT include xhigh for claude-sonnet-4-6 (only opus/fable-5 tier)", () => {
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
