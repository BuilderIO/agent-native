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

const jevScoreQuestion: DecisionQuestion = {
  type: "score",
  name: "urgency",
  instructions: "How soon does this need attention?",
  levels: [
    { label: "none", description: "No action is needed." },
    { label: "this_week", description: "It can wait a few days." },
    { label: "today", description: "It needs attention today." },
  ],
};

// Schema-derived from the Builder proxy's SystemOneResponseSchema. No Jev
// credential was available, so this fixture is not an observed live response.
const schemaDerivedJevScoreResponseFixture = {
  model: "jev-latest",
  answers: {
    urgency: {
      type: "score",
      score: 2,
      legend: {
        "answer-a": "none: No action is needed.",
        "answer-b": "this_week: It can wait a few days.",
        "answer-c": "today: It needs attention today.",
      },
      probabilities: { "answer-a": 0.2, "answer-b": 0.5, "answer-c": 0.3 },
      confidence: 0.82,
    },
  },
  usage: { input_tokens: 42, output_tokens: 8 },
};

function parse(question: DecisionQuestion, answer: Record<string, unknown>) {
  return parseDecisionAnswers("openai", [question], {
    answers: [{ name: question.name, ...answer }],
  });
}

describe("parseDecisionAnswers", () => {
  it("uses the probability-weighted expected index instead of Jev's raw score, with opaque record keys", () => {
    const result = parseDecisionAnswers(
      "jev",
      [jevScoreQuestion],
      schemaDerivedJevScoreResponseFixture,
    );

    expect(result).toEqual({
      answers: {
        urgency: {
          type: "score",
          name: "urgency",
          score: 1.1,
          levels: [
            { value: 0, label: "none", description: "No action is needed." },
            {
              value: 1,
              label: "this_week",
              description: "It can wait a few days.",
            },
            {
              value: 2,
              label: "today",
              description: "It needs attention today.",
            },
          ],
          probabilities: [
            { value: 0, probability: 0.2 },
            { value: 1, probability: 0.5 },
            { value: 2, probability: 0.3 },
          ],
          confidence: 0.82,
        },
      },
      usage: { inputTokens: 42, outputTokens: 8 },
    });
  });

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
