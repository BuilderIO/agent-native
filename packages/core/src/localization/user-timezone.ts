import { serverTimezone } from "../jobs/cron.js";
import { getRequestTimezone } from "../server/request-context.js";
import { getUserSetting } from "../settings/user-settings.js";
import {
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
} from "./shared.js";

/**
 * Resolve the IANA zone a user's scheduled work should be interpreted in.
 *
 * Order matters. A zone the user pinned in settings wins over the requesting
 * browser: someone who set America/New_York expects an 8am job to stay 8am
 * Eastern while they are travelling. The request header is only a fallback for
 * users who never pinned one, and it is absent entirely for headless callers
 * (cron, chat integrations, A2A) — which is why the stored preference exists.
 */
export async function resolveUserSchedulingTimezone(
  userEmail?: string | null,
): Promise<string> {
  if (userEmail) {
    try {
      const preference = normalizeLocalizationPreference(
        await getUserSetting(userEmail, LOCALIZATION_SETTING_KEY),
      );
      if (preference.timezone !== "system") return preference.timezone;
    } catch {
      // A settings read failure must not block creating a schedule; fall
      // through to the request/host zone, which the caller then persists
      // explicitly so the resulting schedule is still unambiguous.
    }
  }
  return getRequestTimezone() || serverTimezone();
}
