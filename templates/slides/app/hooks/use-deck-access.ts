import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useSession } from "@agent-native/core/client/use-session";

export type DeckAccessStatusResponse = {
  exists: boolean;
  hasAccess: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  viewerName: string | null;
  role: "owner" | "viewer" | "commenter" | "editor" | "admin" | null;
  visibility: "private" | "org" | "public" | null;
  accessRequestToken?: string;
  pendingAccessRequest?: {
    note: string | null;
    notifiedOwner: boolean;
  };
};

export function useDeckAccessStatus(deckId?: string) {
  const { status } = useSession();
  return useActionQuery<DeckAccessStatusResponse>(
    "get-deck-access-status",
    { deckId: deckId ?? "" },
    {
      enabled:
        Boolean(deckId) &&
        (status === "authenticated" || status === "unauthenticated"),
      retry: false,
    },
  );
}

export type RequestDeckAccessResult = {
  ok: true;
  alreadyHasAccess: boolean;
  notifiedOwner: boolean;
  requestId?: string;
  message: string;
};

export function useRequestDeckAccess() {
  return useActionMutation<
    RequestDeckAccessResult,
    {
      accessRequestToken?: string;
      deckId: string;
      note?: string;
      requesterEmail?: string;
    }
  >("request-deck-access");
}
