import { describe, expect, it } from "vitest";

import {
  formatGuidedAnswersForAgent,
  type GuidedQuestion,
} from "./guided-questions.js";

// The agent's `ask-question` tool ids every question it ever asks `q1`
// (see server/agent-chat/context-tools.ts). An answer message that says only
// `q1: Weekly` is meaningless unless the turn that asked survives history
// trimming next to it, and several such messages in one thread are
// indistinguishable from each other. That is what made the agent re-ask
// already-answered scope questions instead of proceeding, so the submitted
// answer has to restate its own question.

function askQuestion(question: string): GuidedQuestion {
  return {
    id: "q1",
    type: "text-options",
    question,
    options: [{ label: "Weekly", value: "Weekly" }],
  };
}

describe("formatGuidedAnswersForAgent", () => {
  it("restates the question next to the answer", () => {
    const formatted = formatGuidedAnswersForAgent({ q1: "Weekly" }, [
      askQuestion("What time grain should the dashboard use?"),
    ]);

    expect(formatted).toBe(
      "Q: What time grain should the dashboard use?\nA: Weekly",
    );
    // The opaque id must not be the only label the model gets.
    expect(formatted).not.toMatch(/^q1: /m);
  });

  it("distinguishes answers to different questions that share an id", () => {
    const grain = formatGuidedAnswersForAgent({ q1: "Weekly" }, [
      askQuestion("What time grain?"),
    ]);
    const orgs = formatGuidedAnswersForAgent({ q1: "Internal orgs" }, [
      askQuestion("Which orgs should be excluded?"),
    ]);

    expect(grain).not.toBe(orgs);
    expect(grain).toContain("What time grain?");
    expect(orgs).toContain("Which orgs should be excluded?");
  });

  it("labels multi-select answers with their question", () => {
    const formatted = formatGuidedAnswersForAgent(
      { q1: ["Sessions", "Edits"] },
      [askQuestion("Which effort signals count?")],
    );

    expect(formatted).toBe(
      "Q: Which effort signals count?\nA: Sessions, Edits",
    );
  });

  it("keeps meaningful ids as labels when no question is supplied", () => {
    // App callers (Design, Slides) pass their own descriptive ids and no
    // question list. That form still reads correctly and must not change.
    expect(
      formatGuidedAnswersForAgent({
        sections: ["overview", "risks"],
        density: "balanced",
      }),
    ).toBe("sections: overview, risks\ndensity: balanced");
  });

  it("falls back to the id when the question has no text", () => {
    expect(
      formatGuidedAnswersForAgent({ q1: "Weekly" }, [
        { id: "q1", type: "text-options", question: "   " },
      ]),
    ).toBe("q1: Weekly");
  });
});
