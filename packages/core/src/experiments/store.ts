import { getLabDefinition } from "../labs/registry.js";
import {
  getUserLabs,
  normalizeLabValues,
  setUserLabStates,
} from "../labs/store.js";

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
  const states = await setUserLabStates(email, key, enabled);
  const target = states[key];
  if (!target) throw new Error(`Unknown lab: ${key}`);
  if ("error" in target) {
    throw new Error(
      target.error === "invalid-choice"
        ? `Invalid saved lab choice: ${key}`
        : `Could not resolve saved lab state: ${key}`,
    );
  }
  return Object.fromEntries(
    Object.entries(states).flatMap(([labKey, state]) =>
      "error" in state ? [] : [[labKey, state.enabled]],
    ),
  );
}
