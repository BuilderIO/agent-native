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
}: {
  deckFound: boolean;
  decksLoading: boolean;
  orgLoading: boolean;
  accessCheckKey: string | null;
  checkedAccessKey: string | null;
  retrying: boolean;
}): boolean {
  if (decksLoading) return true;
  if (deckFound || !accessCheckKey) return false;
  return orgLoading || checkedAccessKey !== accessCheckKey || retrying;
}
