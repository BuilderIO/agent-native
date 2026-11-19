import { getUserSetting } from "../settings/user-settings.js";

export const NO_APPROVALS_SETTING_KEY = "no-approvals";

function defaultOnEmails(): ReadonlySet<string> {
  const raw = process.env.AGENT_NATIVE_NO_APPROVALS_EMAILS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

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
    return defaultOnEmails().has(email.trim().toLowerCase());
  } catch {
    // coercion-ok: an unreadable setting leaves the approval gate in place.
    return false;
  }
}
