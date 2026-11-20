import { describe, expect, it } from "vitest";

import {
  calculateFields,
  createBlock,
  deriveQuestions,
  evaluateFormula,
  hiddenFieldAnswers,
  questionBlocks,
  validateSubmission,
  type Block,
} from "./index.js";

const fruit = questionBlocks({
  id: "fruit",
  type: "MULTIPLE_CHOICE",
  title: "Pick a fruit",
  options: ["Apple", "Banana"],
});
const apple = fruit[1]?.uuid ?? "";
const banana = fruit[2]?.uuid ?? "";

function blocksWith(
  operator: "add" | "set" | "formula",
  value: string,
  type: "number" | "text" = "number",
): Block[] {
  return [
    createBlock("FORM_TITLE", { text: "Quiz" }),
    createBlock("CALCULATED_FIELDS", {
      fields: [{ id: "score", name: "score", type, initialValue: "" }],
    }),
    ...fruit,
    createBlock("CONDITIONAL_LOGIC", {
      condition: {
        type: "single",
        questionId: "fruit",
        comparison: "is",
        value: apple,
      },
      actions: [
        { type: "calculate", fieldId: "score", operator: operator, value },
      ],
    }),
    createBlock("CONDITIONAL_LOGIC", {
      condition: {
        type: "single",
        questionId: "fruit",
        comparison: "is",
        value: banana,
      },
      actions: [
        { type: "calculate", fieldId: "score", operator: "add", value: "5" },
      ],
    }),
  ];
}

describe("calculated fields", () => {
  it("recomputes from the current answers instead of accumulating", () => {
    const blocks = blocksWith("add", "10");
    expect(calculateFields(blocks, { fruit: { selected: [apple] } })).toEqual({
      score: 10,
    });
    expect(calculateFields(blocks, { fruit: { selected: [banana] } })).toEqual({
      score: 5,
    });
    expect(calculateFields(blocks, {})).toEqual({ score: 0 });
  });

  it("joins text and evaluates formulas", () => {
    const text = blocksWith("add", "x", "text");
    expect(calculateFields(text, { fruit: { selected: [apple] } })).toEqual({
      score: "x",
    });
    expect(evaluateFormula("(2 + 3) * 4 - 1", () => 0)).toBe(19);
    expect(evaluateFormula('"a" + 1', () => 0)).toBe("a1");
    expect(evaluateFormula("1 / 0", () => 0)).toBeNull();
    expect(evaluateFormula("{{answer:q}} * 2", () => 4)).toBe(8);
  });

  it("stores the computed value and ignores a forged one", () => {
    const blocks = blocksWith("add", "10");
    const checked = validateSubmission(blocks, {
      fruit: { selected: [apple] },
      score: 999,
    });
    expect(checked.answers["score"]).toBe(10);
  });
});

describe("hidden fields", () => {
  const blocks = [
    createBlock("FORM_TITLE", { text: "Hidden" }),
    createBlock("HIDDEN_FIELDS", { fields: [{ id: "h1", name: "ref" }] }),
    createBlock("THANK_YOU_PAGE", {}),
    createBlock("HIDDEN_FIELDS", { fields: [{ id: "h2", name: "utm" }] }),
  ];

  it("takes only parameters named like a field", () => {
    expect(hiddenFieldAnswers(blocks, "?ref=news&other=zzz")).toEqual({
      h1: "news",
    });
  });

  it("derives a column per field, even after the thank-you page", () => {
    expect(deriveQuestions(blocks).map((q) => q.title)).toEqual(["ref", "utm"]);
  });

  it("keeps hidden values and drops unknown answers", () => {
    const checked = validateSubmission(blocks, { h1: "news", nope: "x" });
    expect(checked.answers).toEqual({ h1: "news" });
  });
});
