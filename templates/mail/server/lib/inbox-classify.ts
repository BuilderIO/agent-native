const AUTOMATED_CATEGORY_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

const AUTOMATED_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer(-daemon)?|bounces?|postmaster|newsletter|digest|reminders?|calendar-notification|drive-shares-noreply)(?:[+.\-_]|$)/i;

const BOT_ADDRESS = /(^|[+.\-_])bots?($|[+.\-_])|\[bot\]/i;

export type AutomationClassification =
  | "automated"
  | "personal"
  | "unclassified";

export function automationFlag(
  classification: AutomationClassification,
): boolean | null {
  return classification === "unclassified"
    ? null
    : classification === "automated";
}

export function classifyAutomated(input: {
  headers: Array<{ name?: string | null; value?: string | null }>;
  labelIds: string[];
  fromEmail: string;
  selfAddressed?: boolean;
}): AutomationClassification {
  const header = (name: string): string =>
    input.headers
      .find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value?.trim() ?? "";

  if (header("List-Unsubscribe") || header("List-Id")) return "automated";
  if (/\b(bulk|list|junk)\b/i.test(header("Precedence"))) return "automated";
  const autoSubmitted = header("Auto-Submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "automated";
  if (header("X-Auto-Response-Suppress")) return "automated";
  if (header("Feedback-ID")) return "automated";

  if (input.labelIds.some((l) => AUTOMATED_CATEGORY_LABELS.has(l))) {
    return "automated";
  }

  const localPart = input.fromEmail.split("@")[0] || "";
  if (AUTOMATED_LOCAL_PART.test(localPart) || BOT_ADDRESS.test(localPart))
    return "automated";
  if (input.labelIds.includes("CATEGORY_PERSONAL") || input.selfAddressed)
    return "personal";
  return "unclassified";
}
