import { readFileSync } from "node:fs";

import {
  CAUGHT_AT_LEAST,
  MARKED_AT_MOST,
  paragraphRequest,
  requestDigest,
  scoreChecks,
  writerPromptDigest,
  writerRequest,
  writtenQuestions,
  type EvalCases,
  type RecordedAnswers,
} from "./score.js";

const here = new URL(".", import.meta.url);
const read = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(file, here), "utf8")) as T;
const cases = read<EvalCases>("cases.json");
const [command] = process.argv.slice(2);

if (command === "writer") {
  console.log(
    JSON.stringify({
      promptDigest: writerPromptDigest(),
      requests: cases.checks.map((check) => ({
        check: check.name,
        ...writerRequest(check),
      })),
    }),
  );
} else if (command === "requests") {
  const recorded = read<RecordedAnswers>("answers.json");
  const questions = writtenQuestions(cases, recorded.writerReplies);
  console.log(
    JSON.stringify(
      cases.paragraphs.map((paragraph) => {
        const question = questions.get(paragraph.check);
        if (!question) throw new Error(`${paragraph.name}: no question`);
        const request = paragraphRequest(question, paragraph.text);
        return {
          name: paragraph.name,
          digest: requestDigest(request),
          ...request,
        };
      }),
    ),
  );
} else if (command === "score") {
  const recorded = read<RecordedAnswers>("answers.json");
  const questions = writtenQuestions(cases, recorded.writerReplies);
  const runs = [
    recorded.answers,
    ...recorded.repeats.map((repeat) => ({ ...recorded.answers, ...repeat })),
  ];
  console.log(
    `${recorded.writer} wrote the questions; ${recorded.decider} answered them on ${recorded.recordedOn}.`,
  );
  console.log(
    `The bar: at its best setting, a check catches at least ${CAUGHT_AT_LEAST} of 10 and marks at most ${MARKED_AT_MOST} of 15.`,
  );
  const sets = [
    {
      label: "held-out",
      paragraphs: cases.paragraphs.filter(({ dev }) => !dev),
    },
    { label: "dev", paragraphs: cases.paragraphs.filter(({ dev }) => dev) },
  ];
  for (const [run, answers] of runs.entries()) {
    for (const { label, paragraphs } of sets) {
      console.log(
        `\n${run === 0 ? "Recorded run" : `Repeat ${run}`}, ${label} paragraphs`,
      );
      printScores(
        scoreChecks(
          { ...cases, paragraphs },
          questions,
          answers,
          recorded.digests,
        ),
      );
    }
  }
} else {
  throw new Error("Use: run.ts writer|requests|score");
}

function printScores(scores: ReturnType<typeof scoreChecks>) {
  for (const score of scores) {
    console.log(
      `${score.check}: ${score.meetsBar ? "meets the bar" : "misses the bar"} at ${score.best.sure}. Asks "${score.question.question}", passing on ${score.question.passes}.`,
    );
    for (const setting of score.settings) {
      console.log(
        `  ${setting.sure.padEnd(8)} caught ${setting.caught}/${setting.breaks}, marked ${setting.marked}/${setting.passes} (lookalikes ${setting.lookalikesMarked}/${setting.lookalikes}), orders marked ${setting.ordersMarked}/${setting.orders}  wrong: ${setting.missed.join(" ") || "none"}`,
      );
    }
  }
}
