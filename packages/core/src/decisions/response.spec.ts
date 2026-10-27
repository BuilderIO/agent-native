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

const systemOneScoreQuestion: DecisionQuestion = {
  type: "score",
  name: "satisfaction",
  instructions: "Rate overall customer satisfaction from low to high.",
  levels: [
    { label: "low", description: "Lowest level." },
    { label: "medium", description: "Middle level." },
    { label: "high", description: "Highest level." },
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

// Numeric-key response shape and probabilities from the public System One
// score example at
// https://docs.digitalocean.com/products/inference/how-to/use-system-one-api/.
// Legend strings match this action's criteria; this is not a live response.
const publicSystemOneScoreResponseFixture = {
  model: "typesafe-jev-1.13.0",
  answers: {
    satisfaction: {
      type: "score",
      score: 1.32,
      legend: {
        "0": "low: Lowest level.",
        "1": "medium: Middle level.",
        "2": "high: Highest level.",
      },
      probabilities: { "0": 0, "1": 0.68, "2": 0.32 },
      confidence: 0.52,
    },
  },
  usage: { input_tokens: 307, output_tokens: 17 },
};

function parse(question: DecisionQuestion, answer: Record<string, unknown>) {
  return parseDecisionAnswers("openai", [question], {
    answers: [{ name: question.name, ...answer }],
  });
}

describe("parseDecisionAnswers", () => {
  it("uses documented System One index keys to normalize Jev scores", () => {
    const result = parseDecisionAnswers(
      "jev",
      [systemOneScoreQuestion],
      publicSystemOneScoreResponseFixture,
    );

    const answer = result.answers.satisfaction;
    expect(answer.type).toBe("score");
    if (answer.type !== "score") throw new Error("Expected a score answer");
    expect(answer.score).toBeCloseTo(1.32, 10);
    expect(answer.probabilities.map(({ probability }) => probability)).toEqual([
      0, 0.68, 0.32,
    ]);
    expect(answer.confidence).toBe(0.52);
  });

  it("uses index keys when Jev's echoed legend differs from the criteria", () => {
    const result = parseDecisionAnswers("jev", [systemOneScoreQuestion], {
      ...publicSystemOneScoreResponseFixture,
      answers: {
        satisfaction: {
          ...publicSystemOneScoreResponseFixture.answers.satisfaction,
          legend: { "0": "LOW", "1": "mid", "2": "HIGH" },
        },
      },
    });

    const answer = result.answers.satisfaction;
    expect(answer.type).toBe("score");
    if (answer.type !== "score") throw new Error("Expected a score answer");
    expect(answer.score).toBeCloseTo(1.32, 10);
  });

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

  it("normalizes Jev score probabilities when the total differs only by rounding noise", () => {
    const result = parseDecisionAnswers("jev", [jevScoreQuestion], {
      ...schemaDerivedJevScoreResponseFixture,
      answers: {
        urgency: {
          ...schemaDerivedJevScoreResponseFixture.answers.urgency,
          probabilities: {
            "answer-a": 0.2,
            "answer-b": 0.5,
            "answer-c": 0.3000001,
          },
        },
      },
    });

    const answer = result.answers.urgency;
    expect(answer.type).toBe("score");
    if (answer.type !== "score") throw new Error("Expected a score answer");
    expect(answer.score).toBeCloseTo(1.1, 6);
    expect(
      answer.probabilities.reduce(
        (total, { probability }) => total + probability,
        0,
      ),
    ).toBeCloseTo(1, 12);
  });

  it("marks Jev score probabilities whose total is not one as a per-question failure", () => {
    expect(
      parseDecisionAnswers("jev", [jevScoreQuestion], {
        ...schemaDerivedJevScoreResponseFixture,
        answers: {
          urgency: {
            ...schemaDerivedJevScoreResponseFixture.answers.urgency,
            probabilities: {
              "answer-a": 0.2,
              "answer-b": 0.5,
              "answer-c": 0.2,
            },
          },
        },
      }),
    ).toMatchObject({ questionFailures: { urgency: "invalid_response" } });
  });

  it("marks duplicate choice probability values as a per-question failure", () => {
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

  it("marks duplicate score probability values as a per-question failure", () => {
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
});
