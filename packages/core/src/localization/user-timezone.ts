import { isValidTimezone, serverTimezone } from "../jobs/cron.js";
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
    // Deliberately unguarded. The resolved zone is persisted into the
    // schedule, so swallowing a read failure here would silently pin the job
    // to the host zone and fire it at the wrong wall-clock time for its whole
    // life. Failing the write is recoverable; a silently wrong schedule is not.
    const preference = normalizeLocalizationPreference(
      await getUserSetting(userEmail, LOCALIZATION_SETTING_KEY),
    );
    if (preference.timezone !== "system") return preference.timezone;
  }
  // Headers come from the client, so an unusable value must not reach
  // frontmatter, where cron evaluation would quietly swap in the host zone.
  const requested = getRequestTimezone();
  if (requested && isValidTimezone(requested)) return requested;
  return serverTimezone();
}
