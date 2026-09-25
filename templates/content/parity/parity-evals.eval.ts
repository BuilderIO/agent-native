import { parityEvalScenarios } from "./eval-scenarios.ts";
import { scenarioToEval } from "./scenario-to-eval.ts";

export default parityEvalScenarios.map((scenario) => scenarioToEval(scenario));
