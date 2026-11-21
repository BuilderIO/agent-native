import { getAppConfig } from "../app-config/index.js";
import { getUserSetting } from "../settings/user-settings.js";

export const NO_APPROVALS_SETTING_KEY = "no-approvals";

/**
 * Returns whether the user has opted into running approval-gated actions
 * without an approval prompt. Fails closed (`false`) if the setting cannot
 * be read.
 */
export async function isNoApprovalsMode(
  email: string | undefined,
): Promise<boolean> {
  if (!email) return false;
  try {
    const stored = await getUserSetting(email, NO_APPROVALS_SETTING_KEY);
    if (stored && typeof stored.enabled === "boolean") return stored.enabled;
    const normalized = email.trim().toLowerCase();
    return getAppConfig().agent.noApprovalsEmails.some(
      (candidate) => candidate.trim().toLowerCase() === normalized,
    );
  } catch {
    // coercion-ok: an unreadable setting leaves the approval gate in place.
    return false;
  }
}
