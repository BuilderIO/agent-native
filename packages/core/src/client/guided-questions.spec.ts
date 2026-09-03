import { describe, expect, it } from "vitest";

import {
  formatGuidedAnswersForAgent,
  getOtherGuidedAnswerText,
  guidedQuestionsFingerprint,
  hasGuidedAnswer,
  makeOtherGuidedAnswer,
  normalizeGuidedAnswers,
} from "./guided-questions.js";

describe("guided question answers", () => {
  it("requires Other answers to include custom text", () => {
    expect(hasGuidedAnswer(makeOtherGuidedAnswer())).toBe(false);
    expect(hasGuidedAnswer(makeOtherGuidedAnswer("bold editorial"))).toBe(true);
    expect(getOtherGuidedAnswerText(makeOtherGuidedAnswer("custom"))).toBe(
      "custom",
    );
  });

  it("normalizes custom answers before submitting to the agent", () => {
    expect(
      normalizeGuidedAnswers({
        style: makeOtherGuidedAnswer("monochrome grid"),
        audience: "board",
        emptyOther: makeOtherGuidedAnswer(""),
      }),
    ).toEqual({
      style: "Other: monochrome grid",
      audience: "board",
      emptyOther: "",
    });
  });

  it("formats multi-select answers compactly", () => {
    expect(
      formatGuidedAnswersForAgent({
        sections: ["overview", makeOtherGuidedAnswer("risks")],
        density: "balanced",
      }),
    ).toBe("sections: overview, Other: risks\ndensity: balanced");
  });

  it("builds stable fingerprints for equivalent question payloads", () => {
    const questions = [
      {
        id: "form_factor",
        type: "text-options" as const,
        question: "What form factor?",
        options: [{ label: "Mobile", value: "mobile" }],
      },
    ];
    const clone = structuredClone(questions);
    expect(guidedQuestionsFingerprint(questions)).toBe(
      guidedQuestionsFingerprint(clone),
    );
    expect(guidedQuestionsFingerprint(questions)).not.toBe(
      guidedQuestionsFingerprint([
        {
          ...questions[0],
          options: [{ label: "Desktop", value: "desktop" }],
        },
      ]),
    );
  });
});
