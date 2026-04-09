import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Document, DocumentVersionListResponse } from "@shared/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useDocumentVersions(documentId: string | null) {
  return useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () =>
      fetchJson<DocumentVersionListResponse>(
        `/api/documents/${documentId}/versions`,
      ),
    select: (data: any) => {
      const versions = data?.versions ?? data;
      return Array.isArray(versions) ? versions : [];
    },
    enabled: !!documentId,
  });
}

export function useRestoreDocumentVersion(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      fetchJson<Document>(
        `/api/documents/${documentId}/versions/${versionId}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action"] });
      queryClient.invalidateQueries({
        queryKey: ["document-versions", documentId],
      });
    },
  });
}
