import { useActionQuery } from "@agent-native/core/client/hooks";

type Role = "viewer" | "editor" | "admin";

interface SharesResponse {
  ownerEmail: string | null;
  role?: "owner" | Role;
  visibility: "private" | "org" | "public" | null;
  shares: unknown[];
}

/**
 * Resolve the signed-in user's role on a deck. Mirrors Google Slides:
 * `Viewer` = no edit affordances, but the editor shell is still navigable;
 * any other role (Owner / Editor / Admin) gets full editing.
 *
 * `assumeEditorWhileLoading` should only be true when a faster, already-known
 * signal (e.g. `deck.createdByMe`) confirms the caller is the owner — that
 * avoids a flash of view-only chrome for owners without ever defaulting a
 * viewer into edit affordances while the real role is still loading. Without
 * that signal, `canEdit` stays false until the role query resolves, so a
 * viewer can never trigger an edit that the server will reject and silently
 * roll back.
 */
export function useDeckRole(
  deckId: string | undefined,
  assumeEditorWhileLoading = false,
): {
  role: SharesResponse["role"] | undefined;
  canEdit: boolean;
  isLoading: boolean;
} {
  const query = useActionQuery<SharesResponse>(
    "list-resource-shares",
    { resourceType: "deck", resourceId: deckId ?? "" } as any,
    { enabled: Boolean(deckId) } as any,
  );
  const role = query.data?.role;
  const canEdit =
    role === undefined
      ? assumeEditorWhileLoading
      : role === "owner" || role !== "viewer";
  return { role, canEdit, isLoading: query.isLoading };
}
