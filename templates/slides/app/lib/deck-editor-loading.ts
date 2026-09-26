export function deckAccessCheckKey(
  deckId: string | undefined,
  orgId: string | null | undefined,
): string | null {
  return deckId ? JSON.stringify([deckId, orgId ?? null]) : null;
}

export async function retryMissingDeck({
  refetchOrg,
  reloadDecks,
  refetchAccessStatus,
}: {
  refetchOrg: () => Promise<unknown>;
  reloadDecks: () => Promise<unknown>;
  refetchAccessStatus: () => Promise<unknown>;
}): Promise<void> {
  await refetchOrg();
  await reloadDecks();
  await refetchAccessStatus();
}

/**
 * What the metadata-only access probe says about a deck the editor could not
 * load. Only `allowed` needs the protected deck list to settle; every other
 * outcome already decides what the viewer sees.
 */
type DeckAccessCheck = "loading" | "allowed" | "denied" | "missing" | "failed";

export function deckAccessCheckFor(query: {
  data?: { exists: boolean; hasAccess: boolean } | null;
  isError: boolean;
  isLoading: boolean;
}): DeckAccessCheck {
  if (query.isError) return "failed";
  if (!query.data) return query.isLoading ? "loading" : "failed";
  if (!query.data.exists) return "missing";
  return query.data.hasAccess ? "allowed" : "denied";
}

export function shouldShowDeckEditorSkeleton({
  deckFound,
  decksLoading,
  orgLoading,
  accessCheckKey,
  checkedAccessKey,
  retrying,
  accessCheck,
}: {
  deckFound: boolean;
  decksLoading: boolean;
  orgLoading: boolean;
  accessCheckKey: string | null;
  checkedAccessKey: string | null;
  retrying: boolean;
  accessCheck: DeckAccessCheck;
}): boolean {
  if (deckFound) return false;
  if (retrying) return true;
  // The access probe is authoritative even when loading the protected deck
  // list fails or stays pending, so a denied, missing, or unreadable deck
  // never waits on the list.
  if (accessCheck !== "allowed") return accessCheck === "loading";
  if (decksLoading) return true;
  if (!accessCheckKey) return false;
  return orgLoading || checkedAccessKey !== accessCheckKey;
}

export type DeckAccessRequestState =
  | { status: "idle" | "pending" | "failed" }
  | { status: "sent"; ownerNotified: boolean };

/**
 * The viewer's access request as the access denied page shows it: a request
 * sent from this page, else one already on record from an earlier visit.
 */
export function deckAccessRequestStateFor(
  mutation: {
    isPending: boolean;
    isError: boolean;
    data?: { notifiedOwner: boolean };
  },
  recordedRequest: { notifiedOwner: boolean } | null | undefined,
): DeckAccessRequestState {
  const sent = mutation.data ?? recordedRequest;
  if (sent) return { status: "sent", ownerNotified: sent.notifiedOwner };
  if (mutation.isPending) return { status: "pending" };
  if (mutation.isError) return { status: "failed" };
  return { status: "idle" };
}
