
const AUTOMATED_CATEGORY_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

const AUTOMATED_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer(-daemon)?|bounces?|postmaster|newsletter|digest|reminders?|calendar-notification|drive-shares-noreply)(?:[+.\-_]|$)/i;

export function classifyAutomated(input: {
  headers: Array<{ name?: string | null; value?: string | null }>;
  labelIds: string[];
  fromEmail: string;
}): boolean {
  const header = (name: string): string =>
    input.headers
      .find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value?.trim() ?? "";

  if (header("List-Unsubscribe") || header("List-Id")) return true;
  if (/\b(bulk|list|junk)\b/i.test(header("Precedence"))) return true;
  const autoSubmitted = header("Auto-Submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (header("X-Auto-Response-Suppress")) return true;
  if (header("Feedback-ID")) return true;

  if (input.labelIds.some((l) => AUTOMATED_CATEGORY_LABELS.has(l))) {
    return true;
  }

  const localPart = input.fromEmail.split("@")[0] || "";
  return AUTOMATED_LOCAL_PART.test(localPart);
}
