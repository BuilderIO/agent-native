import { getSetting, putSetting } from "@agent-native/core/settings";

import type { NomadProfile } from "../../shared/types.js";
import { requireOwner } from "./owner.js";

export const DEFAULT_PROFILE: NomadProfile = {
  fiscalHomeCountry: null,
  citizenshipCountry: null,
  immigrationStatus: null,
  goals: [],
  trackedCountries: [],
  mailScanEnabled: false,
  scanFrequency: "weekly",
  lastScanAt: null,
  onboardingCompleted: false,
};

/**
 * Profile is per-user data (citizenship, visas context, travel goals) — the
 * settings key is scoped to the authenticated user, mirroring the
 * `u:<email>:...` convention core uses for credentials.
 */
function profileKey(): string {
  return `u:${requireOwner()}:nomad-profile`;
}

export async function getProfile(): Promise<NomadProfile> {
  const stored = (await getSetting(
    profileKey(),
  )) as Partial<NomadProfile> | null;
  return { ...DEFAULT_PROFILE, ...(stored ?? {}) };
}

export async function saveProfile(
  patch: Partial<NomadProfile>,
): Promise<NomadProfile> {
  const next = { ...(await getProfile()), ...patch };
  await putSetting(profileKey(), next);
  return next;
}
