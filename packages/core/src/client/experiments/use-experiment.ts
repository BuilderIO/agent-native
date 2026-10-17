/** @deprecated Use the Labs hooks instead. */
import {
  useLab,
  useLabState,
  useLabs,
  type LabValues,
} from "../labs/use-lab.js";

export type ExperimentValues = LabValues;
export const useExperimentState = useLabState;
export const useExperiment = useLab;
export const useExperiments = useLabs;
