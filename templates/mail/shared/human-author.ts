export const HUMAN_AUTHOR_CLAUSE =
  "Only match conversations whose latest message was written by a person. Never match mail from noreply, notifications, or bot senders, or automated mail such as newsletters, receipts, alerts, and mailing lists.";

export function withHumanAuthorClause(condition: string): string {
  const trimmed = condition.trim();
  if (trimmed.includes(HUMAN_AUTHOR_CLAUSE)) return trimmed;
  return `${trimmed.replace(/[.\s]+$/, "")}. ${HUMAN_AUTHOR_CLAUSE}`;
}
