import { emailToName } from "@agent-native/core/client/collab";

/** Author-filter values that cannot collide with a real owner email. */
export const ALL_AUTHORS = "all";
export const MY_DESIGNS = "me";

export interface AuthoredDesign {
  ownerEmail?: string | null;
}

export function normalizeAuthorEmail(
  email: string | null | undefined,
): string | null {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/** Distinct owner emails across the whole library, ordered by display name. */
export function collectAuthorEmails(designs: AuthoredDesign[]): string[] {
  const byNormalized = new Map<string, string>();
  for (const design of designs) {
    const email = design.ownerEmail?.trim();
    if (!email) continue;
    const normalized = email.toLowerCase();
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, email);
  }
  return Array.from(byNormalized.values()).sort((a, b) =>
    emailToName(a).localeCompare(emailToName(b)),
  );
}

/**
 * Whether author bylines are worth showing on cards. A solo workspace would
 * only ever repeat the viewer's own name, so bylines stay hidden until a
 * second person is involved — either as an org member or as the owner of a
 * design the viewer can see.
 */
export function shouldShowAuthors(input: {
  orgMemberCount: number | undefined;
  authorEmails: string[];
}): boolean {
  return (input.orgMemberCount ?? 0) > 1 || input.authorEmails.length > 1;
}

export function filterDesignsByAuthor<T extends AuthoredDesign>(
  designs: T[],
  author: string,
  viewerEmail: string | null | undefined,
): T[] {
  if (author === ALL_AUTHORS) return designs;
  const normalizedViewer = normalizeAuthorEmail(viewerEmail);
  // An unknown viewer cannot own anything, so "mine" is empty rather than
  // silently falling back to every design.
  if (author === MY_DESIGNS) {
    if (!normalizedViewer) return [];
    return designs.filter(
      (design) => normalizeAuthorEmail(design.ownerEmail) === normalizedViewer,
    );
  }
  const normalizedAuthor = normalizeAuthorEmail(author);
  return designs.filter(
    (design) => normalizeAuthorEmail(design.ownerEmail) === normalizedAuthor,
  );
}
