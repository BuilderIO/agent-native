import { useActionQuery } from "@agent-native/core/client/hooks";

export interface MeetingCommandSearchHit {
  id: string;
  title: string;
  recordingId?: string | null;
  scheduledStart?: string | null;
  actualStart?: string | null;
  snippet?: string | null;
  matchType?: string;
}

export interface DictationCommandSearchHit {
  id: string;
  fullText: string;
  cleanedText?: string | null;
  snippet?: string | null;
  durationMs: number;
  source: string;
  targetApp?: string | null;
  startedAt: string;
  createdAt: string;
}

export function useMeetingCommandSearch(query: string) {
  const trimmedQuery = query.trim();
  return useActionQuery<{
    query: string;
    meetings: MeetingCommandSearchHit[];
  }>(
    "search-meetings",
    trimmedQuery ? { query: trimmedQuery, limit: 8 } : undefined,
    {
      enabled: trimmedQuery.length >= 2,
      retry: false,
    },
  );
}

export function useDictationCommandSearch(query: string) {
  const trimmedQuery = query.trim();
  return useActionQuery<{
    query: string;
    dictations: DictationCommandSearchHit[];
  }>(
    "search-dictations",
    trimmedQuery ? { query: trimmedQuery, limit: 8 } : undefined,
    {
      enabled: trimmedQuery.length >= 2,
      retry: false,
    },
  );
}
