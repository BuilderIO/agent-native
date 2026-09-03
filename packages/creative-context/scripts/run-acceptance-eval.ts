import {
  assertContextAcceptanceGates,
  CREATIVE_CONTEXT_ACCEPTANCE_CASES,
  runContextAcceptanceEvaluation,
} from "../src/eval/index.js";

const report = runContextAcceptanceEvaluation({
  corpusId: "creative-context-realistic-v1",
  cases: CREATIVE_CONTEXT_ACCEPTANCE_CASES,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
assertContextAcceptanceGates(report);
