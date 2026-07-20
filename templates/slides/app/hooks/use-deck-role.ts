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
 * Returns `canEdit = true` while the role is still loading so that owners
 * never see a flash of view-only chrome on first paint.
 */
export function useDeckRole(deckId: string | undefined): {
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
    role === undefined ? true : role === "owner" || role !== "viewer";
  return { role, canEdit, isLoading: query.isLoading };
}
