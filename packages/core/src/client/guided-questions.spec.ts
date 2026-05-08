import { describe, expect, it } from "vitest";
import {
  formatGuidedAnswersForAgent,
  getOtherGuidedAnswerText,
  hasGuidedAnswer,
  makeOtherGuidedAnswer,
  normalizeGuidedAnswers,
} from "./guided-questions.js";

describe("guided question answers", () => {
  it("requires Other answers to include custom text", () => {
    expect(hasGuidedAnswer(makeOtherGuidedAnswer())).toBe(false);
    expect(hasGuidedAnswer(makeOtherGuidedAnswer("bold editorial"))).toBe(
      true,
    );
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
});
