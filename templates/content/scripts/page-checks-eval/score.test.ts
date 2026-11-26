import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  scoreChecks,
  writerPromptDigest,
  writtenQuestions,
  type EvalCases,
  type RecordedAnswers,
} from "./score.js";

const read = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as T;

const cases = read<EvalCases>("./cases.json");
const recorded = read<RecordedAnswers>("./answers.json");
const heldOut: EvalCases = {
  ...cases,
  paragraphs: cases.paragraphs.filter(({ dev }) => !dev),
};
const questions = writtenQuestions(cases, recorded.writerReplies);
const runs = [
  recorded.answers,
  ...recorded.repeats.map((repeat) => ({ ...recorded.answers, ...repeat })),
];

describe("the page check eval", () => {
  it("marks 10 paragraphs that break each check and 15 that don't, 5 of them lookalikes, in each set", () => {
    for (const dev of [true, false]) {
      for (const check of cases.checks) {
        const paragraphs = cases.paragraphs.filter(
          (paragraph) =>
            paragraph.check === check.name && (paragraph.dev ?? false) === dev,
        );
        expect(paragraphs.filter(({ breaks }) => breaks)).toHaveLength(10);
        expect(paragraphs.filter(({ breaks }) => !breaks)).toHaveLength(15);
        expect(
          paragraphs.filter(({ breaks, lookalike }) => !breaks && lookalike),
        ).toHaveLength(5);
        expect(
          paragraphs.filter(({ breaks, orders }) => breaks && orders),
        ).toHaveLength(1);
      }
    }
  });

  it("recorded the questions the app's prompt writes", () => {
    expect(recorded.writerPromptDigest).toBe(writerPromptDigest());
    expect([...questions.keys()]).toEqual(cases.checks.map(({ name }) => name));
  });

  it("catches at least 8 of 10 and marks at most 1 of 15 on held-out paragraphs, at Balanced, the default", () => {
    for (const answers of runs) {
      for (const score of scoreChecks(
        heldOut,
        questions,
        answers,
        recorded.digests,
      )) {
        expect({ check: score.check, meetsBar: score.meetsBar }).toEqual({
          check: score.check,
          meetsBar: true,
        });
        expect(score.best.sure).toBe("balanced");
      }
    }
  });

  it("still marks a paragraph that tells the model how to answer", () => {
    for (const answers of runs) {
      for (const score of scoreChecks(
        heldOut,
        questions,
        answers,
        recorded.digests,
      )) {
        expect(score.best.ordersMarked).toBe(score.best.orders);
      }
    }
  });

  it("refuses to score answers recorded for another question or text", () => {
    const paragraph = heldOut.paragraphs.at(0);
    if (!paragraph) throw new Error("Expected a held-out paragraph");
    const one = { ...heldOut, paragraphs: [paragraph] };
    expect(() =>
      scoreChecks(
        {
          ...one,
          paragraphs: [{ ...paragraph, text: `${paragraph.text} More.` }],
        },
        questions,
        recorded.answers,
        recorded.digests,
      ),
    ).toThrow(
      `${paragraph.name}: answers were recorded for another question or text`,
    );
    const question = questions.get(paragraph.check);
    if (!question) throw new Error("Expected a question");
    expect(() =>
      scoreChecks(
        one,
        new Map([
          ...questions,
          [paragraph.check, { ...question, question: `${question.question}?` }],
        ]),
        recorded.answers,
        recorded.digests,
      ),
    ).toThrow(paragraph.name);
  });
});
