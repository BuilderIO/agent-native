import {
  getUserSetting,
  mutateUserSetting,
} from "../settings/user-settings.js";
import { getLabDefinition, listLabs } from "./registry.js";

export const LABS_SETTING_KEY = "labs";
const LEGACY_LABS_SETTING_KEY = "experiments";

async function getStoredLabs(
  email: string,
): Promise<Record<string, unknown> | null> {
  const [labs, legacy] = await Promise.all([
    getUserSetting(email, LABS_SETTING_KEY),
    getUserSetting(email, LEGACY_LABS_SETTING_KEY),
  ]);
  return labs || legacy ? { ...(legacy ?? {}), ...(labs ?? {}) } : null;
}

export function normalizeLabValues(
  stored: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    listLabs().map(({ key }) => [key, stored?.[key] === true]),
  );
}

export async function getUserLabs(
  email: string,
): Promise<Record<string, boolean>> {
  return normalizeLabValues(await getStoredLabs(email));
}

export async function setUserLab(
  email: string,
  key: string,
  enabled: boolean,
): Promise<Record<string, boolean>> {
  if (!getLabDefinition(key)) {
    throw new Error(`Unknown lab: ${key}`);
  }
  const stored = await mutateUserSetting(
    email,
    LABS_SETTING_KEY,
    async (current) => {
      const legacy =
        current === null
          ? await getUserSetting(email, LEGACY_LABS_SETTING_KEY)
          : null;
      return { ...(legacy ?? {}), ...(current ?? {}), [key]: enabled };
    },
  );
  return normalizeLabValues(stored);
}
