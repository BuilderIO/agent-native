import { describe, expect, it } from "vitest";

import { DecisionResponseError, parseDecisionAnswers } from "./response.js";
import type { DecisionQuestion } from "./types.js";

const choiceQuestion: DecisionQuestion = {
  type: "choice",
  name: "route",
  instructions: "Choose a route.",
  choices: [
    { value: "billing", description: "Payment questions" },
    { value: "technical", description: "Product questions" },
  ],
};

const scoreQuestion: DecisionQuestion = {
  type: "score",
  name: "urgency",
  instructions: "Rate urgency.",
  levels: [
    { label: "low", description: "Can wait" },
    { label: "high", description: "Needs attention" },
  ],
};

function parse(question: DecisionQuestion, answer: Record<string, unknown>) {
  return parseDecisionAnswers("openai", [question], {
    answers: [{ name: question.name, ...answer }],
  });
}

describe("parseDecisionAnswers", () => {
  it("rejects duplicate choice probability values", () => {
    expect(() =>
      parse(choiceQuestion, {
        type: "choice",
        choice: "billing",
        probabilities: [
          { value: "billing", probability: 0.6 },
          { value: "billing", probability: 0.4 },
        ],
      }),
    ).toThrow(DecisionResponseError);
  });

  it("rejects duplicate score probability values", () => {
    expect(() =>
      parse(scoreQuestion, {
        type: "score",
        score: 1,
        probabilities: [
          { value: 1, probability: 0.6 },
          { value: 1, probability: 0.4 },
        ],
      }),
    ).toThrow(DecisionResponseError);
  });

  it("rejects present invalid confidence values", () => {
    for (const questionAnswer of [
      {
        question: choiceQuestion,
        answer: { type: "choice", choice: "billing" },
      },
      { question: scoreQuestion, answer: { type: "score", score: 1 } },
    ]) {
      for (const confidence of [Number.NaN, undefined]) {
        expect(() =>
          parse(questionAnswer.question, {
            ...questionAnswer.answer,
            confidence,
          }),
        ).toThrow(DecisionResponseError);
      }
    }
  });

  it("accepts omitted confidence", () => {
    expect(
      parse(choiceQuestion, { type: "choice", choice: "billing" }).answers
        .route,
    ).toEqual({ type: "choice", name: "route", choice: "billing" });
  });

  it("preserves answers with prototype-like question names", () => {
    const question: DecisionQuestion = {
      type: "predicate",
      name: "__proto__",
      instructions: "Does this request qualify?",
    };
    const result = parseDecisionAnswers("openai", [question], {
      answers: [{ name: "__proto__", type: "predicate", probability: 0.8 }],
    });

    expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
    expect(result.answers["__proto__"]).toEqual({
      type: "predicate",
      name: "__proto__",
      probability: 0.8,
    });
    expect(Object.getPrototypeOf(result.answers)).toBe(Object.prototype);
  });
});
