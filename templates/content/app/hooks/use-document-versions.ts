import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type { Document, DocumentVersion } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";

export function useDocumentVersions(documentId: string | null) {
  return useActionQuery<DocumentVersion[]>(
    "list-document-versions",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      select: (data: any) => {
        const versions = data?.versions ?? data;
        return Array.isArray(versions) ? versions : [];
      },
      placeholderData: (prev: any) => prev,
    } as any,
  );
}

export function useRestoreDocumentVersion(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<Document, { documentId: string; versionId: string }>(
    "restore-document-version",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-document-versions", { documentId }],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: documentId }],
        });
      },
    },
  );
}
