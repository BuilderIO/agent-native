import { getLabDefinition } from "../labs/registry.js";
import { getUserLabs, normalizeLabValues, setUserLab } from "../labs/store.js";

/** @deprecated Import the Labs store instead. */
export const EXPERIMENTS_SETTING_KEY = "experiments";
export const normalizeExperimentValues = normalizeLabValues;
export const getUserExperiments = getUserLabs;

/** @deprecated Use setUserLab instead. */
export async function setUserExperiment(
  email: string,
  key: string,
  enabled: boolean,
): Promise<Record<string, boolean>> {
  if (!getLabDefinition(key)) {
    throw new Error(`Unknown experiment: ${key}`);
  }
  return setUserLab(email, key, enabled);
}
