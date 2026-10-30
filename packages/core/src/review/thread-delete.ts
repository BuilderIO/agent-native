function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

/**
 * Deleting a thread's first comment deletes its replies too, so it needs the
 * right to delete every one of them: an editor has it, and a commenter has it
 * over a thread that holds nothing but their own words.
 */
export function canDeleteReviewThread(input: {
  isEditor: boolean;
  actorEmail: string | null | undefined;
  rootAuthorEmail: string | null | undefined;
  replyAuthorEmails: ReadonlyArray<string | null | undefined>;
}): boolean {
  if (input.isEditor) return true;
  const actor = normalizeEmail(input.actorEmail);
  if (!actor || normalizeEmail(input.rootAuthorEmail) !== actor) return false;
  return input.replyAuthorEmails.every(
    (email) => normalizeEmail(email) === actor,
  );
}
