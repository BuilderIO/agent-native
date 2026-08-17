import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import {
  brainFinalResponseGuard,
  isCorrectionFollowUp,
  isCompanyKnowledgeQuestion,
} from "./brain-response-guard.js";

function guardContext(
  overrides: Partial<AgentLoopFinalResponseGuardContext> = {},
): AgentLoopFinalResponseGuardContext {
  const requestText = overrides.requestText ?? "";
  return {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: requestText }],
      },
    ],
    requestText,
    assistantContent: [],
    text: "",
    toolCalls: [],
    toolResults: [],
    retryCount: 0,
    executionMode: "act",
    ...overrides,
  };
}

function askBrainResult(citations: unknown[]) {
  return {
    name: "ask-brain",
    isError: false,
    content: JSON.stringify({
      answer: "Grounded Brain answer",
      citations,
    }),
  };
}

describe("Brain company-knowledge response guard", () => {
  it("identifies company-specific questions without gating general knowledge", () => {
    expect(
      isCompanyKnowledgeQuestion("What is Builder's mission statement?"),
    ).toBe(true);
    expect(isCompanyKnowledgeQuestion("What is our product strategy?")).toBe(
      true,
    );
    expect(
      isCompanyKnowledgeQuestion("What retailer is Nick Nestle demoing to?"),
    ).toBe(true);
    expect(isCompanyKnowledgeQuestion("Where was that pulled from?")).toBe(
      true,
    );
    expect(isCompanyKnowledgeQuestion("What is photosynthesis?")).toBe(false);
    expect(isCompanyKnowledgeQuestion("How do I import a transcript?")).toBe(
      false,
    );
  });

  it("recognizes correction follow-ups that must reset answer context", () => {
    expect(isCorrectionFollowUp("Why did it do that?")).toBe(true);
    expect(isCorrectionFollowUp("That's wrong - not what I asked.")).toBe(true);
    expect(isCorrectionFollowUp("What is our product strategy?")).toBe(false);
  });

  it("requires ask-brain before accepting a company-specific answer", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "What is Builder's mission statement?",
        text: "Builder's mission is Visual development for all.",
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
      retryMessage: expect.stringContaining("Call `ask-brain`"),
      fallbackMessage: expect.stringContaining("couldn't verify"),
    });
  });

  it("accepts a response grounded by cited ask-brain evidence", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "What is Builder's mission statement?",
        text: "Builder's mission is documented in Brain.",
        toolResults: [askBrainResult([{ id: "citation-1" }])],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not let the model fill a no-citation result from memory", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "What is Builder's mission statement?",
        text: "Builder's mission is Visual development for all.",
        toolResults: [askBrainResult([])],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("do not fill the gap from memory"),
    });
  });

  it("allows an explicit unavailable response when Brain has no citation", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "What is Builder's mission statement?",
        text: "I don't have a verified source for Builder's official mission statement.",
        toolResults: [askBrainResult([])],
      }),
    );

    expect(result).toBeNull();
  });

  it("rejects a correction answer that keeps using the earlier context", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "Why did it do that?",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Earlier answer about Brent." }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Why did it do that?" }],
          },
        ],
        text: "Brent's individual feedback explains the strategy.",
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 1,
      retryMessage: expect.stringContaining("untrusted context"),
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "Raw captures are leads",
    );
  });

  it("accepts a correction that explicitly names the context mistake", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "Why did it do that?",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Earlier answer about Brent." }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Why did it do that?" }],
          },
        ],
        text: "You're right. I over-indexed on the earlier request and carried an irrelevant example into the answer.",
      }),
    );

    expect(result).toBeNull();
  });

  it("does not let an unsupported claim hide behind an uncertainty caveat", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "What is Builder's mission statement?",
        text: "I couldn't verify this, but historically Builder's mission was Visual development for all.",
      }),
    );

    expect(result).not.toBeNull();
  });

  it("does not enforce the answer guard in plan mode", () => {
    const result = brainFinalResponseGuard(
      guardContext({
        requestText: "What is Builder's mission statement?",
        text: "Builder's mission is Visual development for all.",
        executionMode: "plan",
      }),
    );

    expect(result).toBeNull();
  });
});
