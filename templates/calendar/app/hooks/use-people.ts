import { callAction } from "@agent-native/core/client/hooks";
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

export type PeopleSearchScope = "all" | "directory";

const PEOPLE_CONTACTS_STALE_TIME = 10 * 60_000;
const PEOPLE_CONTACTS_GC_TIME = 30 * 60_000;
const PEOPLE_SEARCH_STALE_TIME = 60_000;
const PEOPLE_SEARCH_GC_TIME = 5 * 60_000;

export function peopleContactsQueryKey(scope: PeopleSearchScope = "all") {
  return ["action", "search-people", { scope }] as const;
}

export const PEOPLE_CONTACTS_QUERY_KEY = peopleContactsQueryKey();

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

export function mergePeopleResults(
  ...groups: Array<PeopleSearchResult[] | undefined>
) {
  const people = new Map<string, PeopleSearchResult>();

  for (const group of groups) {
    for (const person of group ?? []) {
      const email = person.email.trim();
      const key = email.toLowerCase();
      if (!key) continue;

      const existing = people.get(key);
      if (!existing) {
        people.set(key, { ...person, email });
        continue;
      }

      if (sourceRank(person.source) < sourceRank(existing.source)) {
        existing.source = person.source;
      }
      if (
        person.name &&
        person.name !== person.email &&
        (!existing.name || existing.name === existing.email)
      ) {
        existing.name = person.name;
      }
      if (!existing.photoUrl && person.photoUrl) {
        existing.photoUrl = person.photoUrl;
      }
    }
  }

  return Array.from(people.values());
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
  scope: PeopleSearchScope = "all",
) {
  return queryClient.prefetchQuery({
    queryKey: peopleContactsQueryKey(scope),
    queryFn: () =>
      callAction<PeopleSearchResponse>(
        "search-people",
        { scope },
        { method: "GET" },
      ),
    staleTime: PEOPLE_CONTACTS_STALE_TIME,
    gcTime: PEOPLE_CONTACTS_GC_TIME,
  });
}

export function usePeopleContacts(
  scope: PeopleSearchScope = "all",
  enabled = true,
) {
  return useQuery({
    queryKey: peopleContactsQueryKey(scope),
    queryFn: () =>
      callAction<PeopleSearchResponse>(
        "search-people",
        { scope },
        { method: "GET" },
      ),
    enabled,
    staleTime: PEOPLE_CONTACTS_STALE_TIME,
    gcTime: PEOPLE_CONTACTS_GC_TIME,
    refetchOnWindowFocus: false,
  });
}

export function usePeopleSearch(
  query: string,
  enabled = true,
  scope: PeopleSearchScope = "all",
) {
  const q = query.trim();
  return useQuery({
    queryKey: ["action", "search-people", { q, scope }],
    queryFn: () =>
      callAction<PeopleSearchResponse>(
        "search-people",
        { q, scope },
        { method: "GET" },
      ),
    enabled: enabled && q.length > 0,
    staleTime: PEOPLE_SEARCH_STALE_TIME,
    gcTime: PEOPLE_SEARCH_GC_TIME,
    refetchOnWindowFocus: false,
  });
}
