import { useActionQuery } from "@agent-native/core/client/hooks";

type Role = "viewer" | "commenter" | "editor" | "admin";

interface SharesResponse {
  ownerEmail: string | null;
  role?: "owner" | Role;
  visibility: "private" | "org" | "public" | null;
  shares: unknown[];
}

export function useDeckRole(
  deckId: string | undefined,
  assumeEditorWhileLoading = false,
): {
  role: SharesResponse["role"] | undefined;
  canEdit: boolean;
  canComment: boolean;
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
      : role === "owner" || role === "editor" || role === "admin";
  const canComment =
    role === undefined
      ? assumeEditorWhileLoading
      : role === "owner" ||
        role === "commenter" ||
        role === "editor" ||
        role === "admin";
  return { role, canEdit, canComment, isLoading: query.isLoading };
}
