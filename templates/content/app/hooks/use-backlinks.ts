import { useActionQuery } from "@agent-native/core/client/hooks";

export interface Backlink {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  updatedAt: string;
}

export interface BacklinkList {
  pages: Backlink[];
  count: number;
  more: boolean;
}

export function useBacklinks(documentId: string | null | undefined) {
  const query = useActionQuery(
    "list-backlinks",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  );
  const list = documentId
    ? (query.data as BacklinkList | undefined)
    : undefined;
  return { query, list };
}
