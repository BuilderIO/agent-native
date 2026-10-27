import { useActionQuery } from "@agent-native/core/client/hooks";

export interface ClipsLinks {
  /** Null until known, and when this Content has no Clips app. */
  appUrl: string | null;
  linkOrigins: readonly string[];
  /** False until Content has answered or failed, so a link waits for it. */
  settled: boolean;
}

/** Where this Content's Clips app lives, for links into and out of it. */
export function useClipsLinks(): ClipsLinks {
  const query = useActionQuery(
    "get-clips-links",
    {},
    {
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      resources: ["clips-links"],
    },
  );
  return {
    appUrl: query.data?.appUrl ?? null,
    linkOrigins: query.data?.linkOrigins ?? [],
    settled: query.isSuccess || query.isError,
  };
}

export function clipShareUrl(appUrl: string, recordingId: string): string {
  return `${appUrl}/share/${encodeURIComponent(recordingId)}`;
}
