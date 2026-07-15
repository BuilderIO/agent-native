export type RecordingPageAccessRole = "owner" | "admin" | "editor" | "viewer";

/**
 * Decide whether an authenticated request may use the editor/player route.
 * Public visibility is intentionally a share-link concern; a direct `/r/*`
 * request must either be the owner or have an explicit share grant.
 * Password-protected recordings stay on the password-aware share flow for
 * every non-owner so the authenticated action cannot mint a bypass token.
 */
export function canOpenDirectRecordingPage(input: {
  role: RecordingPageAccessRole;
  visibility: "private" | "org" | "public";
  hasPassword: boolean;
  hasExplicitShare: boolean;
}): boolean {
  if (input.role === "owner") return true;
  if (input.hasPassword) return false;
  if (input.visibility === "public") return input.hasExplicitShare;
  return true;
}
