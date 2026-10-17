import { isValidTimezone, serverTimezone } from "../jobs/cron.js";
import { getRequestTimezone } from "../server/request-context.js";
import { getUserSetting } from "../settings/user-settings.js";
import {
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
} from "./shared.js";

export async function resolveUserSchedulingTimezone(
  userEmail?: string | null,
): Promise<string> {
  if (userEmail) {
    const preference = normalizeLocalizationPreference(
      await getUserSetting(userEmail, LOCALIZATION_SETTING_KEY),
    );
    if (preference.timezone !== "system") return preference.timezone;
  }
  const requested = getRequestTimezone();
  if (requested && isValidTimezone(requested)) return requested;
  return serverTimezone();
}
