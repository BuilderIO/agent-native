export function deckAccessCheckKey(
  deckId: string | undefined,
  orgId: string | null | undefined,
): string | null {
  return deckId ? JSON.stringify([deckId, orgId ?? null]) : null;
}

export function shouldShowDeckEditorSkeleton({
  deckFound,
  decksLoading,
  orgLoading,
  accessCheckKey,
  checkedAccessKey,
  retrying,
  privateDeckAccessConfirmed,
}: {
  deckFound: boolean;
  decksLoading: boolean;
  orgLoading: boolean;
  accessCheckKey: string | null;
  checkedAccessKey: string | null;
  retrying: boolean;
  privateDeckAccessConfirmed: boolean;
}): boolean {
  // A private deck intentionally returns 404 from the content action. The
  // metadata-only access check is the source of truth for this state, so do
  // not leave the user on the editor skeleton while that protected fetch
  // settles.
  if (privateDeckAccessConfirmed) return false;
  if (decksLoading) return true;
  if (deckFound || !accessCheckKey) return false;
  return orgLoading || checkedAccessKey !== accessCheckKey || retrying;
}
