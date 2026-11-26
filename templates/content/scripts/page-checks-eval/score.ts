import { createHash } from "node:crypto";

import {
  PAGE_CHECK_WRITER_PROMPT,
  pageCheckWriterInput,
  readWrittenPageCheckQuestions,
} from "../../shared/page-check-questions.js";
import {
  PAGE_CHECK_SURE_SETTINGS,
  pageCheckDecisionRequest,
  pageCheckPartFinding,
  pageCheckPassing,
  readPageCheckSentence,
  type PageCheckSure,
} from "../../shared/page-checks.js";

export type EvalCheck = { name: string; sentence: string };

export type EvalParagraph = {
  name: string;
  check: string;
  dev?: boolean;
  text: string;
  breaks: boolean;
  lookalike?: boolean;
  orders?: boolean;
};

export type EvalCases = { checks: EvalCheck[]; paragraphs: EvalParagraph[] };

export type WrittenQuestion = { question: string; passes: "yes" | "no" };

export type RecordedAnswers = {
  writer: string;
  decider: string;
  recordedOn: string;
  writerPromptDigest: string;
  writerReplies: Record<string, string>;
  answers: Record<string, number>;
  repeats: Record<string, number>[];
  digests: Record<string, string>;
};

export const CAUGHT_AT_LEAST = 8;
export const MARKED_AT_MOST = 1;

const partsOf = (check: EvalCheck) =>
  readPageCheckSentence(check.sentence).parts.map((part) => part.text);

const digestOf = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export const writerPromptDigest = () => digestOf(PAGE_CHECK_WRITER_PROMPT);

export const writerRequest = (check: EvalCheck) => ({
  systemPrompt: PAGE_CHECK_WRITER_PROMPT,
  input: pageCheckWriterInput(partsOf(check)),
});

export function writtenQuestions(
  cases: EvalCases,
  replies: Readonly<Partial<Record<string, string>>>,
): Map<string, WrittenQuestion> {
  return new Map(
    cases.checks.map((check) => {
      const reply = replies[check.name];
      if (reply === undefined) throw new Error(`${check.name}: no reply`);
      const written = readWrittenPageCheckQuestions(partsOf(check), reply);
      if (written.status !== "ok") {
        throw new Error(`${check.name}: the reply was ${written.status}`);
      }
      const only = written.questions.at(0);
      if (!only || written.questions.length > 1) {
        throw new Error(`${check.name}: expected one yes/no part`);
      }
      return [check.name, { question: only.question, passes: only.passes }];
    }),
  );
}

export const paragraphRequest = (question: WrittenQuestion, text: string) =>
  pageCheckDecisionRequest([{ index: 0, part: question }], { markdown: text });

export const requestDigest = (request: ReturnType<typeof paragraphRequest>) =>
  digestOf(request);

export type SettingScore = {
  sure: PageCheckSure;
  caught: number;
  breaks: number;
  marked: number;
  passes: number;
  lookalikesMarked: number;
  lookalikes: number;
  ordersMarked: number;
  orders: number;
  missed: string[];
};

export type CheckScore = {
  check: string;
  question: WrittenQuestion;
  settings: SettingScore[];
  best: SettingScore;
  meetsBar: boolean;
};

function bestSetting(settings: readonly SettingScore[]): SettingScore {
  const best = [...settings]
    .sort(
      (left, right) =>
        left.missed.length - right.missed.length ||
        left.marked - right.marked ||
        Number(right.sure === "balanced") - Number(left.sure === "balanced"),
    )
    .at(0);
  if (!best) throw new Error("No settings to choose from");
  return best;
}

export function scoreChecks(
  cases: EvalCases,
  questions: ReadonlyMap<string, WrittenQuestion>,
  answers: Readonly<Partial<Record<string, number>>>,
  digests: Readonly<Record<string, string>>,
): CheckScore[] {
  return cases.checks.map((check) => {
    const question = questions.get(check.name);
    if (!question) throw new Error(`${check.name}: no written question`);
    const paragraphs = cases.paragraphs
      .filter((paragraph) => paragraph.check === check.name)
      .map((paragraph) => {
        const digest = requestDigest(
          paragraphRequest(question, paragraph.text),
        );
        if (digest !== digests[paragraph.name]) {
          throw new Error(
            `${paragraph.name}: answers were recorded for another question or text`,
          );
        }
        const yes = answers[paragraph.name];
        if (yes === undefined) throw new Error(`${paragraph.name}: no answer`);
        return { paragraph, passing: pageCheckPassing(question, yes) };
      });
    const settings = PAGE_CHECK_SURE_SETTINGS.map((sure): SettingScore => {
      const score: SettingScore = {
        sure,
        caught: 0,
        breaks: 0,
        marked: 0,
        passes: 0,
        lookalikesMarked: 0,
        lookalikes: 0,
        ordersMarked: 0,
        orders: 0,
        missed: [],
      };
      for (const { paragraph, passing } of paragraphs) {
        const marks =
          pageCheckPartFinding({ finding: "fine", passing }, sure) ===
          "not_fine";
        if (marks !== paragraph.breaks) score.missed.push(paragraph.name);
        if (paragraph.breaks) {
          score.breaks += 1;
          if (marks) score.caught += 1;
          if (paragraph.orders) {
            score.orders += 1;
            if (marks) score.ordersMarked += 1;
          }
        } else {
          score.passes += 1;
          if (marks) score.marked += 1;
          if (paragraph.lookalike) {
            score.lookalikes += 1;
            if (marks) score.lookalikesMarked += 1;
          }
        }
      }
      return score;
    });
    const best = bestSetting(settings);
    return {
      check: check.name,
      question,
      settings,
      best,
      meetsBar: best.caught >= CAUGHT_AT_LEAST && best.marked <= MARKED_AT_MOST,
    };
  });
}
