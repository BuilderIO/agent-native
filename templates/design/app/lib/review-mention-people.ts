import { useOrgMembers } from "@agent-native/core/client/org";
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
 */
export function useReviewMentionPeople() {
  const [query, setQuery] = useState("");
  // Closing the picker returns to the first page at once; typing waits.
  const searched = useDebouncedValue(
    query,
    query === "" ? 0 : SEARCH_DEBOUNCE_MS,
  );
  const { data } = useOrgMembers(0, searched);
  const fetched = useMemo(
    () => (data ? reviewMentionPeople(data.members) : null),
    [data],
  );
  // The picker keeps the last answer while the next one loads, instead of
  // blinking to empty on every keystroke.
  const lastPeopleRef = useRef<ReviewMention[]>([]);
  const people = fetched ?? lastPeopleRef.current;
  useEffect(() => {
    if (fetched) lastPeopleRef.current = fetched;
  }, [fetched]);
  return { people, onMentionQueryChange: setQuery };
}
