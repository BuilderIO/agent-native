import { createAgentRunner, runEvals } from "@agent-native/core/eval";

import addDatabaseItem from "../actions/add-database-item.ts";
import { parityEvalScenarios } from "./eval-scenarios.ts";
import { scenarioToEval } from "./scenario-to-eval.ts";

const scenario = parityEvalScenarios.find(
  (candidate) => candidate.id === "database-create-property-preservation",
);
if (!scenario) {
  throw new Error("Missing database create property preservation scenario.");
}

const evalCase = scenarioToEval(scenario);
evalCase.scorers = evalCase.scorers.filter(
  (scorer) =>
    scorer.name === "expected_tools" ||
    scorer.name === "expected_property_values",
);

const runner = await createAgentRunner({
  actions: {
    "add-database-item": {
      ...addDatabaseItem,
      run: async (input) => ({ fixtureOnly: true, received: input }),
    },
  },
  systemPrompt:
    "You are Content's AI document assistant. Use the registered Content action and preserve exact user-supplied target constraints, property IDs, and property values. Never invent fields or claim an action succeeded when it failed.",
});

const report = await runEvals([evalCase], runner, { persist: false });
console.log(
  JSON.stringify(
    {
      engine: runner.engine.name,
      model: runner.model,
      report,
    },
    null,
    2,
  ),
);

process.exitCode = report.failed === 0 ? 0 : 1;
