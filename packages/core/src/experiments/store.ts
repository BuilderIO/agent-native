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
  const states = await setUserLab(email, key, enabled);
  return Object.fromEntries(
    Object.entries(states).map(([labKey, state]) => {
      if ("error" in state) {
        throw new Error(
          state.error === "invalid-choice"
            ? `Invalid saved lab choice: ${labKey}`
            : `Could not resolve saved lab state: ${labKey}`,
        );
      }
      return [labKey, state.enabled];
    }),
  );
}
