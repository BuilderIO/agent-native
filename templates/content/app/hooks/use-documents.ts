import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type {
  Document,
  DocumentCreateRequest,
  DocumentUpdateRequest,
  DocumentUpdateResponse,
  DocumentMoveRequest,
  DocumentTreeNode,
} from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useRestoreContentDatabase } from "./use-content-database";

export function useDocuments() {
  return useActionQuery<Document[]>("list-documents", undefined, {
    select: (data: any) => {
      const docs = data?.documents ?? data;
      return Array.isArray(docs) ? docs : [];
    },
  });
}

export function useDocument(id: string | null) {
  return useActionQuery<Document>("get-document", id ? { id } : undefined, {
    enabled: !!id,
    // Doc-not-found / no-access errors are deterministic — retrying just keeps
    // the spinner up for ~7s before the UI can render "Not found".
    retry: false,
  });
}

export function useCreateDocument() {
  return useActionMutation<Document, DocumentCreateRequest>("create-document");
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  const restoreContentDatabase = useRestoreContentDatabase();
  return useActionMutation<
    DocumentUpdateResponse,
    DocumentUpdateRequest & { id: string }
  >("update-document", {
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: variables.id }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });

      if (data.softDeletedDatabaseIds.length > 0) {
        const databaseIds = data.softDeletedDatabaseIds;
        toast("Database deleted", {
          action: {
            label: "Undo",
            onClick: () => {
              void Promise.all(
                databaseIds.map((databaseId) =>
                  restoreContentDatabase.mutateAsync({ databaseId }),
                ),
              ).catch((err) => {
                toast.error("Failed to restore database", {
                  description:
                    err instanceof Error ? err.message : "Something went wrong",
                });
              });
            },
          },
        });
      }
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { success: boolean; deleted: number },
    { id: string }
  >("delete-document", {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: variables.id }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
    },
  });
}

export function useMoveDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<Document, DocumentMoveRequest & { id: string }>(
    "move-document",
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: variables.id }],
        });
      },
    },
  );
}

export function buildDocumentTree(
  documents: Document[] | undefined | null,
): DocumentTreeNode[] {
  if (!Array.isArray(documents)) return [];
  const map = new Map<string, DocumentTreeNode>();
  const orderedDocuments: Document[] = [];
  const roots: DocumentTreeNode[] = [];

  // Create nodes
  for (const doc of documents) {
    if (map.has(doc.id)) continue;
    map.set(doc.id, { ...doc, children: [] });
    orderedDocuments.push(doc);
  }

  const parentById = new Map(
    orderedDocuments.map((doc) => [doc.id, doc.parentId]),
  );

  function hasParentCycle(doc: Document) {
    const seen = new Set([doc.id]);
    let parentId = doc.parentId;
    while (parentId && map.has(parentId)) {
      if (seen.has(parentId)) return true;
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return false;
  }

  // Build tree
  for (const doc of orderedDocuments) {
    const node = map.get(doc.id)!;
    if (
      doc.parentId &&
      map.has(doc.parentId) &&
      doc.parentId !== doc.id &&
      !hasParentCycle(doc)
    ) {
      map.get(doc.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by position
  const sortChildren = (nodes: DocumentTreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position);
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  return roots;
}

export function filterDocumentTreeDocuments(
  documents: Document[] | undefined | null,
): Document[] {
  if (!Array.isArray(documents)) return [];

  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const hiddenIds = new Set<string>();

  function isDatabaseContainedDocument(doc: Document) {
    if (doc.databaseMembership) {
      hiddenIds.add(doc.id);
      return true;
    }
    if (hiddenIds.has(doc.id)) return true;

    const seen = new Set([doc.id]);
    let parentId = doc.parentId;

    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) return false;
      seen.add(parentId);

      const parent = byId.get(parentId)!;
      if (parent.databaseMembership || hiddenIds.has(parent.id)) {
        hiddenIds.add(doc.id);
        return true;
      }

      parentId = parent.parentId;
    }

    return false;
  }

  return documents.filter((doc) => !isDatabaseContainedDocument(doc));
}
