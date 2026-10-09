import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  contentSpaceForStoredSelection,
  contentSpaceIdForCreate,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
} from "@/components/sidebar/select-content-space";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import {
  rollbackOptimisticCreatedDocument,
  seedCreatedDocumentNavigation,
  useCreateDocument,
} from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { documentQueryFilter } from "@/lib/document-query";
import {
  clearDocumentCreationConfirmed,
  markDocumentCreationConfirmed,
  markDocumentCreationPending,
  clearDocumentCreateIntent,
  withDocumentCreateInFlight,
  writeDocumentCreateIntentBestEffort,
} from "@/lib/optimistic-document";

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
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const t = useT();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const createIntentScope = useMemo(
    () =>
      session?.email
        ? { accountId: session.email, orgId: session.orgId ?? null }
        : null,
    [session?.email, session?.orgId],
  );
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
    async (parentId?: string, requestedId?: string) => {
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
      const id = requestedId ?? nanoid();
      const now = new Date().toISOString();
      const tempDoc = markDocumentCreationPending(queryClient, {
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
      const previousDocuments = queryClient.getQueryData(
        LIST_DOCUMENTS_QUERY_KEY,
      );

      queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: any) => {
        const docs: Document[] =
          old?.documents ?? (Array.isArray(old) ? old : []);
        if (Array.isArray(old)) return [...docs, tempDoc];
        return {
          ...(old && typeof old === "object" ? old : {}),
          documents: [...docs, tempDoc],
        };
      });
      queryClient.setQueryData(["action", "get-document", { id }], tempDoc);

      if (shouldNavigate) {
        seedCreatedDocumentNavigation(
          queryClient,
          tempDoc,
          selectedSpace?.filesDatabaseId ?? null,
        );
        void navigate(`/page/${id}`, { flushSync: true });
        onAfterNavigate?.();
      }

      const persist = async () => {
        if (createIntentScope && shouldNavigate) {
          writeDocumentCreateIntentBestEffort(createIntentScope, {
            id,
            parentId: parentId ?? null,
            spaceId: spaceId ?? null,
            ...(selectedSpace?.filesDatabaseId
              ? { filesDatabaseId: selectedSpace.filesDatabaseId }
              : {}),
            createdAt: now,
          });
        }
        const created = await withDocumentCreateInFlight(id, () =>
          createDocument.mutateAsync({
            id,
            title: "",
            parentId: parentId ?? undefined,
            spaceId,
          }),
        );
        const confirmed = markDocumentCreationConfirmed(queryClient, created);
        if (createIntentScope && shouldNavigate) {
          try {
            clearDocumentCreateIntent(createIntentScope, created.id);
          } catch (error) {
            console.error(
              "Could not clear the pending Content create intent.",
              error,
            );
          }
        }
        queryClient.setQueryData(
          ["action", "get-document", { id: created.id }],
          confirmed,
        );
        if (
          !shouldNavigate ||
          locationRef.current.pathname !== `/page/${created.id}`
        ) {
          clearDocumentCreationConfirmed(queryClient, { id: created.id });
        }
        void queryClient.invalidateQueries(documentQueryFilter(id));
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
      };

      let createErrorToastId: string | number | undefined;
      let retrying = false;

      const reportPersistError = (err: unknown) => {
        if (!shouldNavigate) {
          rollbackOptimisticCreatedDocument(
            queryClient,
            id,
            previousDocuments !== undefined,
          );
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-documents"],
          });
          queryClient.removeQueries(documentQueryFilter(id));
          toast.error(t("sidebar.failedCreatePage"), {
            description:
              err instanceof Error ? err.message : t("empty.genericError"),
          });
          return;
        }

        const retryPersist = async () => {
          if (retrying) return;
          retrying = true;
          try {
            await persist();
            if (createErrorToastId !== undefined) {
              toast.dismiss(createErrorToastId);
            }
          } catch (retryError) {
            reportPersistError(retryError);
          } finally {
            retrying = false;
          }
        };

        createErrorToastId = toast.error(t("sidebar.failedCreatePage"), {
          id: createErrorToastId,
          description:
            err instanceof Error ? err.message : t("empty.genericError"),
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: t("database.retry"),
            onClick: () => retryPersist(),
          },
        });
      };

      if (shouldAwaitPersist) {
        try {
          await persist();
        } catch (err) {
          reportPersistError(err);
          throw err;
        }
      } else {
        void persist().catch(reportPersistError);
      }

      return id;
    },
    [
      createDocument,
      createIntentScope,
      navigate,
      onAfterNavigate,
      queryClient,
      selectedSpace,
      shouldAwaitPersist,
      shouldNavigate,
      t,
    ],
  );
}
