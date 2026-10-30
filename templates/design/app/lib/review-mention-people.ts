import { useOrg, useOrgMembers } from "@agent-native/core/client/org";
import type { ReviewMention } from "@agent-native/core/review";
import { useEffect, useMemo, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 200;

interface MentionableMember {
  email: string;
  name?: string | null | undefined;
}

export function reviewMentionPeople(
  members: readonly MentionableMember[],
): ReviewMention[] {
  return members.map((member) => ({
    label: member.name?.trim() || member.email.split("@")[0] || member.email,
    email: member.email,
  }));
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * The people an `@` can name. The members list is paged on the server, so a
 * name past the first page is found by asking for it: the composer reports the
 * text after the `@`, and the matching page replaces the list. The members
 * endpoint already leaves out anyone whose removal is pending.
 *
 * `searching` is true while the answer to the current query is still on its
 * way, so a list that cannot match it yet is not mistaken for "no one".
 * `failed` is true when that answer never came, so an empty list is not
 * mistaken for "no one" either.
 */
export function useReviewMentionPeople() {
  const [query, setQuery] = useState("");
  // Closing the picker returns to the first page at once; typing waits.
  const searched = useDebouncedValue(
    query,
    query === "" ? 0 : SEARCH_DEBOUNCE_MS,
  );
  const { data: org } = useOrg();
  const orgId = org?.orgId ?? null;
  const { data, isFetching, isError } = useOrgMembers(0, searched);
  const fetched = useMemo(
    () => (data ? reviewMentionPeople(data.members) : null),
    [data],
  );
  // The picker keeps the last answer while the next one loads, instead of
  // blinking to empty on every keystroke. It never carries one organization's
  // people into another's.
  const lastPeopleRef = useRef<{
    orgId: string | null;
    people: ReviewMention[];
  }>({ orgId: null, people: [] });
  const people =
    fetched ??
    (lastPeopleRef.current.orgId === orgId ? lastPeopleRef.current.people : []);
  useEffect(() => {
    if (fetched) lastPeopleRef.current = { orgId, people: fetched };
  }, [fetched, orgId]);
  const searching = query !== "" && (searched !== query || Boolean(isFetching));
  const failed = Boolean(isError) && !fetched && searched === query;
  return { people, searching, failed, onMentionQueryChange: setQuery };
}
