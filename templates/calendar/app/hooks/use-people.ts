import { callAction } from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface PeopleSearchResult {
  name: string;
  email: string;
  photoUrl?: string;
  source?: "contact" | "otherContact" | "directory";
}

export interface PeopleSearchResponse {
  results?: PeopleSearchResult[];
  scopeRequired?: boolean;
}

const PEOPLE_CONTACTS_STALE_TIME = 10 * 60_000;
const PEOPLE_CONTACTS_GC_TIME = 30 * 60_000;

export const PEOPLE_CONTACTS_QUERY_KEY = [
  "action",
  "search-people",
  { scope: "all" },
] as const;

function sourceRank(source?: PeopleSearchResult["source"]) {
  switch (source) {
    case "contact":
      return 0;
    case "directory":
      return 1;
    case "otherContact":
      return 2;
    default:
      return 3;
  }
}

function matchRank(person: PeopleSearchResult, query: string) {
  if (!query) return sourceRank(person.source);
  const q = query.toLowerCase();
  const name = person.name.toLowerCase();
  const email = person.email.toLowerCase();
  if (email === q || name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (email.startsWith(q)) return 2;
  if (name.includes(q)) return 3;
  if (email.includes(q)) return 4;
  return 5;
}

export function filterPeopleResults(
  people: PeopleSearchResult[],
  query: string,
  selectedEmails: Set<string>,
  limit = 30,
) {
  const q = query.trim().toLowerCase();
  return people
    .filter((person) => {
      const email = person.email.toLowerCase();
      if (selectedEmails.has(email)) return false;
      if (!q) return true;
      return (
        person.name.toLowerCase().includes(q) ||
        person.email.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const rank = matchRank(a, q) - matchRank(b, q);
      if (rank !== 0) return rank;
      const source = sourceRank(a.source) - sourceRank(b.source);
      if (source !== 0) return source;
      return (a.name || a.email).localeCompare(b.name || b.email);
    })
    .slice(0, limit);
}

export function prefetchPeopleContacts(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return queryClient.prefetchQuery({
    queryKey: PEOPLE_CONTACTS_QUERY_KEY,
    queryFn: () =>
      callAction<PeopleSearchResponse>(
        "search-people",
        { scope: "all" },
        { method: "GET" },
      ),
    staleTime: PEOPLE_CONTACTS_STALE_TIME,
    gcTime: PEOPLE_CONTACTS_GC_TIME,
  });
}

export function usePeopleContacts(enabled = true) {
  return useQuery({
    queryKey: PEOPLE_CONTACTS_QUERY_KEY,
    queryFn: () =>
      callAction<PeopleSearchResponse>(
        "search-people",
        { scope: "all" },
        { method: "GET" },
      ),
    enabled,
    staleTime: PEOPLE_CONTACTS_STALE_TIME,
    gcTime: PEOPLE_CONTACTS_GC_TIME,
    refetchOnWindowFocus: false,
  });
}
