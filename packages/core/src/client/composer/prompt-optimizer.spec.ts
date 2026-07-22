import { describe, expect, it } from "vitest";

import {
  evaluatePromptOptimization,
  optimizePromptSubmission,
} from "./prompt-optimizer.js";

describe("evaluatePromptOptimization", () => {
  it("returns shouldOptimize false for empty or short text", () => {
    const shortResult = evaluatePromptOptimization(
      "Fix the alignment of this button.",
    );
    expect(shortResult.shouldOptimize).toBe(false);
    expect(shortResult.estimatedTextTokens).toBeLessThan(100);
    expect(shortResult.expectedTokenSavings).toBeLessThanOrEqual(0);
  });

  it("evaluates large text payloads and recommends vision conversion", () => {
    // Generate ~20,000 character prompt
    const largePrompt =
      "Line of prompt content for task specification.\n".repeat(450);
    const result = evaluatePromptOptimization(largePrompt);

    expect(result.shouldOptimize).toBe(true);
    expect(result.estimatedTextTokens).toBeGreaterThan(3500);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.savingsPercentage).toBeGreaterThanOrEqual(40);
  });

  it("handles multi-language Unicode prompts (CJK, Arabic, Hindi, Spanish)", () => {
    const multiLangPrompt =
      "这是一个 multi-language prompt test: العربية, हिन्दी, 日本語, Español.\n".repeat(
        300,
      );
    const result = evaluatePromptOptimization(multiLangPrompt);

    expect(result.shouldOptimize).toBe(true);
    expect(result.estimatedTextTokens).toBeGreaterThan(3500);
  });
});

describe("optimizePromptSubmission", () => {
  it("passes short prompts through unchanged", async () => {
    const prompt = "Short user prompt";
    const res = await optimizePromptSubmission(prompt);

    expect(res.isOptimized).toBe(false);
    expect(res.promptText).toBe(prompt);
    expect(res.attachments).toBeUndefined();
  });

  it("handles environment fallback gracefully if canvas is unavailable", async () => {
    // In Node test environment without browser Canvas, it falls back to raw prompt
    const largePrompt = "Heavy text payload content.\n".repeat(500);
    const res = await optimizePromptSubmission(largePrompt);

    // In non-DOM environment, fail-safe should catch and return raw prompt without throwing
    expect(res).toBeDefined();
    expect(typeof res.promptText).toBe("string");
  });

  it("handles pasted-text attachments gracefully in non-browser environments", async () => {
    const largeText = "Large pasted text spec document content line.\n".repeat(
      450,
    );
    const res = await optimizePromptSubmission("Use the attached context.", {
      attachments: [
        {
          type: "file",
          name: "pasted-text-1784738614897-g1f8se.txt",
          contentType: "text/plain",
          text: largeText,
        },
      ],
    });

    expect(res).toBeDefined();
    expect(res.attachments).toHaveLength(1);
  });
});
