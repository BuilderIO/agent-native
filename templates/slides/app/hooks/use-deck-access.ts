import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { toast } from "sonner";

export type DeckAccessStatusResponse = {
  exists: boolean;
  hasAccess: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  viewerName: string | null;
  role: "owner" | "viewer" | "commenter" | "editor" | "admin" | null;
  visibility: "private" | "org" | "public" | null;
};

export function useDeckAccessStatus(deckId?: string) {
  return useActionQuery<DeckAccessStatusResponse>(
    "get-deck-access-status",
    { deckId: deckId ?? "" },
    {
      enabled: Boolean(deckId),
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

function showActionError(message: string) {
  return (error: Error) => {
    toast.error(
      error.message
        ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
        : message,
    );
  };
}

export function useRequestDeckAccess() {
  return useActionMutation<RequestDeckAccessResult, { deckId: string }>(
    "request-deck-access",
    { onError: showActionError("Failed to request access") },
  );
}
