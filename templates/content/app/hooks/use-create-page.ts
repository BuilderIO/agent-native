import type { Document } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  contentSpaceForStoredSelection,
  contentSpaceIdForCreate,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
} from "@/components/sidebar/select-content-space";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useCreateDocument } from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { markDocumentCreationPending } from "@/lib/optimistic-document";

const LIST_DOCUMENTS_QUERY_KEY = [
  "action",
  "list-documents",
  undefined,
] as const;

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function useCreatePage(opts?: {
  onAfterNavigate?: () => void;
  navigate?: boolean;
  awaitPersist?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createDocument = useCreateDocument();
  const contentSpacesQuery = useContentSpaces();
  const [storedSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const selectedSpace = contentSpaceForStoredSelection({
    spaces: contentSpacesQuery.data?.spaces ?? [],
    storedSpaceId,
  });
  const onAfterNavigate = opts?.onAfterNavigate;
  const shouldNavigate = opts?.navigate ?? true;
  const shouldAwaitPersist = opts?.awaitPersist ?? true;

  return useCallback(
    async (parentId?: string) => {
      let spaceId: string | undefined;
      try {
        spaceId = contentSpaceIdForCreate({
          parentId,
          selectedSpace,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Files are still loading",
        );
        throw error;
      }
      const id = nanoid();
      const now = new Date().toISOString();
      const tempDoc = markDocumentCreationPending({
        id,
        parentId: parentId ?? null,
        title: "",
        content: "",
        icon: null,
        position: 9999,
        isFavorite: false,
        hideFromSearch: false,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });

      queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: any) => {
        const docs: Document[] =
          old?.documents ?? (Array.isArray(old) ? old : []);
        return { documents: [...docs, tempDoc] };
      });
      queryClient.setQueryData(["action", "get-document", { id }], tempDoc);

      if (shouldNavigate) {
        navigate(`/page/${id}`, { flushSync: true });
        onAfterNavigate?.();
      }

      const persist = async () => {
        const created = await createDocument.mutateAsync({
          id,
          title: "",
          parentId: parentId ?? undefined,
          spaceId,
        });
        queryClient.setQueryData(
          ["action", "get-document", { id: created.id }],
          created,
        );
        // Replace optimistic doc with real server doc + clear any 404 error
        // state from the in-flight fetch that ran before create completed.
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id }],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      };

      const onPersistError = (err: unknown) => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        queryClient.removeQueries({
          queryKey: ["action", "get-document", { id }],
        });
        if (shouldNavigate) navigate("/");
        toast.error("Failed to create page", {
          description:
            err instanceof Error ? err.message : "Something went wrong",
        });
      };

      if (shouldAwaitPersist) {
        try {
          await persist();
        } catch (err) {
          onPersistError(err);
          throw err;
        }
      } else {
        void persist().catch(onPersistError);
      }

      return id;
    },
    [
      createDocument,
      navigate,
      onAfterNavigate,
      queryClient,
      selectedSpace,
      shouldAwaitPersist,
      shouldNavigate,
    ],
  );
}
