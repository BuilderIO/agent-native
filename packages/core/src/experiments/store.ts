import {
  getUserSetting,
  mutateUserSetting,
} from "../settings/user-settings.js";
import { getExperimentDefinition, listExperiments } from "./registry.js";

export const EXPERIMENTS_SETTING_KEY = "experiments";

export function normalizeExperimentValues(
  stored: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    listExperiments().map(({ key }) => [key, stored?.[key] === true]),
  );
}

export async function getUserExperiments(
  email: string,
): Promise<Record<string, boolean>> {
  return normalizeExperimentValues(
    await getUserSetting(email, EXPERIMENTS_SETTING_KEY),
  );
}

export async function setUserExperiment(
  email: string,
  key: string,
  enabled: boolean,
): Promise<Record<string, boolean>> {
  if (!getExperimentDefinition(key)) {
    throw new Error(`Unknown experiment: ${key}`);
  }
  const stored = await mutateUserSetting(
    email,
    EXPERIMENTS_SETTING_KEY,
    (current) => ({ ...(current ?? {}), [key]: enabled }),
  );
  return normalizeExperimentValues(stored);
}
