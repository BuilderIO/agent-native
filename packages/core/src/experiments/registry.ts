/** @deprecated Import the Labs registry instead. */
export type { LabDefinition as ExperimentDefinition } from "../labs/registry.js";
export {
  _resetLabRegistryForTests as _resetExperimentRegistryForTests,
  defineLab as defineExperiment,
  defineLabs as defineExperiments,
  getLabDefinition as getExperimentDefinition,
  listLabs as listExperiments,
  registerLabs as registerExperiments,
} from "../labs/registry.js";
