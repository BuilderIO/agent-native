/**
 * The review-unit eval's two steps, since only a signed-in app can reach a
 * decision model:
 *
 *   npx tsx scripts/review-units-eval/run.ts requests [dev]
 *     Prints each edit's model request. Post each as `decide` from an account
 *     with a decision model, and save the probabilities in answers.json.
 *   npx tsx scripts/review-units-eval/run.ts score [dev|held-out]
 *     Scores sentence units and the saved answers against the hand-marked units.
 *     A model's answers vary between calls, so it scores the repeated runs too,
 *     each laid over the recorded run. Those are for measuring that variation,
 *     not for choosing the question or its thresholds.
 */
import { readFileSync } from "node:fs";

import {
  unitGaps,
  unitPairRequest,
  unitPairs,
} from "../../shared/suggestion-units.js";
import { piecesOf, scoreEvalSet, type EvalCase } from "./score.js";

const here = new URL(".", import.meta.url);
const cases = JSON.parse(
  readFileSync(new URL("cases.json", here), "utf8"),
) as EvalCase[];
const [command, subset] = process.argv.slice(2);
const chosen = cases.filter(({ dev }) =>
  subset === "dev" ? dev : subset === "held-out" ? !dev : true,
);

if (command === "requests") {
  const requests = chosen.flatMap((item) => {
    const operations = piecesOf(item);
    const pairs = unitPairs(operations, unitGaps(operations));
    return pairs.length ? [{ name: item.name, ...unitPairRequest(pairs) }] : [];
  });
  console.log(JSON.stringify(requests));
} else if (command === "score") {
  const { answers, repeats } = JSON.parse(
    readFileSync(new URL("answers.json", here), "utf8"),
  ) as {
    answers: Record<string, number[]>;
    repeats: Record<string, number[]>[];
  };
  const { sentences, model, rows } = scoreEvalSet(chosen, answers);
  for (const { name, groups, baseline, units, probabilities } of rows) {
    console.log(
      `${name.padEnd(26)} marked ${JSON.stringify(groups).padEnd(24)} sentences ${baseline.join("")}  model ${units.join("")}  p ${probabilities.join(" ")}`,
    );
  }
  console.log({ edits: chosen.length, sentences, model });
  for (const repeat of repeats) {
    const again = scoreEvalSet(chosen, { ...answers, ...repeat }).model;
    console.log(
      `repeat of ${String(Object.keys(repeat).length).padEnd(2)} edits: ${again.brokenEdits.length} broken, ${again.fixesApart} apart, ${again.fixesJoined} joined  ${again.brokenEdits.join(" ")}`,
    );
  }
} else {
  throw new Error("Use: run.ts requests|score [dev|held-out]");
}
