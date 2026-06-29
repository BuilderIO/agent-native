import type { Document } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useCreateDocument } from "@/hooks/use-documents";

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
  const onAfterNavigate = opts?.onAfterNavigate;
  const shouldNavigate = opts?.navigate ?? true;
  const shouldAwaitPersist = opts?.awaitPersist ?? true;

  return useCallback(
    async (parentId?: string) => {
      const id = nanoid();
      const now = new Date().toISOString();
      const tempDoc: Document = {
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
      };

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
        await createDocument.mutateAsync({
          id,
          title: "",
          parentId: parentId ?? undefined,
        });
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
      shouldAwaitPersist,
      shouldNavigate,
    ],
  );
}
