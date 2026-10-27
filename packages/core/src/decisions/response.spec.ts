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
  it("marks malformed choice probability values as a per-question failure", () => {
    expect(
      parse(choiceQuestion, {
        type: "choice",
        choice: "billing",
        probabilities: [
          { value: "billing", probability: 0.6 },
          { value: "billing", probability: 0.4 },
        ],
      }),
    ).toMatchObject({ questionFailures: { route: "invalid_response" } });
  });

  it("marks malformed score probability values as a per-question failure", () => {
    expect(
      parse(scoreQuestion, {
        type: "score",
        score: 1,
        probabilities: [
          { value: 1, probability: 0.6 },
          { value: 1, probability: 0.4 },
        ],
      }),
    ).toMatchObject({ questionFailures: { urgency: "invalid_response" } });
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
        expect(
          parse(questionAnswer.question, {
            ...questionAnswer.answer,
            confidence,
          }),
        ).toMatchObject({
          questionFailures: {
            [questionAnswer.question.name]: "invalid_response",
          },
        });
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

  it("keeps successful siblings when one answer is refused or omitted", () => {
    const predicateQuestions: DecisionQuestion[] = [
      { type: "predicate", name: "first", instructions: "First?" },
      { type: "predicate", name: "second", instructions: "Second?" },
      { type: "predicate", name: "third", instructions: "Third?" },
    ];
    const result = parseDecisionAnswers("openai", predicateQuestions, {
      answers: [
        { name: "first", type: "predicate", probability: 0.8 },
        { name: "second", type: "refusal" },
      ],
    });

    expect(result).toEqual({
      answers: {
        first: { type: "predicate", name: "first", probability: 0.8 },
        second: { type: "refusal", name: "second" },
      },
      questionFailures: { third: "invalid_response" },
    });
  });

  it("rejects answers for unknown questions", () => {
    expect(() =>
      parseDecisionAnswers("openai", [choiceQuestion], {
        answers: [
          { name: "route", type: "choice", choice: "billing" },
          { name: "unexpected", type: "choice", choice: "billing" },
        ],
      }),
    ).toThrow(DecisionResponseError);
  });
});
