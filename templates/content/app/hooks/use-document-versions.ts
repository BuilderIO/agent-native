import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appApiPath, useChangeVersion } from "@agent-native/core/client";
import type { Document, DocumentVersionListResponse } from "@shared/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(appApiPath(url), init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useDocumentVersions(documentId: string | null) {
  // Refetch the version list every time the agent runs a mutating action —
  // `edit-document`, `update-document`, restore, etc. each create a new
  // version row and emit `source: "action"` through the runner. Folding the
  // counter into the queryKey is the framework pattern (see
  // `use-change-version.ts` in @agent-native/core).
  const sync = useChangeVersion("action");
  return useQuery({
    queryKey: ["document-versions", documentId, sync],
    queryFn: () =>
      fetchJson<DocumentVersionListResponse>(
        `/api/documents/${documentId}/versions`,
      ),
    select: (data: any) => {
      const versions = data?.versions ?? data;
      return Array.isArray(versions) ? versions : [];
    },
    enabled: !!documentId,
    placeholderData: (prev) => prev,
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
